import { createRequire } from "node:module";
import qrcode from "qrcode-terminal";
import { AppLocale, readCookie, readLocale, writeCookie } from "./config.js";
import { text } from "./locale.js";
import { PlaylistSummary, Song } from "./types.js";

const require = createRequire(import.meta.url);
const ncm = require("NeteaseCloudMusicApi") as Record<
  string,
  (params: object) => Promise<NcmResponse>
>;

type NcmResponse = {
  status?: number;
  body: Record<string, unknown>;
  cookie?: string[] | string;
};

type LoginProfile = {
  userId: number;
  nickname?: string;
};

type RawPlaylist = {
  id: number;
  name: string;
  trackCount?: number;
  userId?: number;
  creator?: {
    userId?: number;
  };
};

type RawSong = {
  id: number;
  name: string;
  ar?: Array<{ id?: number; name?: string | null } | null>;
  artists?: Array<{ id?: number; name?: string | null } | null>;
  al?: { name?: string };
  album?: { name?: string };
};

type ApiPolicy = {
  concurrency: number;
  minIntervalMs: number;
  retryDelaysMs: number[];
};

const apiPolicies: Partial<Record<string, ApiPolicy>> = {
  lyric: {
    concurrency: 8,
    minIntervalMs: 80,
    retryDelaysMs: [15_000, 30_000, 60_000],
  },
  song_wiki_summary: {
    concurrency: 3,
    minIntervalMs: 500,
    retryDelaysMs: [30_000, 60_000],
  },
  ugc_song_get: {
    concurrency: 1,
    minIntervalMs: 5_000,
    retryDelaysMs: [60_000],
  },
  playlist_create: {
    concurrency: 1,
    minIntervalMs: 1_000,
    retryDelaysMs: [15_000, 30_000],
  },
  playlist_tracks: {
    concurrency: 1,
    minIntervalMs: 2_500,
    retryDelaysMs: [30_000, 60_000, 120_000],
  },
};

class ApiScheduler {
  private activeCount = 0;

  private nextStartAt = 0;

  private readonly queue: Array<() => void> = [];

  constructor(private readonly policy: ApiPolicy) {}

  run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push(() => {
        this.activeCount += 1;
        const now = Date.now();
        const waitMs = Math.max(0, this.nextStartAt - now);
        this.nextStartAt = now + waitMs + this.policy.minIntervalMs;

        setTimeout(async () => {
          try {
            resolve(await task());
          } catch (error) {
            reject(error);
          } finally {
            this.activeCount -= 1;
            this.drain();
          }
        }, waitMs);
      });

      this.drain();
    });
  }

  private drain(): void {
    while (
      this.activeCount < this.policy.concurrency &&
      this.queue.length > 0
    ) {
      this.queue.shift()?.();
    }
  }
}

const apiSchedulers = new Map<string, ApiScheduler>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getApiScheduler(method: string, policy: ApiPolicy): ApiScheduler {
  const existing = apiSchedulers.get(method);
  if (existing) {
    return existing;
  }

  const scheduler = new ApiScheduler(policy);
  apiSchedulers.set(method, scheduler);
  return scheduler;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getNestedCode(value: unknown): unknown {
  if (!isObject(value)) {
    return undefined;
  }

  if ("code" in value) {
    return value.code;
  }
  if (isObject(value.body)) {
    return getNestedCode(value.body);
  }

  return undefined;
}

function isRateLimited(value: unknown): boolean {
  const code = getNestedCode(value);
  if (code === 405 || code === "405") {
    return true;
  }

  const text =
    value instanceof Error ? value.message : JSON.stringify(value ?? "");
  return text.includes("操作频繁") || text.includes("稍候再试");
}

function summarizeRateLimit(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }
  if (isObject(value) && isObject(value.body)) {
    return JSON.stringify(value.body);
  }
  return JSON.stringify(value);
}

function toSong(raw: RawSong): Song {
  const rawArtists = raw.ar ?? raw.artists ?? [];
  return {
    id: raw.id,
    name: raw.name,
    artists: rawArtists
      .filter(
        (artist): artist is { id?: number; name: string } =>
          typeof artist?.name === "string" && artist.name.length > 0,
      )
      .map((artist) => ({
        id: artist.id,
        name: artist.name,
      })),
    album: raw.al?.name ?? raw.album?.name,
  };
}

