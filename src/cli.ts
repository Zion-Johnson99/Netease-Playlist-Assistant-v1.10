import readline from "node:readline";
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
import {
  chooseSemanticBatchSize,
  chooseSemanticReadConcurrency,
  createDeepseekSemanticMatcher,
} from "./semantic.js";

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
  if (task.filter.type === "artist") {
    console.log(`开始歌手筛选：${task.filter.value}，歌曲 ${songs.length} 首`);
  } else {
    console.log(
      `开始语义筛选：${task.filter.type}=${task.filter.value}，歌曲 ${songs.length} 首，读取并发 ${chooseSemanticReadConcurrency(songs.length)}，DeepSeek 批大小 ${chooseSemanticBatchSize()}，DeepSeek 并发 ${config.deepseekBatchConcurrency}`,
    );
  }
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
  console.log(
    `筛选完成：${songs.length}/${songs.length}，已匹配：${matched.length}，总耗时：${progress.elapsed()}`,
  );

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
    await runTask(getInstruction(args), "execute");
    return;
  }

  if (command === "preview") {
    await runTask(getInstruction(args), "preview");
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
  npm run preview -- "把歌单A里贾斯汀比伯的歌添加进新建歌单JB"
  npm run run -- "把歌单A里全部粤语歌添加进新建歌单粤语精选"`);
}

main().catch((error: unknown) => {
  const message = getErrorMessage(error);
  console.error(`执行失败：${message}`);
  process.exitCode = 1;
});
