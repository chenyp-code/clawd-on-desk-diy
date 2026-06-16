// test/session-hud-renderer.test.js — Unit tests for session-hud-renderer.js
// chip-info helpers (usageChipInfo, turnUsageChipInfo, sessionUsageChipInfo).
// The renderer is browser-only (depends on `document`/`window`), so we load
// it inside a vm sandbox with a minimal DOM stub and expose the helpers via a
// global `__rendererTest` object.
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RENDERER_PATH = path.join(__dirname, "..", "src", "session-hud-renderer.js");
const SOURCE = fs.readFileSync(RENDERER_PATH, "utf8").replace(/\r\n/g, "\n");

function createHarness({ snapshot, i18n } = {}) {
  const created = [];
  class FakeNode {
    constructor(tag) {
      this.tagName = (tag || "span").toUpperCase();
      this.children = [];
      this.attrs = {};
      this.dataset = {};
      this.classList = {
        _set: new Set(),
        add: (c) => this.classList._set.add(c),
        remove: (c) => this.classList._set.delete(c),
        contains: (c) => this.classList._set.has(c),
      };
      this.style = {};
      this.listeners = new Map();
      created.push(this);
    }
    appendChild(child) {
      this.children.push(child);
      child.parentNode = this;
      return child;
    }
    replaceChildren() {
      this.children = [];
    }
    setAttribute(name, value) { this.attrs[name] = value; }
    addEventListener(event, cb) { this.listeners.set(event, cb); }
    querySelectorAll() { return []; }
  }

  const hudEl = new FakeNode("div");
  hudEl.id = "hud";

  const fakeDocument = {
    getElementById(id) {
      if (id === "hud") return hudEl;
      return null;
    },
    createElement(tag) { return new FakeNode(tag); },
    querySelectorAll() { return []; },
    addEventListener() {},
  };

  const apiHandlers = {};
  const apiCalls = [];
  const context = {
    document: fakeDocument,
    setInterval: () => 0,
    console: { warn() {} },
    window: {
      sessionHudAPI: {
        onLangChange: (cb) => { apiHandlers.lang = cb; },
        onSessionSnapshot: (cb) => { apiHandlers.snapshot = cb; },
        getI18n: () => Promise.resolve(i18n || { lang: "en", translations: {} }),
        focusSession: (id) => apiCalls.push(["focus", id]),
        ackCompletion: (id) => { apiCalls.push(["ack", id]); return Promise.resolve(); },
        setPinned: (v) => apiCalls.push(["pinned", v]),
        openDashboard: () => apiCalls.push(["dashboard"]),
      },
    },
  };
  context.globalThis = context;

  // Expose the helpers we want to test on `globalThis.__rendererTest`.
  // The renderer references `snapshot` and `i18nPayload` as module-level
  // `let` bindings. To influence them from the outside, the harness script
  // sets them via the helpers exposed here.
  const harnessSource = `
${SOURCE}
globalThis.__rendererTest = {
  usageChipInfo,
  turnUsageChipInfo,
  sessionUsageChipInfo,
  setSnapshot(next) { snapshot = next; },
  setI18n(next) { i18nPayload = next; },
};
`;

  vm.runInNewContext(harnessSource, context);

  if (snapshot) context.__rendererTest.setSnapshot(snapshot);
  if (i18n) context.__rendererTest.setI18n(i18n);

  return { ...context.__rendererTest, created, hudEl, apiCalls };
}

describe("session-hud renderer — existing context usage chip (smoke)", () => {
  it("returns null when hudShowContextUsage is false", () => {
    const harness = createHarness({
      snapshot: { hudShowContextUsage: false },
    });
    assert.strictEqual(harness.usageChipInfo({ contextUsage: { used: 50000 } }), null);
  });
});

