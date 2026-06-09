import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  readMatchingPreviewCache,
  savePreviewCache,
} from "../src/preview-cache.js";
import { AppConfig } from "../src/config.js";
import {
  CreatePlaylistFromFilterTask,
  DiffSong,
  PlaylistTask,
} from "../src/types.js";

function createTestConfig(): AppConfig {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "netease-cache-"));
  return {
    dataDir,
    localeDataDir: path.join(dataDir, "cn"),
    cookiePath: path.join(dataDir, "cookie.txt"),
    appConfigPath: path.join(dataDir, "config.json"),
    locale: "cn",
    deepseekApiKey: "test-key",
    deepseekModel: "test-model",
    deepseekBaseUrl: "https://example.test",
    deepseekBatchConcurrency: 2,
    deepseekBatchTimeoutMs: 60_000,
    deepseekBatchRetries: 1,
  };
}

const task: CreatePlaylistFromFilterTask = {
  type: "create_playlist_from_filter",
  sourcePlaylistName: "两首",
  targetPlaylistName: "粤语精选",
  filter: {
    type: "language",
    value: "粤语",
  },
};

const diffSong: DiffSong = {
  id: 10,
  name: "心淡",
  artists: [{ name: "容祖儿" }],
  sourceIndex: 1,
  status: "missing",
};

test("reads matching preview cache", () => {
  const config = createTestConfig();
  savePreviewCache(config, {
    taskType: "create_playlist_from_filter",
    sourcePlaylistId: 1,
    sourcePlaylistName: "两首",
    targetPlaylistName: "粤语精选",
    filter: task.filter,
    matchedSongs: [
      {
        id: 10,
        name: "心淡",
        artists: [{ name: "容祖儿" }],
        reason: "语义匹配 0.95：歌词与百科显示为粤语演唱",
      },
    ],
  });

  const cache = readMatchingPreviewCache(config, task, 1);

  assert.equal(cache?.taskType, "create_playlist_from_filter");
  if (cache?.taskType === "create_playlist_from_filter") {
    assert.equal(cache.matchedSongs.length, 1);
    assert.equal(cache.matchedSongs[0]?.id, 10);
  }
});

test("ignores preview cache for different task", () => {
  const config = createTestConfig();
  savePreviewCache(config, {
    taskType: "create_playlist_from_filter",
    sourcePlaylistId: 1,
    sourcePlaylistName: "两首",
    targetPlaylistName: "粤语精选",
    filter: task.filter,
    matchedSongs: [],
  });

  const cache = readMatchingPreviewCache(
    config,
    {
      ...task,
      targetPlaylistName: "粤语精选 2",
    },
    1,
  );

  assert.equal(cache, null);
});

test("ignores preview cache for different limit", () => {
  const config = createTestConfig();
  savePreviewCache(config, {
    taskType: "create_playlist_from_filter",
    sourcePlaylistId: 1,
    sourcePlaylistName: "两首",
    targetPlaylistName: "粤语精选",
    limit: 10,
    filter: task.filter,
    matchedSongs: [],
  });

  const cache = readMatchingPreviewCache(
    config,
    {
      ...task,
      limit: 5,
    },
    1,
  );

  assert.equal(cache, null);
});

test("stores preview cache under locale data directory", () => {
  const config = createTestConfig();
  savePreviewCache(config, {
    taskType: "create_playlist_from_filter",
    sourcePlaylistId: 1,
    sourcePlaylistName: "两首",
    targetPlaylistName: "粤语精选",
    filter: task.filter,
    matchedSongs: [],
  });

  assert.equal(
    fs.existsSync(path.join(config.localeDataDir, "last-preview.json")),
    true,
  );
  assert.equal(
    fs.existsSync(path.join(config.dataDir, "last-preview.json")),
    false,
  );
});

test("ignores preview cache for different locale", () => {
  const config = createTestConfig();
  savePreviewCache(config, {
    taskType: "create_playlist_from_filter",
    sourcePlaylistId: 1,
    sourcePlaylistName: "两首",
    targetPlaylistName: "粤语精选",
    filter: task.filter,
    matchedSongs: [],
  });

  const cache = readMatchingPreviewCache(
    {
      ...config,
      locale: "en",
      localeDataDir: path.join(config.dataDir, "en"),
    },
    task,
    1,
  );

  assert.equal(cache, null);
});

test("reads matching playlist diff preview cache", () => {
  const config = createTestConfig();
  const diffTask: PlaylistTask = {
    type: "playlist_diff",
    sourcePlaylistName: "粤语精选0608",
    targetPlaylistName: "粤语精选",
  };

  savePreviewCache(config, {
    taskType: "playlist_diff",
    sourcePlaylistId: 1,
    sourcePlaylistName: "粤语精选0608",
    targetPlaylistId: 2,
    targetPlaylistName: "粤语精选",
    sourceTrackCount: 3,
    targetTrackCount: 2,
    missingSongs: [diffSong],
    extraSongCount: 0,
  });

  const cache = readMatchingPreviewCache(config, diffTask, 1, 2);

  assert.equal(cache?.taskType, "playlist_diff");
  if (cache?.taskType === "playlist_diff") {
    assert.equal(cache.missingSongs.length, 1);
    assert.equal(cache.missingSongs[0]?.id, 10);
  }
});

test("ignores playlist diff preview cache for different target id", () => {
  const config = createTestConfig();
  const diffTask: PlaylistTask = {
    type: "playlist_diff",
    sourcePlaylistName: "粤语精选0608",
    targetPlaylistName: "粤语精选",
  };

  savePreviewCache(config, {
    taskType: "playlist_diff",
    sourcePlaylistId: 1,
    sourcePlaylistName: "粤语精选0608",
    targetPlaylistId: 2,
    targetPlaylistName: "粤语精选",
    sourceTrackCount: 3,
    targetTrackCount: 2,
    missingSongs: [diffSong],
    extraSongCount: 0,
  });

  const cache = readMatchingPreviewCache(config, diffTask, 1, 3);

  assert.equal(cache, null);
});
