import readline from "node:readline";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import {
  AppLocale,
  isSupportedLocale,
  loadConfig,
  readCookie,
  readLocale,
  setDeepseekModel,
  setLocale,
} from "./config.js";
import { parseInstruction } from "./deepseek.js";
import { filterSongs } from "./filter.js";
import { localeDisplayName, text } from "./locale.js";
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
import { MatchedSong, PlaylistSummary, PlaylistTask, Song } from "./types.js";
import { createDeepseekSemanticMatcher } from "./semantic.js";
import { formatTable } from "./table.js";

type Mode = "execute" | "preview";

type TerminalProgress = {
  update: (message: string) => void;
  finish: () => void;
  elapsed: () => string;
  warn: (message: string) => void;
};

function getArtistsDisplay(song: Song, locale: AppLocale): string {
  return (
    song.artists
      .map((artist) => artist.name)
      .filter((name) => typeof name === "string" && name.length > 0)
      .join("/") || text(locale, "未知歌手", "Unknown artist")
  );
}

export function formatMatchedSongsTable(
  songs: MatchedSong[],
  locale: AppLocale = "cn",
): string[] {
  const indexWidth = String(songs.length).length;
  return formatTable(
    songs.map((song, index) => ({
      index: String(index + 1).padStart(Math.max(2, indexWidth), "0"),
      name: song.name,
      artists: getArtistsDisplay(song, locale),
      reason: song.reason,
    })),
    [
      { header: text(locale, "序号", "No."), value: (row) => row.index },
      { header: text(locale, "歌曲", "Track"), value: (row) => row.name },
      {
        header: text(locale, "歌手", "Artists"),
        value: (row) => row.artists,
      },
      { header: text(locale, "理由", "Reason"), value: (row) => row.reason },
    ],
  );
}

export function formatPlaylistTable(
  playlists: PlaylistSummary[],
  locale: AppLocale = "cn",
): string[] {
  const indexWidth = String(playlists.length).length;
  return formatTable(
    playlists.map((playlist, index) => ({
      index: String(index + 1).padStart(Math.max(2, indexWidth), "0"),
      id: String(playlist.id),
      trackCount: String(playlist.trackCount),
      name: playlist.name,
    })),
    [
      { header: text(locale, "序号", "No."), value: (row) => row.index },
      { header: "ID", value: (row) => row.id },
      {
        header: text(locale, "歌曲数", "Tracks"),
        value: (row) => row.trackCount,
      },
      {
        header: text(locale, "歌单名", "Playlist"),
        value: (row) => row.name,
      },
    ],
  );
}

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
    const locale = readLocale();
    const singleLine = text(
      locale,
      `${message}，耗时 ${elapsed()}`,
      `${message}, elapsed ${elapsed()}`,
    ).replace(/\r?\n/g, " ");
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
  const profile = await getLoginProfile(cookie, config.locale);
  console.log(
    text(
      config.locale,
      `当前账号：${profile.nickname ?? profile.userId}`,
      `Current account: ${profile.nickname ?? profile.userId}`,
    ),
  );
  const playlists = await listOwnPlaylists(cookie, profile);
  const task = await parseInstruction(
    instruction,
    config,
    playlists.map((playlist) => playlist.name),
  );

  await executeStructuredTask(task, cookie, mode, playlists);
}

async function listPlaylists(): Promise<void> {
  const config = loadConfig();
  const cookie = readCookie(config);
  const profile = await getLoginProfile(cookie, config.locale);
  console.log(
    text(
      config.locale,
      `当前账号：${profile.nickname ?? profile.userId}`,
      `Current account: ${profile.nickname ?? profile.userId}`,
    ),
  );

  const playlists = await listOwnPlaylists(cookie, profile);
  console.log(
    text(
      config.locale,
      `歌单列表：共 ${playlists.length} 个`,
      `Playlists: ${playlists.length} total`,
    ),
  );
  for (const line of formatPlaylistTable(playlists, config.locale)) {
    console.log(line);
  }
}

