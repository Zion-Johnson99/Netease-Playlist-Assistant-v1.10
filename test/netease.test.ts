import assert from "node:assert/strict";
import test from "node:test";
import { findPlaylistByName } from "../src/netease.js";
import { PlaylistSummary } from "../src/types.js";

const playlists: PlaylistSummary[] = [
  {
    id: 1,
    name: "两首",
    trackCount: 740,
  },
  {
    id: 2,
    name: "山脚下踩单车喜欢的音乐",
    trackCount: 120,
  },
];

test("finds playlist when model keeps spoken wrapper words", () => {
  const matched = findPlaylistByName(playlists, "我两首这个歌单");

  assert.equal(matched.id, 1);
});

test("finds playlist by reverse containment", () => {
  const matched = findPlaylistByName(playlists, "山脚下踩单车喜欢");

  assert.equal(matched.id, 2);
});
