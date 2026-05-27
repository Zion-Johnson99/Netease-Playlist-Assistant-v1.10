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
import { PlaylistTask } from "../src/types.js";

function createTestConfig(): AppConfig {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "netease-cache-"));
  return {
    dataDir,
    cookiePath: path.join(dataDir, "cookie.txt"),
    deepseekApiKey: "test-key",
    deepseekModel: "test-model",
    deepseekBaseUrl: "https://example.test",
    deepseekBatchConcurrency: 2,
    deepseekBatchTimeoutMs: 60_000,
    deepseekBatchRetries: 1,
  };
}

const task: PlaylistTask = {
  sourcePlaylistName: "两首",
  targetPlaylistName: "粤语精选",
  filter: {
    type: "language",
    value: "粤语",
  },
};

test("reads matching preview cache", () => {
  const config = createTestConfig();
  savePreviewCache(config, {
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

  assert.equal(cache?.matchedSongs.length, 1);
  assert.equal(cache?.matchedSongs[0]?.id, 10);
});

test("ignores preview cache for different task", () => {
  const config = createTestConfig();
  savePreviewCache(config, {
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
