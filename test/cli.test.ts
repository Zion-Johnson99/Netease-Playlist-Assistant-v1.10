import assert from "node:assert/strict";
import test from "node:test";
import {
  createInteractiveIntro,
  formatMatchedSongsTable,
  formatPlaylistTable,
  validateInteractiveArgs,
  validateNoArgs,
} from "../src/cli.js";

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

test("rejects arguments for list command", () => {
  assert.throws(() => validateNoArgs("list", ["extra"]), /list 不需要参数/);
});

test("formats matched songs as one-line aligned table", () => {
  const lines = formatMatchedSongsTable([
    {
      id: 1,
      name: "Forever Yours",
      artists: [{ name: "J. Brown" }],
      reason: "语义匹配 0.90：浪漫婚礼主题",
    },
    {
      id: 2,
      name: "好天气",
      artists: [{ name: "韦礼安" }],
      reason: "语义匹配 0.90：旋律轻快温暖",
    },
  ]);

  assert.deepEqual(lines, [
    "序号  歌曲           歌手      理由",
    "01    Forever Yours  J. Brown  语义匹配 0.90：浪漫婚礼主题",
    "02    好天气         韦礼安    语义匹配 0.90：旋律轻快温暖",
  ]);
});

test("formats playlists without translating playlist names", () => {
  const lines = formatPlaylistTable(
    [
      {
        id: 1,
        name: "我喜欢的音乐",
        trackCount: 20,
      },
      {
        id: 2,
        name: "City Pop 夜行",
        trackCount: 8,
      },
    ],
    "en",
  );

  assert.deepEqual(lines, [
    "No.  ID  Tracks  Playlist",
    "01   1   20      我喜欢的音乐",
    "02   2   8       City Pop 夜行",
  ]);
});
