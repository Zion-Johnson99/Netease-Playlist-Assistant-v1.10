import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AppConfig } from "../src/config.js";
import {
  createSemanticDecisionKey,
  SemanticCache,
} from "../src/semantic-cache.js";
import { PlaylistTask, Song } from "../src/types.js";

function createTestConfig(): AppConfig {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "netease-semantic-"));
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

const task: PlaylistTask = {
  sourcePlaylistName: "A",
  targetPlaylistName: "粤语精选",
  filter: {
    type: "language",
    value: "粤语",
  },
};

const song: Song = {
  id: 1,
  name: "心淡",
  artists: [{ name: "容祖儿" }],
  album: "喜欢祖儿",
};

test("stores semantic metadata and decisions", () => {
  const config = createTestConfig();
  const cache = new SemanticCache(config);
  const key = createSemanticDecisionKey("cn", task, song, "语种：粤语");

  cache.setMetadata(song.id, "语种：粤语");
  cache.setLyric(song.id, "你喺边度，我唔知点解会咁");
  cache.setDecision(key, {
    matched: true,
    confidence: 0.95,
    reason: "百科语种为粤语",
    tags: ["粤语"],
  });
  cache.save();

  const nextCache = new SemanticCache(config);
  assert.equal(nextCache.getMetadata(song.id)?.text, "语种：粤语");
  assert.equal(nextCache.getLyric(song.id)?.text, "你喺边度，我唔知点解会咁");
  assert.equal(nextCache.getDecision(key)?.matched, true);
});

test("stores semantic cache under locale data directory", () => {
  const config = createTestConfig();
  const cache = new SemanticCache(config);

  cache.setMetadata(song.id, "语种：粤语");
  cache.save();

  assert.equal(
    fs.existsSync(path.join(config.localeDataDir, "semantic-cache.json")),
    true,
  );
  assert.equal(
    fs.existsSync(path.join(config.dataDir, "semantic-cache.json")),
    false,
  );
});

test("changes semantic decision key when metadata changes", () => {
  const cantoneseKey = createSemanticDecisionKey(
    "cn",
    task,
    song,
    "语种：粤语",
  );
  const mandarinKey = createSemanticDecisionKey("cn", task, song, "语种：国语");

  assert.notEqual(cantoneseKey, mandarinKey);
});

test("changes semantic decision key when locale changes", () => {
  const cnKey = createSemanticDecisionKey("cn", task, song, "语种：粤语");
  const enKey = createSemanticDecisionKey("en", task, song, "语种：粤语");

  assert.notEqual(cnKey, enKey);
});
