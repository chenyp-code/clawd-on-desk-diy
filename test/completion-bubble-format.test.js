"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const { formatDurationMs } = require("../src/completion-bubble-format");

describe("formatDurationMs", () => {
  it("returns null for invalid inputs", () => {
    assert.strictEqual(formatDurationMs(null), null);
    assert.strictEqual(formatDurationMs(undefined), null);
    assert.strictEqual(formatDurationMs(NaN), null);
    assert.strictEqual(formatDurationMs(-1), null);
    assert.strictEqual(formatDurationMs("500"), null);
  });

  it("formats sub-second durations in milliseconds", () => {
    assert.strictEqual(formatDurationMs(0), "0ms");
    assert.strictEqual(formatDurationMs(500), "500ms");
    assert.strictEqual(formatDurationMs(999), "999ms");
  });

  it("formats seconds under 10 with one decimal", () => {
    assert.strictEqual(formatDurationMs(1000), "1.0s");
    assert.strictEqual(formatDurationMs(2300), "2.3s");
    assert.strictEqual(formatDurationMs(9999), "10.0s");
  });

  it("formats seconds 10-59 without decimal", () => {
    // Boundary: 10s rounds to 10s, not 10.0s
    assert.strictEqual(formatDurationMs(10000), "10s");
    assert.strictEqual(formatDurationMs(45500), "46s");
    assert.strictEqual(formatDurationMs(59999), "60s");
  });

  it("formats minutes + seconds for durations over a minute", () => {
    assert.strictEqual(formatDurationMs(60_000), "1m0s");
    assert.strictEqual(formatDurationMs(83_000), "1m23s");
    assert.strictEqual(formatDurationMs(125_500), "2m5s");
    assert.strictEqual(formatDurationMs(3_661_000), "61m1s");
  });
});