function toPlaylist(raw: RawPlaylist): PlaylistSummary {
  return {
    id: raw.id,
    name: raw.name,
    trackCount: raw.trackCount ?? 0,
    userId: raw.userId ?? raw.creator?.userId,
  };
}

async function callApi<T extends NcmResponse>(
  method: string,
  params: Record<string, unknown>,
): Promise<T> {
  const fn = ncm[method];
  const locale = readLocale();
  if (!fn) {
    throw new Error(
      text(
        locale,
        `NeteaseCloudMusicApi 缺少方法：${method}`,
        `NeteaseCloudMusicApi is missing method: ${method}`,
      ),
    );
  }

  const policy = apiPolicies[method];
  const retryCount = policy?.retryDelaysMs.length ?? 0;
  const run = (): Promise<NcmResponse> => {
    if (!policy) {
      return fn(params);
    }

    return getApiScheduler(method, policy).run(() => fn(params));
  };

  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = (await run()) as T;
      if (!isRateLimited(response)) {
        return response;
      }

      const delayMs = policy?.retryDelaysMs[attempt];
      if (delayMs === undefined) {
        throw new Error(
          text(
            locale,
            `网易云接口被限流：${method}，${summarizeRateLimit(response)}`,
            `NetEase API was rate limited: ${method}, ${summarizeRateLimit(response)}`,
          ),
        );
      }

      console.warn(
        text(
          locale,
          `网易云接口限流：${method}，${delayMs / 1000}s 后重试（${attempt + 1}/${retryCount}）`,
          `NetEase API rate limited: ${method}. Retrying after ${delayMs / 1000}s (${attempt + 1}/${retryCount}).`,
        ),
      );
      await sleep(delayMs);
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.startsWith("网易云接口被限流") ||
          error.message.startsWith("NetEase API was rate limited"))
      ) {
        throw error;
      }

      const delayMs = policy?.retryDelaysMs[attempt];
      if (delayMs !== undefined && isRateLimited(error)) {
        console.warn(
          text(
            locale,
            `网易云接口限流：${method}，${delayMs / 1000}s 后重试（${attempt + 1}/${retryCount}）`,
            `NetEase API rate limited: ${method}. Retrying after ${delayMs / 1000}s (${attempt + 1}/${retryCount}).`,
          ),
        );
        await sleep(delayMs);
        continue;
      }

      throw new Error(
        text(
          locale,
          `网易云接口调用失败：${method}`,
          `NetEase API call failed: ${method}`,
        ),
        { cause: error },
      );
    }
  }
}

export async function loginByQrCode(locale: AppLocale = "cn"): Promise<void> {
  const keyResponse = await callApi("login_qr_key", {});
  const key = keyResponse.body.data as { unikey?: string };
  if (!key.unikey) {
    throw new Error(
      text(
        locale,
        "网易云未返回二维码登录 key",
        "NetEase did not return a QR login key.",
      ),
    );
  }

  const qrResponse = await callApi("login_qr_create", {
    key: key.unikey,
  });
  const qrData = qrResponse.body.data as { qrurl?: string };
  if (!qrData.qrurl) {
    throw new Error(
      text(
        locale,
        "网易云未返回二维码链接",
        "NetEase did not return a QR code URL.",
      ),
    );
  }

  console.log(
    text(
      locale,
      "请用网易云音乐手机 App 扫描二维码：",
      "Scan the QR code with the NetEase Cloud Music mobile app:",
    ),
  );
  qrcode.generate(qrData.qrurl, { small: true });

  for (let attempt = 0; attempt < 90; attempt += 1) {
    const checkResponse = await callApi("login_qr_check", {
      key: key.unikey,
      timestamp: Date.now(),
    });
    const code = checkResponse.body.code;

    if (code === 803) {
      const cookie = checkResponse.body.cookie;
      if (typeof cookie !== "string" || !cookie) {
        throw new Error(
          text(
            locale,
            "扫码成功，但网易云未返回 Cookie",
            "Scan succeeded, but NetEase did not return a cookie.",
          ),
        );
      }
      writeCookie(cookie);
      const profile = await getLoginProfile(cookie, locale);
      console.log(
        text(
          locale,
          `登录成功：${profile.nickname ?? profile.userId}`,
          `Login successful: ${profile.nickname ?? profile.userId}`,
        ),
      );
      return;
    }

    if (code === 800) {
      throw new Error(
        text(
          locale,
          "二维码已过期，请重新运行 login",
          "The QR code expired. Run login again.",
        ),
      );
    }

    if (code === 802) {
      console.log(
        text(
          locale,
          "扫码已确认，等待网易云完成登录...",
          "Scan confirmed. Waiting for NetEase to finish login...",
        ),
      );
    }

    await sleep(2000);
  }

  throw new Error(
    text(
      locale,
      "等待扫码超时，请重新运行 login",
      "Timed out waiting for QR scan. Run login again.",
    ),
  );
}

