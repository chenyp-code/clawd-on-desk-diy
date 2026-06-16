"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  countAssistantCallsInLastTurn,
  extractClaudeContextUsageFromEntries,
  extractClaudeLastTurnUsageFromEntries,
  resolveClaudeContextLimit,
} = require("../hooks/context-usage");

describe("Claude per-turn call counter", () => {
  it("returns 0 when no user entry precedes any assistant entry", () => {
    assert.strictEqual(countAssistantCallsInLastTurn([
      { type: "assistant", sessionId: "s1" },
    ], "s1"), 0);
  });

  it("counts only assistant entries after the latest non-tool_result user entry, in session", () => {
    const n = countAssistantCallsInLastTurn([
      { type: "user", sessionId: "s1", message: { content: "hi" } },
      { type: "assistant", sessionId: "s1" },
      { type: "assistant", sessionId: "s1" },
      { type: "user", sessionId: "s1", message: { content: [{ type: "tool_result" }] } },
      { type: "assistant", sessionId: "s1" },
      { type: "assistant", sessionId: "s1" },
      { type: "assistant", sessionId: "s1" },
    ], "s1");
    assert.strictEqual(n, 5);
  });

  it("does not count sidechain / api-error / cross-session entries", () => {
    const n = countAssistantCallsInLastTurn([
      { type: "user", sessionId: "s1", message: { content: "hi" } },
      { type: "assistant", sessionId: "s1", isSidechain: true },
      { type: "assistant", sessionId: "s1", isApiErrorMessage: true },
      { type: "assistant", sessionId: "other" },
      { type: "assistant", sessionId: "s1" },
    ], "s1");
    assert.strictEqual(n, 1);
  });

  it("returns 0 for empty / non-array input", () => {
    assert.strictEqual(countAssistantCallsInLastTurn([], "s1"), 0);
    assert.strictEqual(countAssistantCallsInLastTurn(null, "s1"), 0);
  });
});

