import assert from "node:assert/strict";
import test from "node:test";
import { computePlaylistDiff } from "../src/playlist-diff.js";
import { Song } from "../src/types.js";

function song(id: number, name: string): Song {
  return {
    id,
    name,
    artists: [{ name: "测试歌手" }],
  };
}

test("computes songs missing from target playlist by song id", () => {
  const diff = computePlaylistDiff(
    [song(1, "A"), song(2, "B"), song(3, "C")],
    [song(1, "A"), song(3, "C")],
  );

  assert.deepEqual(
    diff.missingSongs.map((item) => item.id),
    [2],
  );
  assert.equal(diff.missingSongs[0]?.sourceIndex, 2);
});

test("keeps same-name songs when ids differ", () => {
  const diff = computePlaylistDiff([song(1, "同名歌")], [song(2, "同名歌")]);

  assert.deepEqual(
    diff.missingSongs.map((item) => item.id),
    [1],
  );
});

test("deduplicates repeated source ids and keeps first source index", () => {
  const diff = computePlaylistDiff(
    [song(1, "A"), song(2, "B"), song(2, "B live")],
    [song(1, "A")],
  );

  assert.deepEqual(
    diff.missingSongs.map((item) => item.id),
    [2],
  );
  assert.equal(diff.missingSongs[0]?.sourceIndex, 2);
});

test("reports extra target songs without deleting them", () => {
  const diff = computePlaylistDiff(
    [song(1, "A"), song(2, "B")],
    [song(1, "A"), song(2, "B"), song(3, "C"), song(3, "C duplicate")],
  );

  assert.deepEqual(
    diff.extraSongs.map((item) => item.id),
    [3],
  );
});
