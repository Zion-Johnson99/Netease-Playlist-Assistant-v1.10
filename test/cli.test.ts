import assert from "node:assert/strict";
import test from "node:test";
import { createInteractiveIntro, validateInteractiveArgs } from "../src/cli.js";

test("creates preview interactive intro", () => {
  const intro = createInteractiveIntro("preview");

  assert.match(intro, /模式：预览/);
  assert.match(intro, /源歌单、筛选条件、新歌单名称/);
  assert.match(intro, /帮我在xx这个歌单中找到所有粤语歌曲/);
});

test("creates run interactive intro", () => {
  const intro = createInteractiveIntro("execute");

  assert.match(intro, /模式：建立歌单/);
  assert.match(intro, /复用匹配的最近预览结果/);
  assert.match(intro, /帮我在xx这个歌单中找到所有粤语歌曲/);
});

test("creates English preview interactive intro", () => {
  const intro = createInteractiveIntro("preview", "en");

  assert.match(intro, /Mode: preview/);
  assert.match(intro, /source playlist, filter, and new playlist name/);
  assert.match(intro, /Find all Cantonese songs/);
});

test("rejects command arguments in interactive mode", () => {
  assert.throws(
    () =>
      validateInteractiveArgs("preview", [
        "把歌单A里全部粤语歌添加进新建歌单粤语精选",
      ]),
    /preview 已进入对话输入模式/,
  );
});

test("rejects command arguments in English interactive mode", () => {
  assert.throws(
    () => validateInteractiveArgs("preview", ["find Cantonese songs"], "en"),
    /preview uses interactive input mode/,
  );
});

test("accepts empty command arguments in interactive mode", () => {
  assert.doesNotThrow(() => validateInteractiveArgs("run", []));
});
