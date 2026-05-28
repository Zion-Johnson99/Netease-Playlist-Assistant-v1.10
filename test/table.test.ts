import assert from "node:assert/strict";
import test from "node:test";
import { displayWidth, formatTable } from "../src/table.js";

test("calculates display width for mixed Chinese and ASCII text", () => {
  assert.equal(displayWidth("R&B国度"), 7);
});

test("formats rows into left aligned table columns", () => {
  const lines = formatTable(
    [
      {
        index: "01",
        song: "Forever Yours",
        artist: "J. Brown",
        reason: "语义匹配 0.90：浪漫婚礼主题",
      },
      {
        index: "02",
        song: "好天气",
        artist: "韦礼安",
        reason: "语义匹配 0.90：旋律轻快温暖",
      },
    ],
    [
      { header: "序号", value: (row) => row.index },
      { header: "歌曲", value: (row) => row.song },
      { header: "歌手", value: (row) => row.artist },
      { header: "理由", value: (row) => row.reason },
    ],
  );

  assert.deepEqual(lines, [
    "序号  歌曲           歌手      理由",
    "01    Forever Yours  J. Brown  语义匹配 0.90：浪漫婚礼主题",
    "02    好天气         韦礼安    语义匹配 0.90：旋律轻快温暖",
  ]);
});
