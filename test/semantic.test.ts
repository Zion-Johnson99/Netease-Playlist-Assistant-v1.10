import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseSemanticBatchSize,
  chooseSemanticReadConcurrency,
} from "../src/semantic.js";

test("chooses higher read concurrency for larger playlists", () => {
  assert.equal(chooseSemanticReadConcurrency(2), 8);
  assert.equal(chooseSemanticReadConcurrency(100), 10);
  assert.equal(chooseSemanticReadConcurrency(300), 12);
  assert.equal(chooseSemanticReadConcurrency(755), 16);
});

test("reads semantic batch size from environment", () => {
  const previous = process.env.DEEPSEEK_BATCH_SIZE;

  try {
    delete process.env.DEEPSEEK_BATCH_SIZE;
    assert.equal(chooseSemanticBatchSize(), 40);

    process.env.DEEPSEEK_BATCH_SIZE = "50";
    assert.equal(chooseSemanticBatchSize(), 50);

    process.env.DEEPSEEK_BATCH_SIZE = "0";
    assert.equal(chooseSemanticBatchSize(), 40);
  } finally {
    if (previous === undefined) {
      delete process.env.DEEPSEEK_BATCH_SIZE;
    } else {
      process.env.DEEPSEEK_BATCH_SIZE = previous;
    }
  }
});
