import assert from "node:assert/strict";
import test from "node:test";
import { extractJsonObject } from "../src/deepseek.js";

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