describe("session-hud renderer — per-turn + session-cumulative chips", () => {
  it("returns a per-turn chip when session.lastTurnUsage is set and hudShowContextUsage is not false", () => {
    const harness = createHarness({
      snapshot: { hudShowContextUsage: true },
      i18n: {
        lang: "en",
        translations: {
          hudThisTurnChip: "▲ {total} · {n} calls",
          usageStatLabel: "{input}↑ {output}↓ {cache}↻",
        },
      },
    });
    const info = harness.turnUsageChipInfo({
      lastTurnUsage: { input: 100, output: 50, cacheRead: 10, cacheCreation: 5, total: 165 },
      lastTurnCallCount: 2,
    });
    assert.ok(info, "expected chip info");
    assert.strictEqual(info.cls, "chip-turn");
    assert.strictEqual(info.label, "▲ 165 · 2 calls");
    assert.match(info.title, /100↑/);
    assert.match(info.title, /50↓/);
    assert.match(info.title, /15↻/);
  });

  it("returns a session-cumulative chip when session.sessionTokenUsage is set", () => {
    const harness = createHarness({
      snapshot: { hudShowContextUsage: true },
      i18n: {
        lang: "en",
        translations: {
          hudSessionChip: "Σ {total} · {n} calls",
          usageStatLabel: "{input}↑ {output}↓ {cache}↻",
        },
      },
    });
    const info = harness.sessionUsageChipInfo({
      sessionTokenUsage: { input: 500, output: 200, cacheRead: 30, cacheCreation: 5, total: 735 },
      sessionCallCount: 12,
    });
    assert.ok(info, "expected chip info");
    assert.strictEqual(info.cls, "chip-session");
    assert.strictEqual(info.label, "Σ 735 · 12 calls");
    assert.match(info.title, /500↑/);
    assert.match(info.title, /200↓/);
    assert.match(info.title, /35↻/);
  });

  it("does NOT return per-turn or session-cumulative chips when hudShowContextUsage === false", () => {
    const harness = createHarness({
      snapshot: { hudShowContextUsage: false },
    });
    assert.strictEqual(
      harness.turnUsageChipInfo({
        lastTurnUsage: { input: 100, output: 50, total: 150 },
        lastTurnCallCount: 2,
      }),
      null
    );
    assert.strictEqual(
      harness.sessionUsageChipInfo({
        sessionTokenUsage: { input: 500, output: 200, total: 700 },
        sessionCallCount: 12,
      }),
      null
    );
    // Existing context chip also returns null
    assert.strictEqual(harness.usageChipInfo({ contextUsage: { used: 50000 } }), null);
  });

  it("returns null chips when lastTurnUsage / sessionTokenUsage are null", () => {
    const harness = createHarness({
      snapshot: { hudShowContextUsage: true },
    });
    assert.strictEqual(harness.turnUsageChipInfo({}), null);
    assert.strictEqual(harness.turnUsageChipInfo({ lastTurnUsage: null }), null);
    assert.strictEqual(harness.turnUsageChipInfo({ lastTurnUsage: { total: NaN } }), null);
    assert.strictEqual(harness.turnUsageChipInfo({ lastTurnUsage: "string" }), null);
    assert.strictEqual(harness.sessionUsageChipInfo({}), null);
    assert.strictEqual(harness.sessionUsageChipInfo({ sessionTokenUsage: null }), null);
    assert.strictEqual(harness.sessionUsageChipInfo({ sessionTokenUsage: { total: NaN } }), null);
  });

  it("treats hudShowContextUsage undefined / not-false as 'show'", () => {
    const harness = createHarness({
      snapshot: { /* hudShowContextUsage omitted */ },
      i18n: {
        lang: "en",
        translations: {
          hudThisTurnChip: "▲ {total}",
          hudSessionChip: "Σ {total}",
          usageStatLabel: "{input} {output} {cache}",
        },
      },
    });
    assert.ok(harness.turnUsageChipInfo({
      lastTurnUsage: { input: 1, output: 2, cacheRead: 0, cacheCreation: 0, total: 3 },
      lastTurnCallCount: 1,
    }));
    assert.ok(harness.sessionUsageChipInfo({
      sessionTokenUsage: { input: 1, output: 2, cacheRead: 0, cacheCreation: 0, total: 3 },
      sessionCallCount: 1,
    }));
  });
});
