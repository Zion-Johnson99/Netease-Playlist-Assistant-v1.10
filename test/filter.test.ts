import assert from "node:assert/strict";
import test from "node:test";
import { filterSongs, matchesArtist } from "../src/filter.js";
import { PlaylistTask, Song } from "../src/types.js";

const justinSong: Song = {
  id: 1,
  name: "Baby",
  artists: [{ name: "Justin Bieber" }],
};

const easonSong: Song = {
  id: 2,
  name: "富士山下",
  artists: [{ name: "陈奕迅" }],
};

const lyricSong: Song = {
  id: 3,
  name: "测试粤语歌",
  artists: [{ name: "未知歌手" }],
};

test("matches artist aliases for Justin Bieber", () => {
  const matched = matchesArtist(justinSong, "贾斯汀比伯");
  assert.equal(matched?.id, 1);
});

test("matches artist names without separators", () => {
  const matched = matchesArtist(justinSong, "justinbieber");
  assert.equal(matched?.id, 1);
});

test("filters songs by artist task", async () => {
  const task: PlaylistTask = {
    sourcePlaylistName: "A",
    targetPlaylistName: "JB",
    filter: {
      type: "artist",
      value: "贾斯汀比伯",
    },
  };
  const matched = await filterSongs(
    [justinSong, easonSong],
    task,
    async () => undefined,
  );
  assert.deepEqual(
    matched.map((song) => song.id),
    [1],
  );
});

test("ignores missing artist names during artist filtering", async () => {
  const brokenSong = {
    id: 4,
    name: "缺失歌手名",
    artists: [{ name: null }],
  } as unknown as Song;
  const task: PlaylistTask = {
    sourcePlaylistName: "A",
    targetPlaylistName: "JB",
    filter: {
      type: "artist",
      value: "贾斯汀比伯",
    },
  };

  const matched = await filterSongs(
    [brokenSong, justinSong],
    task,
    async () => undefined,
  );
  assert.deepEqual(
    matched.map((song) => song.id),
    [1],
  );
});

test("routes language tasks through semantic matcher", async () => {
  const task: PlaylistTask = {
    sourcePlaylistName: "A",
    targetPlaylistName: "粤语精选",
    filter: {
      type: "language",
      value: "粤语",
    },
  };
  const matched = await filterSongs(
    [justinSong, easonSong, lyricSong],
    task,
    async () => {
      throw new Error("language task should not call legacy lyric matcher");
    },
    {
      semanticMatcher: async ({ songs }) =>
        songs
          .filter((song) => song.id === 3)
          .map((song) => ({
            ...song,
            reason: "语义匹配：歌词确认为粤语",
          })),
    },
  );
  assert.deepEqual(
    matched.map((song) => song.id),
    [3],
  );
});

test("does not match language tasks by singer hints alone", async () => {
  const task: PlaylistTask = {
    sourcePlaylistName: "A",
    targetPlaylistName: "粤语精选",
    filter: {
      type: "language",
      value: "粤语",
    },
  };
  let lyricCalls = 0;

  const matched = await filterSongs(
    [easonSong],
    task,
    async () => {
      lyricCalls += 1;
      return undefined;
    },
    {
      semanticMatcher: async () => [],
    },
  );

  assert.equal(lyricCalls, 0);
  assert.deepEqual(
    matched.map((song) => song.id),
    [],
  );
});

test("reports progress while filtering language tasks", async () => {
  const task: PlaylistTask = {
    sourcePlaylistName: "A",
    targetPlaylistName: "粤语精选",
    filter: {
      type: "language",
      value: "粤语",
    },
  };
  const progress: Array<{ processed: number; total: number; matched: number }> =
    [];

  await filterSongs([justinSong, lyricSong], task, async () => undefined, {
    semanticMatcher: async ({ songs, onProgress }) => {
      const matched = [];
      for (const [index, song] of songs.entries()) {
        if (song.id === 3) {
          matched.push({
            ...song,
            reason: "语义匹配：歌词确认为粤语",
          });
        }
        onProgress(index + 1, matched.length);
      }
      return matched;
    },
    onProgress: (event) => progress.push(event),
    progressInterval: 1,
  });

  assert.deepEqual(progress, [
    { processed: 1, total: 2, matched: 0 },
    { processed: 2, total: 2, matched: 1 },
  ]);
});

test("passes semantic progress details through filter progress", async () => {
  const task: PlaylistTask = {
    sourcePlaylistName: "A",
    targetPlaylistName: "粤语精选",
    filter: {
      type: "language",
      value: "粤语",
    },
  };
  const progress: Array<{
    processed: number;
    total: number;
    matched: number;
    phase?: string;
    message?: string;
  }> = [];

  await filterSongs([justinSong, lyricSong], task, async () => undefined, {
    semanticMatcher: async ({ onProgress }) => {
      onProgress(1, 0, {
        phase: "semantic",
        total: 2,
        force: true,
        message: "DeepSeek 判定：第 1/1 批开始",
      });
      return [];
    },
    onProgress: (event) => progress.push(event),
  });

  assert.deepEqual(progress, [
    {
      processed: 1,
      total: 2,
      matched: 0,
      phase: "semantic",
      message: "DeepSeek 判定：第 1/1 批开始",
    },
    {
      processed: 2,
      total: 2,
      matched: 0,
      phase: "final",
    },
  ]);
});

test("passes metadata progress details through filter progress", async () => {
  const task: PlaylistTask = {
    sourcePlaylistName: "A",
    targetPlaylistName: "R&B精选",
    filter: {
      type: "semantic",
      value: "R&B风格",
    },
  };
  const progress: Array<{
    processed: number;
    total: number;
    matched: number;
    phase?: string;
    message?: string;
  }> = [];

  await filterSongs([justinSong, lyricSong], task, async () => undefined, {
    semanticMatcher: async ({ onProgress }) => {
      onProgress(1, 0, {
        phase: "metadata",
        total: 2,
        force: true,
        message: "读取元数据进度：[##########----------] 50% 1/2",
      });
      return [];
    },
    onProgress: (event) => progress.push(event),
  });

  assert.deepEqual(progress, [
    {
      processed: 1,
      total: 2,
      matched: 0,
      phase: "metadata",
      message: "读取元数据进度：[##########----------] 50% 1/2",
    },
    {
      processed: 2,
      total: 2,
      matched: 0,
      phase: "final",
    },
  ]);
});
