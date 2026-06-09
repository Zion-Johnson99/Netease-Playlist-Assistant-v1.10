import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AppConfig, AppLocale, ensureDataDir } from "./config.js";
import { CreatePlaylistFromFilterTask, Song } from "./types.js";

const cacheVersion = 2;

export type CachedSemanticMetadata = {
  text: string;
  updatedAt: string;
};

export type CachedSemanticDecision = {
  matched: boolean;
  confidence: number;
  reason: string;
  tags: string[];
  updatedAt: string;
};

type SemanticCacheFile = {
  version: typeof cacheVersion;
  lyrics: Record<string, CachedSemanticMetadata>;
  metadata: Record<string, CachedSemanticMetadata>;
  decisions: Record<string, CachedSemanticDecision>;
};

function createEmptyCache(): SemanticCacheFile {
  return {
    version: cacheVersion,
    lyrics: {},
    metadata: {},
    decisions: {},
  };
}

function getCachePath(config: AppConfig): string {
  return path.join(config.localeDataDir, "semantic-cache.json");
}

function hashText(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function getSongIdentityText(song: Song): string {
  return JSON.stringify({
    id: song.id,
    name: song.name,
    artists: song.artists.map((artist) => artist.name),
    album: song.album,
  });
}

export function createSemanticDecisionKey(
  locale: AppLocale,
  task: CreatePlaylistFromFilterTask,
  song: Song,
  metadataText: string,
): string {
  return hashText(
    JSON.stringify({
      locale,
      filter: task.filter,
      song: getSongIdentityText(song),
      metadataHash: hashText(metadataText),
    }),
  );
}

export class SemanticCache {
  private cache: SemanticCacheFile;

  private readonly cachePath: string;

  constructor(private readonly config: AppConfig) {
    this.cachePath = getCachePath(config);
    this.cache = this.read();
  }

  getMetadata(songId: number): CachedSemanticMetadata | undefined {
    return this.cache.metadata[String(songId)];
  }

  getLyric(songId: number): CachedSemanticMetadata | undefined {
    return this.cache.lyrics[String(songId)];
  }

  setLyric(songId: number, text: string): void {
    this.cache.lyrics[String(songId)] = {
      text,
      updatedAt: new Date().toISOString(),
    };
  }

  setMetadata(songId: number, text: string): void {
    this.cache.metadata[String(songId)] = {
      text,
      updatedAt: new Date().toISOString(),
    };
  }

  getDecision(key: string): CachedSemanticDecision | undefined {
    return this.cache.decisions[key];
  }

  setDecision(
    key: string,
    decision: Omit<CachedSemanticDecision, "updatedAt">,
  ): void {
    this.cache.decisions[key] = {
      ...decision,
      updatedAt: new Date().toISOString(),
    };
  }

  save(): void {
    ensureDataDir(this.config);
    fs.writeFileSync(
      this.cachePath,
      JSON.stringify(this.cache, null, 2),
      "utf8",
    );
  }

  private read(): SemanticCacheFile {
    if (!fs.existsSync(this.cachePath)) {
      return createEmptyCache();
    }

    const cache = JSON.parse(
      fs.readFileSync(this.cachePath, "utf8"),
    ) as SemanticCacheFile;
    if (cache.version !== cacheVersion) {
      return createEmptyCache();
    }

    return cache;
  }
}