async function executeStructuredTask(
  task: PlaylistTask,
  cookie: string,
  mode: Mode,
  playlists: Awaited<ReturnType<typeof listOwnPlaylists>>,
): Promise<void> {
  const config = loadConfig();
  const source = findPlaylistByName(
    playlists,
    task.sourcePlaylistName,
    config.locale,
  );
  const existingTarget = playlists.find(
    (playlist) => playlist.name === task.targetPlaylistName,
  );
  if (existingTarget) {
    throw new Error(
      text(
        config.locale,
        `目标歌单已存在：${task.targetPlaylistName}`,
        `Target playlist already exists: ${task.targetPlaylistName}`,
      ),
    );
  }

  if (mode === "execute") {
    const previewCache = readMatchingPreviewCache(config, task, source.id);
    if (previewCache && previewCache.matchedSongs.length > 0) {
      console.log(
        text(
          config.locale,
          `使用上次预览结果：${previewCache.matchedSongs.length} 首，预览时间：${previewCache.createdAt}`,
          `Using last preview result: ${previewCache.matchedSongs.length} tracks, preview time: ${previewCache.createdAt}`,
        ),
      );
      const target = await createPlaylist(
        task.targetPlaylistName,
        cookie,
        config.locale,
      );
      await addSongsToPlaylist(
        target.id,
        previewCache.matchedSongs.map((song) => song.id),
        cookie,
        config.locale,
      );
      console.log(
        text(
          config.locale,
          `已创建歌单并添加歌曲：${target.name}，共 ${previewCache.matchedSongs.length} 首`,
          `Created playlist and added tracks: ${target.name}, ${previewCache.matchedSongs.length} total`,
        ),
      );
      return;
    }
  }

  console.log(
    text(
      config.locale,
      `源歌单：${source.name}，歌曲数：${source.trackCount}`,
      `Source playlist: ${source.name}, tracks: ${source.trackCount}`,
    ),
  );
  const songs = await getPlaylistSongs(source.id, cookie);
  console.log(
    text(
      config.locale,
      `已读取歌曲：${songs.length}`,
      `Read tracks: ${songs.length}`,
    ),
  );
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
        locale: config.locale,
        onProgress:
          task.filter.type !== "artist"
            ? (event) => {
                if (event.message) {
                  progress.update(event.message);
                  return;
                }

                const phaseLabel =
                  event.phase === "lyrics"
                    ? text(config.locale, "读取歌词", "Reading lyrics")
                    : event.phase === "metadata"
                      ? text(config.locale, "读取元数据", "Reading metadata")
                      : event.phase === "semantic"
                        ? text(config.locale, "语义判定", "Semantic judging")
                        : text(config.locale, "筛选", "Filtering");
                progress.update(
                  text(
                    config.locale,
                    `${phaseLabel}进度：${event.processed}/${event.total}，已匹配：${event.matched}`,
                    `${phaseLabel} progress: ${event.processed}/${event.total}, matched: ${event.matched}`,
                  ),
                );
              }
            : undefined,
        semanticMatcher: createDeepseekSemanticMatcher(config, {
          getSongWikiSummary: (songId) => getSongWikiSummary(songId, cookie),
        }),
        onLyricError: ({ song, error }) => {
          lyricFailures.push({
            songId: song.id,
            display: getSongDisplay(song, config.locale),
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
    progress.warn(
      text(
        config.locale,
        `歌词读取失败：${lyricFailures.length} 首，已跳过歌词判定`,
        `Failed to read lyrics for ${lyricFailures.length} tracks. Lyric judging was skipped for them.`,
      ),
    );
    for (const failure of lyricFailures) {
      progress.warn(
        `- ${failure.display} (${failure.songId}) | ${failure.message}`,
      );
    }
  }

  if (matched.length === 0) {
    console.log(
      text(
        config.locale,
        "没有找到符合条件的歌曲",
        "No matching tracks found.",
      ),
    );
    return;
  }

  console.log(
    text(
      config.locale,
      `匹配歌曲：${matched.length}`,
      `Matched tracks: ${matched.length}`,
    ),
  );
  console.log("");
  for (const line of formatMatchedSongsTable(matched, config.locale)) {
    console.log(line);
  }

  if (mode === "preview") {
    savePreviewCache(config, {
      sourcePlaylistId: source.id,
      sourcePlaylistName: task.sourcePlaylistName,
      targetPlaylistName: task.targetPlaylistName,
      filter: task.filter,
      matchedSongs: matched,
    });
    console.log(
      text(
        config.locale,
        "预览完成，未创建歌单",
        "Preview complete. No playlist was created.",
      ),
    );
    return;
  }

  const target = await createPlaylist(
    task.targetPlaylistName,
    cookie,
    config.locale,
  );
  await addSongsToPlaylist(
    target.id,
    matched.map((song) => song.id),
    cookie,
    config.locale,
  );

  console.log(
    text(
      config.locale,
      `已创建歌单并添加歌曲：${target.name}，共 ${matched.length} 首`,
      `Created playlist and added tracks: ${target.name}, ${matched.length} total`,
    ),
  );
}

function getInstruction(args: string[], locale: AppLocale): string {
  const instruction = args.join(" ").trim();
  if (!instruction) {
    throw new Error(
      text(locale, "请提供自然语言指令", "Provide a natural language request."),
    );
  }
  return instruction;
}

export function createInteractiveIntro(
  mode: Mode,
  locale: AppLocale = "cn",
): string {
  if (locale === "en") {
    if (mode === "preview") {
      return [
        "┌─ Netease Playlist Assistant",
        "│  Mode: preview",
        "│",
        "│  Describe your playlist cleanup request",
        "│  Include the source playlist, filter, and new playlist name",
        "│",
        "│  Example:",
        "│  Find all Cantonese songs in playlist xx and put them in a new playlist named xx",
        "└─",
      ].join("\n");
    }

    return [
      "┌─ Netease Playlist Assistant",
      "│  Mode: create playlist",
      "│",
      "│  Describe your playlist cleanup request",
      "│  Use the same request you previewed",
      "│  The tool will reuse a matching recent preview result first",
      "│",
      "│  Example:",
      "│  Find all Cantonese songs in playlist xx and put them in a new playlist named xx",
      "└─",
    ].join("\n");
  }

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

export function validateInteractiveArgs(
  command: string,
  args: string[],
  locale: AppLocale = "cn",
): void {
  if (args.length > 0) {
    throw new Error(
      text(
        locale,
        `${command} 已进入对话输入模式，请启动后在对话框内输入需求`,
        `${command} uses interactive input mode. Start it first, then enter your request in the prompt.`,
      ),
    );
  }
}

export function validateNoArgs(
  command: string,
  args: string[],
  locale: AppLocale = "cn",
): void {
  if (args.length > 0) {
    throw new Error(
      text(
        locale,
        `${command} 不需要参数`,
        `${command} does not accept arguments.`,
      ),
    );
  }
}

async function promptInstruction(
  mode: Mode,
  locale: AppLocale,
): Promise<string> {
  console.log(createInteractiveIntro(mode, locale));
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const instruction = (
      await rl.question(text(locale, "需求 > ", "Request > "))
    ).trim();
    if (!instruction) {
      throw new Error(text(locale, "需求不能为空", "Request cannot be empty."));
    }
    return instruction;
  } finally {
    rl.close();
  }
}

function getModelName(args: string[], locale: AppLocale): string {
  const model = args
    .filter((arg) => arg !== "--")
    .join(" ")
    .trim();
  if (!model) {
    throw new Error(
      text(
        locale,
        "请提供模型名：deepseek-v4-pro 或 deepseek-v4-flash",
        "Provide a model name: deepseek-v4-pro or deepseek-v4-flash",
      ),
    );
  }
  return model;
}

function createUsage(locale: AppLocale): string {
  return text(
    locale,
    `用法：
  cn
  en
  login
  list
  model -- deepseek-v4-flash
  model -- deepseek-v4-pro
  preview
  run`,
    `Usage:
  cn
  en
  login
  list
  model -- deepseek-v4-flash
  model -- deepseek-v4-pro
  preview
  run`,
  );
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const locale = readLocale();

  if (command === "locale") {
    const nextLocale = args[0]?.trim().toLowerCase();
    if (!nextLocale || !isSupportedLocale(nextLocale)) {
      throw new Error("语言只支持 cn 或 en");
    }
    setLocale(nextLocale);
    console.log(
      text(
        nextLocale,
        `已切换语言：${localeDisplayName(nextLocale)}`,
        `Language switched: ${localeDisplayName(nextLocale)}`,
      ),
    );
    return;
  }

  if (command === "login") {
    await loginByQrCode(locale);
    return;
  }

  if (command === "list") {
    validateNoArgs("list", args, locale);
    await listPlaylists();
    return;
  }

  if (command === "run") {
    validateInteractiveArgs("run", args, locale);
    await runTask(await promptInstruction("execute", locale), "execute");
    return;
  }

  if (command === "preview") {
    validateInteractiveArgs("preview", args, locale);
    await runTask(await promptInstruction("preview", locale), "preview");
    return;
  }

  if (command === "model") {
    const model = getModelName(args, locale);
    setDeepseekModel(model);
    console.log(
      text(
        locale,
        `已切换 DeepSeek 模型：${model}`,
        `Switched DeepSeek model: ${model}`,
      ),
    );
    return;
  }

  console.log(createUsage(locale));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    const message = getErrorMessage(error);
    const locale = readLocale();
    console.error(text(locale, `执行失败：${message}`, `Failed: ${message}`));
    process.exitCode = 1;
  });
}
