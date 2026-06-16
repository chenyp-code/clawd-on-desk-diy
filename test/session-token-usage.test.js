// test/session-token-usage.test.js — Unit tests for session token usage
// accumulator helpers in src/state.js. These are pure helpers exported via
// module.exports.__test; the merge is idempotent by assistant entry id.
const { describe, it } = require("node:test");
const assert = require("node:assert");

const stateModule = require("../src/state");
const { mergeSessionTokenUsage, resetSessionTokenUsage } =
  stateModule.__test || stateModule;

describe("session token usage accumulator", () => {
  it("resetSessionTokenUsage returns the zero state", () => {
    const r = resetSessionTokenUsage();
    assert.deepStrictEqual(r, {
      sessionTokenUsage: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 },
      sessionCallCount: 0,
      seenAssistantEntryIds: [],
    });
  });

  it("mergeSessionTokenUsage adds a new id and accumulates usage", () => {
    const start = resetSessionTokenUsage();
    const next = mergeSessionTokenUsage(start, "id-1", { input: 100, output: 50, cacheRead: 0, cacheCreation: 0 });
    assert.deepStrictEqual(next, {
      sessionTokenUsage: { input: 100, output: 50, cacheRead: 0, cacheCreation: 0, total: 150 },
      sessionCallCount: 1,
      seenAssistantEntryIds: ["id-1"],
    });
  });

  it("mergeSessionTokenUsage is idempotent on duplicate id", () => {
    let s = resetSessionTokenUsage();
    s = mergeSessionTokenUsage(s, "id-1", { input: 100, output: 50, cacheRead: 0, cacheCreation: 0 });
    s = mergeSessionTokenUsage(s, "id-1", { input: 100, output: 50, cacheRead: 0, cacheCreation: 0 });
    assert.strictEqual(s.sessionCallCount, 1);
    assert.strictEqual(s.sessionTokenUsage.total, 150);
  });

  it("mergeSessionTokenUsage sums across distinct ids", () => {
    let s = resetSessionTokenUsage();
    s = mergeSessionTokenUsage(s, "id-1", { input: 100, output: 50, cacheRead: 0, cacheCreation: 0 });
    s = mergeSessionTokenUsage(s, "id-2", { input: 200, output: 80, cacheRead: 10, cacheCreation: 5 });
    assert.strictEqual(s.sessionCallCount, 2);
    assert.deepStrictEqual(s.sessionTokenUsage, { input: 300, output: 130, cacheRead: 10, cacheCreation: 5, total: 445 });
  });

  it("mergeSessionTokenUsage ignores empty / non-string id", () => {
    let s = resetSessionTokenUsage();
    s = mergeSessionTokenUsage(s, "", { input: 100, output: 0, cacheRead: 0, cacheCreation: 0 });
    s = mergeSessionTokenUsage(s, null, { input: 100, output: 0, cacheRead: 0, cacheCreation: 0 });
    assert.strictEqual(s.sessionCallCount, 0);
  });

  it("mergeSessionTokenUsage ignores null / non-object usage", () => {
    let s = resetSessionTokenUsage();
    s = mergeSessionTokenUsage(s, "id-1", null);
    s = mergeSessionTokenUsage(s, "id-1", "string");
    assert.strictEqual(s.sessionCallCount, 0);
  });
});
