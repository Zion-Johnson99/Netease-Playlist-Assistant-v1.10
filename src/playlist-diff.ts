import { DiffSong, Song } from "./types.js";

export type PlaylistDiffResult = {
  missingSongs: DiffSong[];
  extraSongs: Song[];
};

export function computePlaylistDiff(
  sourceSongs: Song[],
  targetSongs: Song[],
): PlaylistDiffResult {
  const targetSongIds = new Set(targetSongs.map((song) => song.id));
  const sourceSongIds = new Set(sourceSongs.map((song) => song.id));
  const seenSourceSongIds = new Set<number>();
  const seenTargetSongIds = new Set<number>();
  const missingSongs: DiffSong[] = [];
  const extraSongs: Song[] = [];

  for (const [index, song] of sourceSongs.entries()) {
    if (seenSourceSongIds.has(song.id)) {
      continue;
    }

    seenSourceSongIds.add(song.id);
    if (!targetSongIds.has(song.id)) {
      missingSongs.push({
        ...song,
        sourceIndex: index + 1,
        status: "missing",
      });
    }
  }

  for (const song of targetSongs) {
    if (seenTargetSongIds.has(song.id)) {
      continue;
    }

    seenTargetSongIds.add(song.id);
    if (!sourceSongIds.has(song.id)) {
      extraSongs.push(song);
    }
  }

  return {
    missingSongs,
    extraSongs,
  };
}
