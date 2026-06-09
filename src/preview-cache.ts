import fs from "node:fs";
import path from "node:path";
import { AppConfig, AppLocale, ensureDataDir } from "./config.js";
import {
  CreatePlaylistFromFilterTask,
  DiffSong,
  MatchedSong,
  PlaylistTask,
} from "./types.js";

type BasePreviewCache = {
  locale: AppLocale;
  taskType: PlaylistTask["type"];
  sourcePlaylistId: number;
  sourcePlaylistName: string;
  targetPlaylistName: string;
  createdAt: string;
};

export type FilterPreviewCache = BasePreviewCache & {
  taskType: "create_playlist_from_filter";
  limit?: number;
  filter: CreatePlaylistFromFilterTask["filter"];
  matchedSongs: MatchedSong[];
};

export type DiffPreviewCache = BasePreviewCache & {
  taskType: "playlist_diff";
  targetPlaylistId: number;
  sourceTrackCount: number;
  targetTrackCount: number;
  missingSongs: DiffSong[];
  extraSongCount: number;
};

export type PreviewCache = FilterPreviewCache | DiffPreviewCache;

type NewPreviewCache =
  | Omit<FilterPreviewCache, "createdAt" | "locale">
  | Omit<DiffPreviewCache, "createdAt" | "locale">;

function getPreviewCachePath(config: AppConfig): string {
  return path.join(config.localeDataDir, "last-preview.json");
}

function isSameFilter(
  left: CreatePlaylistFromFilterTask["filter"],
  right: CreatePlaylistFromFilterTask["filter"],
): boolean {
  return left.type === right.type && left.value === right.value;
}

export function savePreviewCache(
  config: AppConfig,
  cache: NewPreviewCache,
): void {
  ensureDataDir(config);
  fs.writeFileSync(
    getPreviewCachePath(config),
    JSON.stringify(
      {
        ...cache,
        locale: config.locale,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );
}

export function readMatchingPreviewCache(
  config: AppConfig,
  task: PlaylistTask,
  sourcePlaylistId: number,
  targetPlaylistId?: number,
): PreviewCache | null {
  const cachePath = getPreviewCachePath(config);
  if (!fs.existsSync(cachePath)) {
    return null;
  }

  const cache = JSON.parse(fs.readFileSync(cachePath, "utf8")) as PreviewCache;
  if (
    cache.taskType !== task.type ||
    cache.sourcePlaylistId !== sourcePlaylistId ||
    cache.locale !== config.locale ||
    cache.sourcePlaylistName !== task.sourcePlaylistName ||
    cache.targetPlaylistName !== task.targetPlaylistName
  ) {
    return null;
  }

  if (task.type === "create_playlist_from_filter") {
    if (
      cache.taskType !== "create_playlist_from_filter" ||
      cache.limit !== task.limit ||
      !isSameFilter(cache.filter, task.filter)
    ) {
      return null;
    }

    return cache;
  }

  if (
    cache.taskType !== "playlist_diff" ||
    cache.targetPlaylistId !== targetPlaylistId
  ) {
    return null;
  }

  return cache;
}
