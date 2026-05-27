import readline from "node:readline";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { loadConfig, readCookie, setDeepseekModel } from "./config.js";
import { parseInstruction } from "./deepseek.js";
import { filterSongs } from "./filter.js";
import { readMatchingPreviewCache, savePreviewCache } from "./preview-cache.js";
import {
  addSongsToPlaylist,
  createPlaylist,
  findPlaylistByName,
  getLoginProfile,
  getLyric,
  getPlaylistSongs,
  getSongDisplay,
  getSongWikiSummary,
  listOwnPlaylists,
  loginByQrCode,
} from "./netease.js";
import { PlaylistTask } from "./types.js";
import { createDeepseekSemanticMatcher } from "./semantic.js";

type Mode = "execute" | "preview";

type TerminalProgress = {
  update: (message: string) => void;
  finish: () => void;
  elapsed: () => string;
  warn: (message: string) => void;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createTerminalProgress(): TerminalProgress {
  let active = false;
  const startedAt = Date.now();

  const elapsed = (): string => {
    const totalSeconds = Math.floor((Date.now() - startedAt) / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  };

  const finish = (): void => {
    if (!active) {
      return;
    }

    process.stdout.write("\n");
    active = false;
  };

  const render = (message: string): void => {
    const singleLine = `${message}，耗时 ${elapsed()}`.replace(/\r?\n/g, " ");
    if (!process.stdout.isTTY) {
      console.log(singleLine);
      active = false;
      return;
    }

    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    process.stdout.write(singleLine);
    active = true;
  };

  return {
    update: render,
    finish,
    elapsed,
    warn: (message: string): void => {
      finish();
      console.warn(message);
    },
  };
}

async function runTask(instruction: string, mode: Mode): Promise<void> {
  const config = loadConfig();
  const cookie = readCookie(config);
  const profile = await getLoginProfile(cookie);
  console.log(`当前账号：${profile.nickname ?? profile.userId}`);
  const playlists = await listOwnPlaylists(cookie, profile);
  const task = await parseInstruction(
    instruction,
    config,
    playlists.map((playlist) => playlist.name),
  );

  await executeStructuredTask(task, cookie, mode, playlists);
}

async function executeStructuredTask(
  task: PlaylistTask,
  cookie: string,
  mode: Mode,
  playlists: Awaited<ReturnType<typeof listOwnPlaylists>>,
): Promise<void> {
  const config = loadConfig();
  const source = findPlaylistByName(playlists, task.sourcePlaylistName);
  const existingTarget = playlists.find(
    (playlist) => playlist.name === task.targetPlaylistName,
  );
  if (existingTarget) {
    throw new Error(`目标歌单已存在：${task.targetPlaylistName}`);
  }

  if (mode === "execute") {
    const previewCache = readMatchingPreviewCache(config, task, source.id);
    if (previewCache && previewCache.matchedSongs.length > 0) {
      console.log(
        `使用上次预览结果：${previewCache.matchedSongs.length} 首，预览时间：${previewCache.createdAt}`,
      );
      const target = await createPlaylist(task.targetPlaylistName, cookie);
      await addSongsToPlaylist(
        target.id,
        previewCache.matchedSongs.map((song) => song.id),
        cookie,
      );
      console.log(
        `已创建歌单并添加歌曲：${target.name}，共 ${previewCache.matchedSongs.length} 首`,
      );
      return;
    }
  }

  console.log(`源歌单：${source.name}，歌曲数：${source.trackCount}`);
  const songs = await getPlaylistSongs(source.id, cookie);
  console.log(`已读取歌曲：${songs.length}`);
  const progress = createTerminalProgress();

  const lyricFailures: Array<{
    songId: number;
    display: string;
    message: string;
  }> = [];
  let matched: Awaited<ReturnType<typeof filterSongs>>;
  try {
    matched = await filterSongs(
      songs,
      task,
      (songId) => getLyric(songId, cookie),
      {
        onProgress:
          task.filter.type !== "artist"
            ? (event) => {
                if (event.message) {
                  progress.update(event.message);
                  return;
                }

                const phaseLabel =
                  event.phase === "lyrics"
                    ? "读取歌词"
                    : event.phase === "metadata"
                      ? "读取元数据"
                      : event.phase === "semantic"
                        ? "语义判定"
                        : "筛选";
                progress.update(
                  `${phaseLabel}进度：${event.processed}/${event.total}，已匹配：${event.matched}`,
                );
              }
            : undefined,
        semanticMatcher: createDeepseekSemanticMatcher(config, {
          getSongWikiSummary: (songId) => getSongWikiSummary(songId, cookie),
        }),
        onLyricError: ({ song, error }) => {
          lyricFailures.push({
            songId: song.id,
            display: getSongDisplay(song),
            message: getErrorMessage(error),
          });
        },
        progressInterval: 25,
      },
    );
  } finally {
    progress.finish();
  }

  if (lyricFailures.length > 0) {
    progress.warn(`歌词读取失败：${lyricFailures.length} 首，已跳过歌词判定`);
    for (const failure of lyricFailures) {
      progress.warn(
        `- ${failure.display} (${failure.songId}) | ${failure.message}`,
      );
    }
  }

  if (matched.length === 0) {
    console.log("没有找到符合条件的歌曲");
    return;
  }

  console.log(`匹配歌曲：${matched.length}`);
  for (const song of matched) {
    console.log(`- ${getSongDisplay(song)} | ${song.reason}`);
  }

  if (mode === "preview") {
    savePreviewCache(config, {
      sourcePlaylistId: source.id,
      sourcePlaylistName: task.sourcePlaylistName,
      targetPlaylistName: task.targetPlaylistName,
      filter: task.filter,
      matchedSongs: matched,
    });
    console.log("预览完成，未创建歌单");
    return;
  }

  const target = await createPlaylist(task.targetPlaylistName, cookie);
  await addSongsToPlaylist(
    target.id,
    matched.map((song) => song.id),
    cookie,
  );

  console.log(`已创建歌单并添加歌曲：${target.name}，共 ${matched.length} 首`);
}

function getInstruction(args: string[]): string {
  const instruction = args.join(" ").trim();
  if (!instruction) {
    throw new Error("请提供自然语言指令");
  }
  return instruction;
}

export function createInteractiveIntro(mode: Mode): string {
  if (mode === "preview") {
    return [
      "┌─ Netease Playlist Assistant",
      "│  模式：预览",
      "│",
      "│  请说出你的歌单整理需求",
      "│  建议写清楚：源歌单、筛选条件、新歌单名称",
      "│",
      "│  示例：",
      "│  帮我在xx这个歌单中找到所有粤语歌曲并列出来，然后添加进一个新建歌单中，叫做xx",
      "└─",
    ].join("\n");
  }

  return [
    "┌─ Netease Playlist Assistant",
    "│  模式：建立歌单",
    "│",
    "│  请说出你的歌单整理需求",
    "│  建议输入刚才预览过的同一条需求",
    "│  工具会优先复用匹配的最近预览结果",
    "│",
    "│  示例：",
    "│  帮我在xx这个歌单中找到所有粤语歌曲并列出来，然后添加进一个新建歌单中，叫做xx",
    "└─",
  ].join("\n");
}

export function validateInteractiveArgs(command: string, args: string[]): void {
  if (args.length > 0) {
    throw new Error(
      `${command} 已进入对话输入模式，请启动后在对话框内输入需求`,
    );
  }
}

async function promptInstruction(mode: Mode): Promise<string> {
  console.log(createInteractiveIntro(mode));
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const instruction = (await rl.question("需求 > ")).trim();
    if (!instruction) {
      throw new Error("需求不能为空");
    }
    return instruction;
  } finally {
    rl.close();
  }
}

function getModelName(args: string[]): string {
  const model = args
    .filter((arg) => arg !== "--")
    .join(" ")
    .trim();
  if (!model) {
    throw new Error("请提供模型名：deepseek-v4-pro 或 deepseek-v4-flash");
  }
  return model;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  if (command === "login") {
    await loginByQrCode();
    return;
  }

  if (command === "run") {
    validateInteractiveArgs("run", args);
    await runTask(await promptInstruction("execute"), "execute");
    return;
  }

  if (command === "preview") {
    validateInteractiveArgs("preview", args);
    await runTask(await promptInstruction("preview"), "preview");
    return;
  }

  if (command === "model") {
    const model = getModelName(args);
    setDeepseekModel(model);
    console.log(`已切换 DeepSeek 模型：${model}`);
    return;
  }

  console.log(`用法：
  npm run login
  model -- deepseek-v4-flash
  model -- deepseek-v4-pro
  preview
  run`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    const message = getErrorMessage(error);
    console.error(`执行失败：${message}`);
    process.exitCode = 1;
  });
}
