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
import { computePlaylistDiff } from "./playlist-diff.js";
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
import {
  CreatePlaylistFromFilterTask,
  DiffSong,
  MatchedSong,
  PlaylistDiffTask,
  PlaylistSummary,
  PlaylistTask,
  Song,
} from "./types.js";
import { createDeepseekSemanticMatcher } from "./semantic.js";
import { displayWidth, formatTable } from "./table.js";

type Mode = "execute" | "preview";

type TerminalProgress = {
  update: (message: string) => void;
  finish: () => void;
  clear: () => void;
  elapsed: () => string;
  warn: (message: string) => void;
};

const introAnsi = {
  reset: "\u001b[0m",
  brightWhite: "\u001b[97m",
  mutedGray: "\u001b[90m",
  logoBg: "\u001b[101m",
  borderRed: "\u001b[38;2;220;72;82m",
  modeBlue: "\u001b[94m",
  modeGreen: "\u001b[92m",
} as const;

const ansiPattern = /\u001b\[[0-9;]*m/g;
const introContentWidth = 56;

function stripAnsi(value: string): string {
  return value.replace(ansiPattern, "");
}

function colorModeValue(mode: Mode, value: string): string {
  const color = mode === "preview" ? introAnsi.modeBlue : introAnsi.modeGreen;
  return `${color}${value}${introAnsi.reset}`;
}

function colorLabel(value: string): string {
  return `${introAnsi.mutedGray}${value}${introAnsi.reset}`;
}

function colorBorder(value: string): string {
  return `${introAnsi.borderRed}${value}${introAnsi.reset}`;
}

function wrapDisplayText(value: string, maxWidth: number): string[] {
  if (value.includes(" ")) {
    const lines: string[] = [];
    let current = "";

    for (const word of value.split(" ")) {
      const next = current ? `${current} ${word}` : word;
      if (current && displayWidth(next) > maxWidth) {
        lines.push(current);
        current = word;
      } else {
        current = next;
      }
    }

    if (current) {
      lines.push(current);
    }

    return lines;
  }

  const lines: string[] = [];
  let current = "";
  let currentWidth = 0;

  for (const char of Array.from(value)) {
    const charWidth = displayWidth(char);
    if (currentWidth > 0 && currentWidth + charWidth > maxWidth) {
      lines.push(current);
      current = "";
      currentWidth = 0;
    }
    current += char;
    currentWidth += charWidth;
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}

function formatIntroField(label: string, value: string): string[] {
  const labelWidth = displayWidth(label);
  const prefix = `${colorLabel(label)} `;
  const continuationPrefix = " ".repeat(labelWidth + 1);
  const wrapped = wrapDisplayText(value, introContentWidth - labelWidth - 1);

  return wrapped.map((line, index) => {
    return `${index === 0 ? prefix : continuationPrefix}${line}`;
  });
}

function createSoftNeteaseFrame(lines: string[]): string {
  const borderChar = "│";
  const borderColWidth = displayWidth(borderChar);
  const hChar = "─";
  const hCharColWidth = displayWidth(hChar);
  const cornerColWidth = displayWidth("╭");
  const leftPadCols = 2;

  const contentMaxCols = Math.max(
    introContentWidth,
    ...lines.map((line) => displayWidth(stripAnsi(line))),
  );

  const frameCols =
    borderColWidth + leftPadCols + contentMaxCols + borderColWidth;
  const hCount = Math.round((frameCols - 2 * cornerColWidth) / hCharColWidth);

  const top = colorBorder(`╭${hChar.repeat(hCount)}╮`);
  const bottom = colorBorder(`╰${hChar.repeat(hCount)}╯`);
  const vertical = colorBorder(borderChar);

  const framedLines = lines.map((line) => {
    const rightPadCols = contentMaxCols - displayWidth(stripAnsi(line));
    const rightPadding = " ".repeat(Math.max(0, rightPadCols));
    return `${vertical}  ${line}${rightPadding}${vertical}`;
  });

  return [top, ...framedLines, bottom].join("\n");
}

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
      {
        header: text(locale, "歌曲", "Track"),
        value: (row) => row.name,
        maxWidth: locale === "cn" ? 30 : undefined,
      },
      {
        header: text(locale, "歌手", "Artists"),
        value: (row) => row.artists,
        maxWidth: locale === "cn" ? 28 : undefined,
      },
      {
        header: text(locale, "理由", "Reason"),
        value: (row) => row.reason,
        maxWidth: locale === "cn" ? 48 : 72,
      },
    ],
  );
}