export async function getLoginProfile(
  cookie = readCookie(),
  locale: AppLocale = "cn",
): Promise<LoginProfile> {
  const response = await callApi("login_status", {
    cookie,
    timestamp: Date.now(),
  });
  const data = response.body.data as { profile?: LoginProfile };
  if (!data?.profile?.userId) {
    throw new Error(
      text(
        locale,
        "登录状态无效，请重新运行 login",
        "Login state is invalid. Run login again.",
      ),
    );
  }
  return data.profile;
}

export async function listOwnPlaylists(
  cookie = readCookie(),
  profile?: LoginProfile,
): Promise<PlaylistSummary[]> {
  const resolvedProfile = profile ?? (await getLoginProfile(cookie));
  const playlists: PlaylistSummary[] = [];
  const limit = 100;

  for (let offset = 0; ; offset += limit) {
    const response = await callApi("user_playlist", {
      uid: resolvedProfile.userId,
      limit,
      offset,
      cookie,
      timestamp: Date.now(),
    });

    const rawPlaylists = (response.body.playlist ?? []) as RawPlaylist[];
    playlists.push(
      ...rawPlaylists
        .map(toPlaylist)
        .filter((playlist) => playlist.userId === resolvedProfile.userId),
    );

    if (rawPlaylists.length < limit) {
      break;
    }
  }

  return playlists;
}

