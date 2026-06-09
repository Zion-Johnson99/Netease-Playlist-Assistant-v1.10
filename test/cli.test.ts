import assert from "node:assert/strict";
import test from "node:test";
import {
  applyTaskLimit,
  createInteractiveIntro,
  formatDiffSongsTable,
  formatDeepseekParseProgressMessage,
  formatTerminalProgressLine,
  formatMatchedSongsTable,
  formatPlaylistTable,
  validateInteractiveArgs,
  validateNoArgs,
} from "../src/cli.js";
import { displayWidth } from "../src/table.js";

const ansiPattern = /\u001b\[[0-9;]*m/g;

function stripAnsi(value: string): string {
  return value.replace(ansiPattern, "");
}

function assertClosedFrame(intro: string): void {
  const lines = intro.split("\n").map(stripAnsi);

  assert.match(lines[0], /^╭─+╮$/);
  assert.match(lines[lines.length - 1], /^╰─+╯$/);
  for (const line of lines.slice(1, -1)) {
    assert.match(line, /^│.*│$/);
  }
}

test("creates preview interactive intro", () => {
  const intro = createInteractiveIntro("preview", "cn", "deepseek-v4-pro");

  assert.match(intro, /\u001b\[90m模式：\u001b\[0m \u001b\[94m预览\u001b\[0m/);
  assert.match(intro, /\u001b\[90m模型：\u001b\[0m deepseek-v4-pro/);
  assert.match(intro, /Netease Playlist Assistant v1\.10/);
  assert.match(intro, /新建：源歌单、筛选条件、目标新歌单名/);
  assert.match(intro, /补全：源歌单、目标已有歌单名/);
  assert.match(intro, /帮我在xx这个歌单中找到所有粤语歌曲/);
  assert.match(intro, /叫做粤语精选/);
  assert.match(intro, /把“粤语精选”中“粤语记忆”没有的歌列出来/);
  assert.match(intro, /粤语记忆”/);
  assert.match(intro, /\u001b\[38;2;220;72;82m╭/);
  assert.match(intro, /╯\u001b\[0m$/);
  assert.match(intro, /\u001b\[101m\u001b\[97m ◎ /);
  assertClosedFrame(intro);
});

test("creates run interactive intro", () => {
  const intro = createInteractiveIntro("execute");

  assert.match(intro, /\u001b\[90m模式：\u001b\[0m \u001b\[92m执行\u001b\[0m/);
  assert.match(intro, /\u001b\[90m模型：\u001b\[0m deepseek-v4-flash/);
  assert.match(intro, /新建：复用预览，再创建目标歌单/);
  assert.match(intro, /补全：复用预览，再添加缺失歌曲/);
  assert.match(intro, /把“粤语精选”中“粤语记忆”没有的歌列出来/);
  assert.match(intro, /\u001b\[38;2;220;72;82m╭/);
  assertClosedFrame(intro);
});

test("creates English preview interactive intro", () => {
  const intro = createInteractiveIntro("preview", "en");

  assert.match(
    intro,
    /\u001b\[90mmode:\u001b\[0m \u001b\[94mpreview\u001b\[0m/,
  );
  assert.match(intro, /\u001b\[90mmodel:\u001b\[0m deepseek-v4-flash/);
  assert.match(intro, /new: source playlist, filter, new target/);
  assert.match(intro, /playlist/);
  assert.match(intro, /complete: source playlist, existing target playlist/);
  assert.match(intro, /Find all Cantonese songs in playlist xx/);
  assert.match(intro, /new playlist/);
  assert.match(intro, /named Cantonese Picks/);
  assert.match(intro, /"Cantonese Picks"/);
  assert.match(intro, /"Cantonese Memory"/);
  assertClosedFrame(intro);
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

test("formats diff songs with song ids", () => {
  const lines = formatDiffSongsTable([
    {
      id: 10,
      name: "心淡",
      artists: [{ name: "容祖儿" }],
      sourceIndex: 3,
      status: "missing",
    },
  ]);

  assert.deepEqual(lines, [
    "序号  源序号  歌曲  歌手    ID",
    "01    3       心淡  容祖儿  10",
  ]);
});

test("wraps English matched song reasons in the reason column", () => {
  const lines = formatMatchedSongsTable(
    [
      {
        id: 1,
        name: "单车",
        artists: [{ name: "陈奕迅" }],
        reason:
          "Semantic match 0.98: Lyrics are in Cantonese, as confirmed by the song artist Eason Chan and the lyric snippet.",
      },
    ],
    "en",
  );

  assert.equal(lines[0], "No.  Track  Artists  Reason");
  assert.match(lines[1] ?? "", /^01\s+单车\s+陈奕迅\s+Semantic match 0\.98:/);
  assert.match(
    lines[2] ?? "",
    /^\s+artist Eason Chan and the lyric snippet\.$/,
  );
});

test("keeps English terminal progress on one display line", () => {
  const line = formatTerminalProgressLine(
    "DeepSeek judging: [████░░░░░░░░░░░░░░░░░░░░] 16% completed 120/755, batch 7/19, running 4, failed batches 0",
    "en",
    "01:18",
    80,
  );

  assert.equal(line.includes("\n"), false);
  assert.ok(displayWidth(line) <= 80);
  assert.match(line, /, elapsed 01:18$/);
});

test("formats Chinese DeepSeek parse progress with full-width parentheses", () => {
  assert.equal(
    formatDeepseekParseProgressMessage("cn"),
    "（正在调用 DeepSeek 解析需求，最多等待 30 秒...）",
  );
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

test("applies task limit in original match order", () => {
  const selected = applyTaskLimit(
    [
      { id: 1, name: "A" },
      { id: 2, name: "B" },
      { id: 3, name: "C" },
    ],
    {
      type: "create_playlist_from_filter",
      sourcePlaylistName: "宝藏",
      targetPlaylistName: "助眠0528",
      limit: 2,
      filter: {
        type: "semantic",
        value: "睡觉听的纯音乐",
      },
    },
  );

  assert.deepEqual(
    selected.map((song) => song.id),
    [1, 2],
  );
});

test("keeps all matches when task has no limit", () => {
  const selected = applyTaskLimit(
    [
      { id: 1, name: "A" },
      { id: 2, name: "B" },
    ],
    {
      type: "create_playlist_from_filter",
      sourcePlaylistName: "宝藏",
      targetPlaylistName: "助眠0528",
      filter: {
        type: "semantic",
        value: "睡觉听的纯音乐",
      },
    },
  );

  assert.deepEqual(
    selected.map((song) => song.id),
    [1, 2],
  );
});