export function formatDiffSongsTable(
  songs: DiffSong[],
  locale: AppLocale = "cn",
): string[] {
  const indexWidth = String(songs.length).length;
  return formatTable(
    songs.map((song, index) => ({
      index: String(index + 1).padStart(Math.max(2, indexWidth), "0"),
      sourceIndex: String(song.sourceIndex),
      id: String(song.id),
      name: song.name,
      artists: getArtistsDisplay(song, locale),
    })),
    [
      { header: text(locale, "序号", "No."), value: (row) => row.index },
      {
        header: text(locale, "源序号", "Source No."),
        value: (row) => row.sourceIndex,
      },
      {
        header: text(locale, "歌曲", "Track"),
        value: (row) => row.name,
        maxWidth: locale === "cn" ? 34 : undefined,
      },
      {
        header: text(locale, "歌手", "Artists"),
        value: (row) => row.artists,
        maxWidth: locale === "cn" ? 28 : undefined,
      },
      { header: "ID", value: (row) => row.id },
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

export function applyTaskLimit<T>(
  items: T[],
  task: CreatePlaylistFromFilterTask,
): T[] {
  return task.limit === undefined ? items : items.slice(0, task.limit);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function truncateByDisplayWidth(value: string, maxWidth: number): string {
  if (maxWidth <= 0 || displayWidth(value) <= maxWidth) {
    return value;
  }

  const marker = "...";
  const contentWidth = Math.max(0, maxWidth - displayWidth(marker));
  let output = "";
  let outputWidth = 0;

  for (const character of value) {
    const characterWidth = displayWidth(character);
    if (outputWidth + characterWidth > contentWidth) {
      break;
    }

    output += character;
    outputWidth += characterWidth;
  }

  return `${output}${marker}`;
}

export function formatTerminalProgressLine(
  message: string,
  locale: AppLocale,
  elapsed: string,
  columns: number,
): string {
  const normalizedMessage = message.replace(/\r?\n/g, " ");
  const suffix = text(locale, `，耗时 ${elapsed}`, `, elapsed ${elapsed}`);
  const maxWidth = Math.max(1, columns);
  const messageWidth = maxWidth - displayWidth(suffix);

  if (messageWidth <= 0) {
    return truncateByDisplayWidth(`${normalizedMessage}${suffix}`, maxWidth);
  }

  return `${truncateByDisplayWidth(normalizedMessage, messageWidth)}${suffix}`;
}

export function formatDeepseekParseProgressMessage(locale: AppLocale): string {
  return text(
    locale,
    "（正在调用 DeepSeek 解析需求，最多等待 30 秒...）",
    "Calling DeepSeek to parse the request. Waiting up to 30 seconds...",
  );
}

export function createTerminalProgress(): TerminalProgress {
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

  const clear = (): void => {
    if (!active) {
      return;
    }

    if (process.stdout.isTTY) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
    }
    active = false;
  };

  const render = (message: string): void => {
    const locale = readLocale();
    const singleLine = formatTerminalProgressLine(
      message,
      locale,
      elapsed(),
      process.stdout.columns ?? 80,
    );
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
    clear,
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
  const parseProgress = createTerminalProgress();
  parseProgress.update(formatDeepseekParseProgressMessage(config.locale));
  let task: PlaylistTask;
  try {
    task = await parseInstruction(
      instruction,
      config,
      playlists.map((playlist) => playlist.name),
    );
  } catch (error) {
    parseProgress.finish();
    throw error;
  }
  parseProgress.clear();

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
  const source = findPlaylistForTask(
    playlists,
    task.sourcePlaylistName,
    "source",
    config.locale,
  );

  if (task.type === "playlist_diff") {
    await executePlaylistDiffTask(task, cookie, mode, playlists, source);
    return;
  }

  await executeFilterTask(task, cookie, mode, playlists, source);
}

function findPlaylistForTask(
  playlists: PlaylistSummary[],
  name: string,
  role: "source" | "target",
  locale: AppLocale,
): PlaylistSummary {
  try {
    return findPlaylistByName(playlists, name, locale);
  } catch (error) {
    const roleLabel = text(
      locale,
      role === "source" ? "源歌单" : "目标歌单",
      role === "source" ? "source playlist" : "target playlist",
    );
    throw new Error(
      text(
        locale,
        `未找到${roleLabel}或${roleLabel}不唯一：${name}。${getErrorMessage(error)}`,
        `Could not resolve ${roleLabel}: ${name}. ${getErrorMessage(error)}`,
      ),
      { cause: error },
    );
  }
}

async function executeFilterTask(
  task: CreatePlaylistFromFilterTask,
  cookie: string,
  mode: Mode,
  playlists: PlaylistSummary[],
  source: PlaylistSummary,
): Promise<void> {
  const config = loadConfig();
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
    if (
      previewCache?.taskType === "create_playlist_from_filter" &&
      previewCache.matchedSongs.length > 0
    ) {
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

  const selected = applyTaskLimit(matched, task);
  console.log(
    text(
      config.locale,
      `匹配歌曲：${selected.length}`,
      `Matched tracks: ${selected.length}`,
    ),
  );
  console.log("");
  for (const line of formatMatchedSongsTable(selected, config.locale)) {
    console.log(line);
  }

  if (mode === "preview") {
    savePreviewCache(config, {
      taskType: "create_playlist_from_filter",
      sourcePlaylistId: source.id,
      sourcePlaylistName: task.sourcePlaylistName,
      targetPlaylistName: task.targetPlaylistName,
      limit: task.limit,
      filter: task.filter,
      matchedSongs: selected,
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
    selected.map((song) => song.id),
    cookie,
    config.locale,
  );

  console.log(
    text(
      config.locale,
      `已创建歌单并添加歌曲：${target.name}，共 ${selected.length} 首`,
      `Created playlist and added tracks: ${target.name}, ${selected.length} total`,
    ),
  );
}

async function executePlaylistDiffTask(
  task: PlaylistDiffTask,
  cookie: string,
  mode: Mode,
  playlists: PlaylistSummary[],
  source: PlaylistSummary,
): Promise<void> {
  const config = loadConfig();
  const target = findPlaylistForTask(
    playlists,
    task.targetPlaylistName,
    "target",
    config.locale,
  );

  if (mode === "execute") {
    const previewCache = readMatchingPreviewCache(
      config,
      task,
      source.id,
      target.id,
    );
    if (previewCache?.taskType === "playlist_diff") {
      console.log(
        text(
          config.locale,
          `使用上次预览结果：缺失 ${previewCache.missingSongs.length} 首，预览时间：${previewCache.createdAt}`,
          `Using last preview result: ${previewCache.missingSongs.length} missing tracks, preview time: ${previewCache.createdAt}`,
        ),
      );
      await addMissingSongsFromDiffCache(
        previewCache.missingSongs,
        target,
        cookie,
      );
      return;
    }
  }

  const { sourceSongs, targetSongs, missingSongs, extraSongCount } =
    await previewPlaylistDiff(task, cookie, source, target);

  if (mode === "preview") {
    savePreviewCache(config, {
      taskType: "playlist_diff",
      sourcePlaylistId: source.id,
      sourcePlaylistName: source.name,
      targetPlaylistId: target.id,
      targetPlaylistName: target.name,
      sourceTrackCount: sourceSongs.length,
      targetTrackCount: targetSongs.length,
      missingSongs,
      extraSongCount,
    });
    console.log(
      text(
        config.locale,
        "预览完成，未添加歌曲",
        "Preview complete. No tracks were added.",
      ),
    );
    return;
  }

  await addMissingSongsFromDiffCache(missingSongs, target, cookie);
}

async function previewPlaylistDiff(
  task: PlaylistDiffTask,
  cookie: string,
  source: PlaylistSummary,
  target: PlaylistSummary,
): Promise<{
  sourceSongs: Song[];
  targetSongs: Song[];
  missingSongs: DiffSong[];
  extraSongCount: number;
}> {
  const config = loadConfig();
  console.log(
    text(
      config.locale,
      `源歌单：${source.name}，歌曲数：${source.trackCount}`,
      `Source playlist: ${source.name}, tracks: ${source.trackCount}`,
    ),
  );
  console.log(
    text(
      config.locale,
      `目标歌单：${target.name}，歌曲数：${target.trackCount}`,
      `Target playlist: ${target.name}, tracks: ${target.trackCount}`,
    ),
  );

  const [sourceSongs, targetSongs] = await Promise.all([
    getPlaylistSongs(source.id, cookie),
    getPlaylistSongs(target.id, cookie),
  ]);
  const diff = computePlaylistDiff(sourceSongs, targetSongs);

  console.log(
    text(
      config.locale,
      `源歌单实际读取：${sourceSongs.length} 首`,
      `Source playlist read: ${sourceSongs.length} tracks`,
    ),
  );
  console.log(
    text(
      config.locale,
      `目标歌单实际读取：${targetSongs.length} 首`,
      `Target playlist read: ${targetSongs.length} tracks`,
    ),
  );
  console.log(
    text(
      config.locale,
      `缺失歌曲：${diff.missingSongs.length} 首`,
      `Missing tracks: ${diff.missingSongs.length}`,
    ),
  );
  if (diff.extraSongs.length > 0) {
    console.log(
      text(
        config.locale,
        `目标歌单中有 ${diff.extraSongs.length} 首额外歌曲，已保留`,
        `Target playlist has ${diff.extraSongs.length} extra tracks. They were kept.`,
      ),
    );
  }

  if (diff.missingSongs.length === 0) {
    console.log(
      text(
        config.locale,
        "目标歌单已完整，无需添加",
        "Target playlist is already complete. No tracks need to be added.",
      ),
    );
  } else {
    console.log("");
    for (const line of formatDiffSongsTable(diff.missingSongs, config.locale)) {
      console.log(line);
    }
  }

  return {
    sourceSongs,
    targetSongs,
    missingSongs: diff.missingSongs,
    extraSongCount: diff.extraSongs.length,
  };
}

async function addMissingSongsFromDiffCache(
  missingSongs: DiffSong[],
  target: PlaylistSummary,
  cookie: string,
): Promise<void> {
  const config = loadConfig();

  if (missingSongs.length === 0) {
    console.log(
      text(
        config.locale,
        "目标歌单已完整，无需添加",
        "Target playlist is already complete. No tracks need to be added.",
      ),
    );
    return;
  }

  await addSongsToPlaylist(
    target.id,
    missingSongs.map((song) => song.id),
    cookie,
    config.locale,
  );

  console.log(
    text(
      config.locale,
      `已添加 ${missingSongs.length} 首歌曲到“${target.name}”。目标歌单当前共 ${target.trackCount + missingSongs.length} 首。`,
      `Added ${missingSongs.length} tracks to "${target.name}". Target playlist now has ${target.trackCount + missingSongs.length} tracks.`,
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
  model = "deepseek-v4-flash",
): string {
  const logo = `${introAnsi.logoBg}${introAnsi.brightWhite} ◎ ${introAnsi.reset}`;
  const title = `${logo} ${introAnsi.brightWhite}Netease Playlist Assistant v1.10${introAnsi.reset}`;
  const modeText =
    locale === "en"
      ? mode === "preview"
        ? "preview"
        : "run"
      : mode === "preview"
        ? "预览"
        : "执行";
  const hint =
    locale === "en"
      ? mode === "preview"
        ? "new: source playlist, filter, new target playlist"
        : "new: reuse preview, then create the target playlist"
      : mode === "preview"
        ? "新建：源歌单、筛选条件、目标新歌单名"
        : "新建：复用预览，再创建目标歌单";
  const diffHint =
    locale === "en"
      ? mode === "preview"
        ? "complete: source playlist, existing target playlist"
        : "complete: reuse preview, then add missing tracks"
      : mode === "preview"
        ? "补全：源歌单、目标已有歌单名"
        : "补全：复用预览，再添加缺失歌曲";
  const example =
    locale === "en"
      ? "new: Find all Cantonese songs in playlist xx, list them, then add them to a new playlist named Cantonese Picks"
      : "新建：帮我在xx这个歌单中找到所有粤语歌曲并列出来，然后添加进一个新建歌单中，叫做粤语精选";
  const diffExample =
    locale === "en"
      ? 'complete: List tracks in "Cantonese Picks" that are missing from "Cantonese Memory", then add them to "Cantonese Memory"'
      : "补全：把“粤语精选”中“粤语记忆”没有的歌列出来，并添加到“粤语记忆”";
  const lines =
    locale === "en"
      ? [
          title,
          ...formatIntroField("mode:", colorModeValue(mode, modeText)),
          ...formatIntroField("model:", model),
          "",
          ...formatIntroField("request:", hint),
          ...formatIntroField("", diffHint),
          ...formatIntroField("example:", example),
          ...formatIntroField("", diffExample),
        ]
      : [
          title,
          ...formatIntroField("模式：", colorModeValue(mode, modeText)),
          ...formatIntroField("模型：", model),
          "",
          ...formatIntroField("需求：", hint),
          ...formatIntroField("", diffHint),
          ...formatIntroField("示例：", example),
          ...formatIntroField("", diffExample),
        ];

  return createSoftNeteaseFrame(
    lines.filter((line, index) => {
      return line !== "" || lines[index - 1] !== "";
    }),
  );
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
  const config = loadConfig();
  console.log(createInteractiveIntro(mode, locale, config.deepseekModel));
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
