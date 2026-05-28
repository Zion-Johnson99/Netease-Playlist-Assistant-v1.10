import assert from "node:assert/strict";
import test from "node:test";
import { describeDeepseekError, extractJsonObject } from "../src/deepseek.js";

test("extracts plain json object", () => {
  const parsed = extractJsonObject(
    '{"sourcePlaylistName":"A","targetPlaylistName":"B"}',
  );
  assert.deepEqual(parsed, {
    sourcePlaylistName: "A",
    targetPlaylistName: "B",
  });
});

test("extracts fenced json object", () => {
  const parsed = extractJsonObject(
    '```json\n{"filter":{"type":"artist","value":"JB"}}\n```',
  );
  assert.deepEqual(parsed, {
    filter: {
      type: "artist",
      value: "JB",
    },
  });
});

test("describes deepseek timeout clearly in Chinese", () => {
  const message = describeDeepseekError(
    {
      name: "APIConnectionTimeoutError",
      message: "Request timed out.",
    },
    "cn",
    "解析需求",
    30_000,
  );

  assert.match(message, /DeepSeek 解析需求请求超时/);
  assert.match(message, /30 秒/);
});

test("describes deepseek 503 clearly in Chinese", () => {
  const message = describeDeepseekError(
    {
      name: "InternalServerError",
      message: "Service is too busy.",
      status: 503,
    },
    "cn",
    "解析需求",
    30_000,
  );

  assert.match(message, /DeepSeek 服务繁忙/);
  assert.match(message, /503/);
});
