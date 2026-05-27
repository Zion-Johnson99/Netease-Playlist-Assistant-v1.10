import assert from "node:assert/strict";
import test from "node:test";
import { chooseSemanticReadConcurrency } from "../src/semantic.js";

test("chooses higher read concurrency for larger playlists", () => {
  assert.equal(chooseSemanticReadConcurrency(2), 8);
  assert.equal(chooseSemanticReadConcurrency(100), 10);
  assert.equal(chooseSemanticReadConcurrency(300), 12);
  assert.equal(chooseSemanticReadConcurrency(755), 16);
});