describe("Claude context usage parser", () => {
  it("extracts the latest assistant input usage with cache tokens", () => {
    const usage = extractClaudeContextUsageFromEntries([
      {
        type: "assistant",
        message: {
          model: "claude-sonnet-4-5",
          usage: {
            input_tokens: 1000,
            output_tokens: 200,
            cache_read_input_tokens: 3000,
            cache_creation_input_tokens: 400,
          },
        },
      },
    ]);

    assert.deepStrictEqual(usage, {
      used: 4400,
      limit: 200000,
      percent: 2,
      source: "claude",
    });
  });

  it("excludes assistant output tokens to match Claude /context", () => {
    const usage = extractClaudeContextUsageFromEntries([
      {
        type: "assistant",
        message: {
          model: "claude-opus-4.7",
          usage: {
            input_tokens: 76578,
            output_tokens: 837,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        },
      },
    ]);

    assert.deepStrictEqual(usage, {
      used: 76578,
      limit: 200000,
      percent: 38,
      source: "claude",
    });
  });

  it("uses a 1M limit for Claude models marked with 1m context", () => {
    const usage = extractClaudeContextUsageFromEntries([
      {
        type: "assistant",
        message: {
          model: "claude-opus-4-8[1m]",
          usage: {
            input_tokens: 250000,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        },
      },
    ]);

    assert.deepStrictEqual(usage, {
      used: 250000,
      limit: 1000000,
      percent: 25,
      source: "claude",
    });
  });

  it("uses the latest usage entry from a transcript tail", () => {
    const usage = extractClaudeContextUsageFromEntries([
      {
        type: "assistant",
        message: {
          model: "claude-sonnet-4-5",
          usage: { input_tokens: 1000 },
        },
      },
      {
        type: "assistant",
        message: {
          model: "claude-sonnet-4-5",
          usage: { input_tokens: 2000, cache_read_input_tokens: 1000 },
        },
      },
    ]);

    assert.deepStrictEqual(usage, {
      used: 3000,
      limit: 200000,
      percent: 2,
      source: "claude",
    });
  });

  it("skips sidechain sub-agent usage and falls back to the main-chain entry", () => {
    const usage = extractClaudeContextUsageFromEntries([
      {
        type: "assistant",
        message: { model: "claude-sonnet-4-5", usage: { input_tokens: 150000 } },
      },
      {
        type: "assistant",
        isSidechain: true,
        message: { model: "claude-sonnet-4-5", usage: { input_tokens: 12000 } },
      },
    ], "sess-1");

    assert.deepStrictEqual(usage, {
      used: 150000,
      limit: 200000,
      percent: 75,
      source: "claude",
    });
  });

  it("ignores usage from a different session", () => {
    const usage = extractClaudeContextUsageFromEntries([
      {
        type: "assistant",
        sessionId: "sess-1",
        message: { model: "claude-sonnet-4-5", usage: { input_tokens: 90000 } },
      },
      {
        type: "assistant",
        sessionId: "other",
        message: { model: "claude-sonnet-4-5", usage: { input_tokens: 1000 } },
      },
    ], "sess-1");

    assert.deepStrictEqual(usage, {
      used: 90000,
      limit: 200000,
      percent: 45,
      source: "claude",
    });
  });

  it("skips API-error entries that carry a usage object", () => {
    const usage = extractClaudeContextUsageFromEntries([
      {
        type: "assistant",
        message: { model: "claude-sonnet-4-5", usage: { input_tokens: 50000 } },
      },
      {
        type: "assistant",
        isApiErrorMessage: true,
        message: { model: "claude-sonnet-4-5", usage: { input_tokens: 999 } },
      },
    ], "sess-1");

    assert.deepStrictEqual(usage, {
      used: 50000,
      limit: 200000,
      percent: 25,
      source: "claude",
    });
  });

  it("counts entries without a sessionId field even when a session is given", () => {
    const usage = extractClaudeContextUsageFromEntries([
      {
        type: "assistant",
        message: { model: "claude-sonnet-4-5", usage: { input_tokens: 8000 } },
      },
    ], "sess-1");

    assert.deepStrictEqual(usage, {
      used: 8000,
      limit: 200000,
      percent: 4,
      source: "claude",
    });
  });

  it("skips non-assistant entries that carry a usage object", () => {
    const usage = extractClaudeContextUsageFromEntries([
      {
        type: "assistant",
        message: { model: "claude-sonnet-4-5", usage: { input_tokens: 50000 } },
      },
      {
        type: "summary",
        message: { model: "claude-sonnet-4-5", usage: { input_tokens: 999 } },
      },
    ], "sess-1");

    assert.deepStrictEqual(usage, {
      used: 50000,
      limit: 200000,
      percent: 25,
      source: "claude",
    });
  });

  it("still counts a real-session entry when no session id is provided", () => {
    const usage = extractClaudeContextUsageFromEntries([
      {
        type: "assistant",
        sessionId: "real-uuid",
        message: { model: "claude-sonnet-4-5", usage: { input_tokens: 2000 } },
      },
    ], null);

    assert.deepStrictEqual(usage, {
      used: 2000,
      limit: 200000,
      percent: 1,
      source: "claude",
    });
  });

  it("ignores entries without usage", () => {
    assert.strictEqual(extractClaudeContextUsageFromEntries([{ type: "user" }]), null);
  });

  it("returns raw used without percent for unknown model limits", () => {
    assert.strictEqual(resolveClaudeContextLimit("mystery-model"), null);
    const usage = extractClaudeContextUsageFromEntries([
      {
        type: "assistant",
        message: {
          model: "mystery-model",
          usage: { input_tokens: 123 },
        },
      },
    ]);

    assert.deepStrictEqual(usage, { used: 123, source: "claude" });
  });
});

describe("Claude per-turn usage parser", () => {
  it("returns null when no user entry precedes any assistant entry", () => {
    const usage = extractClaudeLastTurnUsageFromEntries([
      { type: "assistant", sessionId: "s1", message: { usage: { input_tokens: 100, output_tokens: 50 } } },
    ], "s1");
    assert.strictEqual(usage, null);
  });

  it("sums assistant usage entries from the latest user entry forward", () => {
    const usage = extractClaudeLastTurnUsageFromEntries([
      { type: "user", sessionId: "s1", message: { content: "hi" } },
      { type: "assistant", sessionId: "s1", message: { usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10, cache_creation_input_tokens: 5 } } },
      { type: "user", sessionId: "s1", message: { content: [{ type: "tool_result" }] } },
      { type: "assistant", sessionId: "s1", message: { usage: { input_tokens: 200, output_tokens: 80, cache_read_input_tokens: 20, cache_creation_input_tokens: 0 } } },
    ], "s1");
    assert.deepStrictEqual(usage, {
      input: 300, output: 130, cacheRead: 30, cacheCreation: 5, total: 465, source: "claude",
    });
  });

  it("skips sidechain / sub-agent / api-error entries", () => {
    const usage = extractClaudeLastTurnUsageFromEntries([
      { type: "user", sessionId: "s1" },
      { type: "assistant", sessionId: "s1", isSidechain: true, message: { usage: { input_tokens: 9999 } } },
      { type: "assistant", sessionId: "s1", isApiErrorMessage: true, message: { usage: { input_tokens: 9999 } } },
      { type: "assistant", sessionId: "s1", message: { usage: { input_tokens: 100, output_tokens: 50 } } },
    ], "s1");
    assert.deepStrictEqual(usage, { input: 100, output: 50, cacheRead: 0, cacheCreation: 0, total: 150, source: "claude" });
  });

  it("excludes cross-session entries", () => {
    const usage = extractClaudeLastTurnUsageFromEntries([
      { type: "user", sessionId: "s1" },
      { type: "assistant", sessionId: "other", message: { usage: { input_tokens: 9999 } } },
      { type: "assistant", sessionId: "s1", message: { usage: { input_tokens: 100, output_tokens: 50 } } },
    ], "s1");
    assert.deepStrictEqual(usage, { input: 100, output: 50, cacheRead: 0, cacheCreation: 0, total: 150, source: "claude" });
  });

  it("returns null for empty / non-array input", () => {
    assert.strictEqual(extractClaudeLastTurnUsageFromEntries([], "s1"), null);
    assert.strictEqual(extractClaudeLastTurnUsageFromEntries(null, "s1"), null);
  });
});

const { findLastAssistantEntry } = require("../hooks/context-usage");

describe("findLastAssistantEntry (session-cumulative anchor)", () => {
  it("returns the latest assistant entry with usage, in session, NOT skipping sidechain", () => {
    const entry = findLastAssistantEntry([
      { type: "assistant", sessionId: "s1", uuid: "old", message: { usage: { input_tokens: 1 } } },
      { type: "assistant", sessionId: "s1", uuid: "new", message: { usage: { input_tokens: 2 } } },
    ], "s1");
    assert.strictEqual(entry.uuid, "new");
  });

  it("includes sub-agent (sidechain) entries — used for session cumulative", () => {
    const entry = findLastAssistantEntry([
      { type: "assistant", sessionId: "s1", uuid: "main", message: { usage: { input_tokens: 1 } } },
      { type: "assistant", sessionId: "s1", isSidechain: true, uuid: "sub", message: { usage: { input_tokens: 2 } } },
    ], "s1");
    assert.strictEqual(entry.uuid, "sub");
  });

  it("skips api-error entries", () => {
    const entry = findLastAssistantEntry([
      { type: "assistant", sessionId: "s1", uuid: "real", message: { usage: { input_tokens: 1 } } },
      { type: "assistant", sessionId: "s1", isApiErrorMessage: true, uuid: "err", message: { usage: { input_tokens: 999 } } },
    ], "s1");
    assert.strictEqual(entry.uuid, "real");
  });

  it("skips cross-session entries", () => {
    const entry = findLastAssistantEntry([
      { type: "assistant", sessionId: "s1", uuid: "real", message: { usage: { input_tokens: 1 } } },
      { type: "assistant", sessionId: "other", uuid: "skip", message: { usage: { input_tokens: 2 } } },
    ], "s1");
    assert.strictEqual(entry.uuid, "real");
  });

  it("skips entries without usage", () => {
    const entry = findLastAssistantEntry([
      { type: "assistant", sessionId: "s1", uuid: "nope", message: { content: [] } },
      { type: "assistant", sessionId: "s1", uuid: "yes", message: { usage: { input_tokens: 1 } } },
    ], "s1");
    assert.strictEqual(entry.uuid, "yes");
  });

  it("returns null when nothing matches", () => {
    assert.strictEqual(findLastAssistantEntry([], "s1"), null);
    assert.strictEqual(findLastAssistantEntry([
      { type: "user", sessionId: "s1" },
    ], "s1"), null);
  });
});
