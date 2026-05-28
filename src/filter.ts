import { AppLocale } from "./config.js";
import { text } from "./locale.js";
import { MatchedSong, PlaylistTask, Song } from "./types.js";

const artistAliases = new Map<string, string[]>([
  ["贾斯汀比伯", ["贾斯汀比伯", "justin bieber", "bieber", "justin"]],
  ["jb", ["justin bieber", "bieber", "jb"]],
]);

export function matchesArtist(
  song: Song,
  artistQuery: string,
  locale: AppLocale = "cn",
): MatchedSong | null {
  const query = artistQuery.trim().toLowerCase();
  const aliases = artistAliases.get(query) ?? [query];
  const artistNames = song.artists
    .map((artist) => artist.name)
    .filter(
      (name): name is string => typeof name === "string" && name.length > 0,
    )
    .map((name) => name.toLowerCase());

  const matchedAlias = aliases.find((alias) =>
    artistNames.some((artistName) => artistName.includes(alias.toLowerCase())),
  );

  if (!matchedAlias) {
    return null;
  }

  return {
    ...song,
    reason: text(
      locale,
      `歌手匹配：${matchedAlias}`,
      `Artist match: ${matchedAlias}`,
    ),
  };
}

export type FilterProgress = {
  processed: number;
  total: number;
  matched: number;
  phase?: "lyrics" | "metadata" | "semantic" | "final";
  message?: string;
};

export type SemanticProgressDetails = {
  total?: number;
  phase?: FilterProgress["phase"];
  message?: string;
  force?: boolean;
};

export type SemanticMatcherInput = {
  songs: Song[];
  task: PlaylistTask;
  getLyric: (songId: number) => Promise<string | undefined>;
  onProgress: (
    processed: number,
    matched: number,
    details?: SemanticProgressDetails,
  ) => void;
  onLyricError?: (event: { song: Song; error: unknown }) => void;
};

export type FilterSongsOptions = {
  locale?: AppLocale;
  onProgress?: (event: FilterProgress) => void;
  progressInterval?: number;
  onLyricError?: (event: { song: Song; error: unknown }) => void;
  semanticMatcher?: (input: SemanticMatcherInput) => Promise<MatchedSong[]>;
};

export async function filterSongs(
  songs: Song[],
  task: PlaylistTask,
  getLyric: (songId: number) => Promise<string | undefined>,
  options: FilterSongsOptions = {},
): Promise<MatchedSong[]> {
  const matched: MatchedSong[] = [];
  const locale = options.locale ?? "cn";
  const progressInterval = options.progressInterval ?? 25;

  const reportProgress = (
    processed: number,
    matchedCount = matched.length,
    details: SemanticProgressDetails = {},
  ): void => {
    if (!options.onProgress) {
      return;
    }

    const total = details.total ?? songs.length;
    if (
      !details.force &&
      processed % progressInterval !== 0 &&
      processed !== total
    ) {
      return;
    }

    const event: FilterProgress = {
      processed,
      total,
      matched: matchedCount,
    };
    if (details.phase) {
      event.phase = details.phase;
    }
    if (details.message) {
      event.message = details.message;
    }

    options.onProgress(event);
  };

  if (task.filter.type !== "artist") {
    if (!options.semanticMatcher) {
      throw new Error(
        text(
          locale,
          `语义筛选器未配置，无法处理：${task.filter.type}`,
          `Semantic matcher is not configured for ${task.filter.type}.`,
        ),
      );
    }

    let lastProgress = 0;
    const semanticMatched = await options.semanticMatcher({
      songs,
      task,
      getLyric,
      onLyricError: options.onLyricError,
      onProgress: (processed, matchedCount, details) => {
        lastProgress = processed;
        reportProgress(processed, matchedCount, details);
      },
    });

    if (lastProgress < songs.length) {
      reportProgress(songs.length, semanticMatched.length, {
        phase: "final",
        force: true,
      });
    }

    return semanticMatched;
  }

  for (const [index, song] of songs.entries()) {
    const artistMatch = matchesArtist(song, task.filter.value, locale);
    if (artistMatch) {
      matched.push(artistMatch);
    }
    reportProgress(index + 1);
  }

  return matched;
}