export function findPlaylistByName(
  playlists: PlaylistSummary[],
  name: string,
  locale: AppLocale = "cn",
): PlaylistSummary {
  const exact = playlists.filter((playlist) => playlist.name === name);
  if (exact.length === 1) {
    return exact[0];
  }
  if (exact.length > 1) {
    throw new Error(
      text(
        locale,
        `找到多个同名歌单：${name}`,
        `Found multiple playlists with the same name: ${name}`,
      ),
    );
  }

  const scored = playlists
    .map((playlist) => ({
      playlist,
      score: scorePlaylistNameMatch(playlist.name, name),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);

  if (scored.length > 0) {
    const best = scored[0];
    const tied = scored.filter((item) => item.score === best.score);
    if (tied.length === 1) {
      return best.playlist;
    }

    throw new Error(
      text(
        locale,
        `找到多个相近歌单：${tied.map((item) => item.playlist.name).join("、")}`,
        `Found multiple similar playlists: ${tied.map((item) => item.playlist.name).join(", ")}`,
      ),
    );
  }

  const visibleNames = playlists
    .slice(0, 20)
    .map((playlist) => playlist.name)
    .join("、");
  throw new Error(
    text(
      locale,
      `未找到歌单：${name}。当前可见歌单示例：${visibleNames}`,
      `Playlist not found: ${name}. Visible playlist examples: ${visibleNames}`,
    ),
  );
}

function normalizePlaylistName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[《》「」『』"“”'‘’\s，,。.!！?？：:、]/g, "")
    .replace(/^(把|从|将)/, "")
    .replace(/^(我|我的)/, "")
    .replace(/(这个|这张|该)?歌单(中|里|里面|内|中的|里的)?/g, "")
    .trim();
}

function scorePlaylistNameMatch(playlistName: string, query: string): number {
  const normalizedPlaylistName = normalizePlaylistName(playlistName);
  const normalizedQuery = normalizePlaylistName(query);

  if (!normalizedPlaylistName || !normalizedQuery) {
    return 0;
  }

  if (playlistName === query) {
    return 1000;
  }
  if (normalizedPlaylistName === normalizedQuery) {
    return 900;
  }
  if (query.includes(playlistName)) {
    return 800 + playlistName.length;
  }
  if (normalizedQuery.includes(normalizedPlaylistName)) {
    return 700 + normalizedPlaylistName.length;
  }
  if (playlistName.includes(query)) {
    return 600 + query.length;
  }
  if (normalizedPlaylistName.includes(normalizedQuery)) {
    return 500 + normalizedQuery.length;
  }

  return 0;
}

export async function getPlaylistSongs(
  playlistId: number,
  cookie = readCookie(),
): Promise<Song[]> {
  const songs: Song[] = [];
  const limit = 1000;

  for (let offset = 0; ; offset += limit) {
    const response = await callApi("playlist_track_all", {
      id: playlistId,
      limit,
      offset,
      cookie,
      timestamp: Date.now(),
    });

    const rawSongs = (response.body.songs ?? []) as RawSong[];
    songs.push(...rawSongs.map(toSong));

    if (rawSongs.length < limit) {
      break;
    }
  }

  return songs;
}

export async function getLyric(
  songId: number,
  cookie = readCookie(),
): Promise<string | undefined> {
  const response = await callApi("lyric", {
    id: songId,
    cookie,
    timestamp: Date.now(),
  });
  const lrc = response.body.lrc as { lyric?: string } | undefined;
  return lrc?.lyric;
}

export async function getSongWikiSummary(
  songId: number,
  cookie = readCookie(),
): Promise<unknown> {
  const response = await callApi("song_wiki_summary", {
    id: songId,
    cookie,
    timestamp: Date.now(),
  });
  return response.body;
}

export async function getSongUgcSummary(
  songId: number,
  cookie = readCookie(),
): Promise<unknown> {
  const response = await callApi("ugc_song_get", {
    id: songId,
    cookie,
    timestamp: Date.now(),
  });
  return response.body;
}

export async function createPlaylist(
  name: string,
  cookie = readCookie(),
  locale: AppLocale = "cn",
): Promise<PlaylistSummary> {
  const response = await callApi("playlist_create", {
    name,
    privacy: "0",
    cookie,
    timestamp: Date.now(),
  });

  const playlist = response.body.playlist as RawPlaylist | undefined;
  if (!playlist?.id) {
    throw new Error(
      text(
        locale,
        `创建歌单失败：${JSON.stringify(response.body)}`,
        `Failed to create playlist: ${JSON.stringify(response.body)}`,
      ),
    );
  }

  return toPlaylist(playlist);
}

export async function addSongsToPlaylist(
  playlistId: number,
  songIds: number[],
  cookie = readCookie(),
  locale: AppLocale = "cn",
): Promise<void> {
  const chunkSize = 200;
  for (let index = 0; index < songIds.length; index += chunkSize) {
    const chunk = songIds.slice(index, index + chunkSize);
    const response = await callApi("playlist_tracks", {
      op: "add",
      pid: playlistId,
      tracks: chunk.join(","),
      cookie,
      timestamp: Date.now(),
    });
    const code =
      response.body.code ??
      (response.body.body as { code?: unknown } | undefined)?.code;
    if (code !== 200) {
      throw new Error(
        text(
          locale,
          `添加歌曲失败：${JSON.stringify(response.body)}`,
          `Failed to add tracks: ${JSON.stringify(response.body)}`,
        ),
      );
    }
  }
}

export function getSongDisplay(song: Song, locale: AppLocale = "cn"): string {
  const artists =
    song.artists
      .map((artist) => artist.name)
      .filter((name) => typeof name === "string" && name.length > 0)
      .join("/") || text(locale, "未知歌手", "Unknown artist");
  return `${song.name} - ${artists}`;
}
