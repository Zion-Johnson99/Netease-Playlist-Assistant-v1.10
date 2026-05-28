import fs from "node:fs";
import path from "node:path";
import { AppConfig, AppLocale, ensureDataDir } from "./config.js";
import { MatchedSong, PlaylistTask } from "./types.js";

export type PreviewCache = {
  locale: AppLocale;
  sourcePlaylistId: number;
  sourcePlaylistName: string;
  targetPlaylistName: string;
  limit?: number;
  filter: PlaylistTask["filter"];
  matchedSongs: MatchedSong[];
  createdAt: string;
};

function getPreviewCachePath(config: AppConfig): string {
  return path.join(config.localeDataDir, "last-preview.json");
}

function isSameFilter(
  left: PlaylistTask["filter"],
  right: PlaylistTask["filter"],
): boolean {
  return left.type === right.type && left.value === right.value;
}

export function savePreviewCache(
  config: AppConfig,
  cache: Omit<PreviewCache, "createdAt" | "locale">,
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
): PreviewCache | null {
  const cachePath = getPreviewCachePath(config);
  if (!fs.existsSync(cachePath)) {
    return null;
  }

  const cache = JSON.parse(fs.readFileSync(cachePath, "utf8")) as PreviewCache;
  if (
    cache.sourcePlaylistId !== sourcePlaylistId ||
    cache.locale !== config.locale ||
    cache.sourcePlaylistName !== task.sourcePlaylistName ||
    cache.targetPlaylistName !== task.targetPlaylistName ||
    cache.limit !== task.limit ||
    !isSameFilter(cache.filter, task.filter)
  ) {
    return null;
  }

  return cache;
}
