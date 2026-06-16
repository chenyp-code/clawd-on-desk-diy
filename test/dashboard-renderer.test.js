// test/dashboard-renderer.test.js — Unit tests for dashboard-renderer.js
// text helpers (contextUsageText, lastTurnUsageRowText, sessionTokenUsageRowText)
// and the row-appending helpers (appendContextUsage, appendTurnUsage, appendSessionUsage).
// The renderer is browser-only (depends on `document`/`window`), so we load it
// inside a vm sandbox with a minimal DOM stub and expose the helpers via a
// global `__rendererTest` object.
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RENDERER_PATH = path.join(__dirname, "..", "src", "dashboard-renderer.js");
const SOURCE = fs.readFileSync(RENDERER_PATH, "utf8").replace(/\r\n/g, "\n");

function createHarness({ i18n } = {}) {
  const created = [];
  class FakeNode {
    constructor(tag) {
      this.tagName = (tag || "div").toUpperCase();
      this.children = [];
      this._className = "";
      this._textContent = "";
      this.dataset = {};
      this.attrs = {};
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
    get textContent() { return this._textContent; }
    set textContent(v) { this._textContent = String(v); }
    get className() { return this._className || ""; }
    set className(v) {
      this._className = String(v);
      this.classList._set = new Set(String(v).split(/\s+/).filter(Boolean));
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
    getElementById() { return null; }
  }

  const titleEl = new FakeNode("span");
  const countEl = new FakeNode("span");
  const contentEl = new FakeNode("div");

  const fakeDocument = {
    getElementById(id) {
      if (id === "title") return titleEl;
      if (id === "count") return countEl;
      if (id === "content") return contentEl;
      return null;
    },
    createElement(tag) { return new FakeNode(tag); },
    createTextNode(text) {
      const node = new FakeNode("#text");
      node._textContent = String(text);
      return node;
    },
    createDocumentFragment() { return new FakeNode("#fragment"); },
    querySelectorAll() { return []; },
    addEventListener() {},
    contains() { return false; },
  };

  const apiHandlers = {};
  const apiCalls = [];
  const context = {
    document: fakeDocument,
    setInterval: () => 0,
    console: { warn() {} },
    window: {
      dashboardAPI: {
        onLangChange: (cb) => { apiHandlers.lang = cb; },
        onSessionSnapshot: (cb) => { apiHandlers.snapshot = cb; },
        getI18n: () => Promise.resolve(i18n || { lang: "en", translations: {} }),
        getSnapshot: () => Promise.resolve({ sessions: [], groups: [] }),
        focusSession: (id) => apiCalls.push(["focus", id]),
        hideSession: (id) => { apiCalls.push(["hide", id]); return Promise.resolve({ status: "ok" }); },
        ackCompletion: (id) => { apiCalls.push(["ack", id]); return Promise.resolve({ status: "ok" }); },
        setSessionAlias: () => Promise.resolve({ status: "ok" }),
      },
    },
  };
  context.globalThis = context;

  // Expose the helpers we want to test on `globalThis.__rendererTest`.
  // The renderer references `snapshot` and `i18nPayload` as module-level
  // `let` bindings; we expose setters so tests can drive state.
  const harnessSource = `
${SOURCE}
globalThis.__rendererTest = {
  contextUsageText,
  lastTurnUsageRowText,
  sessionTokenUsageRowText,
  appendContextUsage,
  appendTurnUsage,
  appendSessionUsage,
  createText,
  setSnapshot(next) { snapshot = next; },
  setI18n(next) { i18nPayload = next; },
};
`;

  vm.runInNewContext(harnessSource, context);

  if (i18n) context.__rendererTest.setI18n(i18n);

  return { ...context.__rendererTest, created, contentEl };
}

describe("dashboard renderer — per-turn + session-cumulative rows", () => {
  it("renders a 'This turn' row with total + call count when lastTurnUsage is set", () => {
    const harness = createHarness({
      i18n: {
        lang: "en",
        translations: {
          dashboardThisTurnUsage: "This turn",
          dashboardCallCount: "{n} LLM calls",
        },
      },
    });
    const text = harness.lastTurnUsageRowText({
      lastTurnUsage: { input: 100, output: 50, cacheRead: 10, cacheCreation: 5, total: 165 },
      lastTurnCallCount: 2,
    });
    assert.strictEqual(text, "This turn: 165  (2 LLM calls)");
  });

  it("renders a 'Session' row with total + call count when sessionTokenUsage is set", () => {
    const harness = createHarness({
      i18n: {
        lang: "en",
        translations: {
          dashboardSessionUsage: "Session",
          dashboardCallCount: "{n} LLM calls",
        },
      },
    });
    const text = harness.sessionTokenUsageRowText({
      sessionTokenUsage: { input: 500, output: 200, cacheRead: 30, cacheCreation: 5, total: 735 },
      sessionCallCount: 12,
    });
    assert.strictEqual(text, "Session: 735  (12 LLM calls)");
  });

  it("renders em-dash placeholders when fields are null", () => {
    const harness = createHarness({
      i18n: {
        lang: "en",
        translations: {
          dashboardThisTurnUsage: "This turn",
          dashboardSessionUsage: "Session",
          dashboardCallCount: "{n} LLM calls",
        },
      },
    });
    assert.strictEqual(harness.lastTurnUsageRowText({}), "This turn: —");
    assert.strictEqual(harness.lastTurnUsageRowText({ lastTurnUsage: null }), "This turn: —");
    assert.strictEqual(
      harness.lastTurnUsageRowText({ lastTurnUsage: { total: NaN } }),
      "This turn: —"
    );
    assert.strictEqual(harness.sessionTokenUsageRowText({}), "Session: —");
    assert.strictEqual(harness.sessionTokenUsageRowText({ sessionTokenUsage: null }), "Session: —");
    assert.strictEqual(
      harness.sessionTokenUsageRowText({ sessionTokenUsage: { total: NaN } }),
      "Session: —"
    );
  });

  it("falls back to 0 calls when call-count fields are missing/invalid", () => {
    const harness = createHarness({
      i18n: {
        lang: "en",
        translations: {
          dashboardThisTurnUsage: "This turn",
          dashboardSessionUsage: "Session",
          dashboardCallCount: "{n} LLM calls",
        },
      },
    });
    const turnText = harness.lastTurnUsageRowText({
      lastTurnUsage: { input: 1, output: 2, cacheRead: 0, cacheCreation: 0, total: 3 },
    });
    assert.strictEqual(turnText, "This turn: 3  (0 LLM calls)");
    const sessionText = harness.sessionTokenUsageRowText({
      sessionTokenUsage: { input: 1, output: 2, cacheRead: 0, cacheCreation: 0, total: 3 },
    });
    assert.strictEqual(sessionText, "Session: 3  (0 LLM calls)");
  });

  it("formats numbers via locale-aware Intl.NumberFormat", () => {
    const harness = createHarness({
      i18n: {
        lang: "en",
        translations: {
          dashboardThisTurnUsage: "This turn",
          dashboardCallCount: "{n} LLM calls",
        },
      },
    });
    const text = harness.lastTurnUsageRowText({
      lastTurnUsage: { input: 10000, output: 2000, cacheRead: 345, cacheCreation: 0, total: 12345 },
      lastTurnCallCount: 3,
    });
    assert.strictEqual(text, "This turn: 12,345  (3 LLM calls)");
  });

  it("appendTurnUsage mounts a turn-usage-row div with the expected text", () => {
    const harness = createHarness({
      i18n: {
        lang: "en",
        translations: {
          dashboardThisTurnUsage: "This turn",
          dashboardCallCount: "{n} LLM calls",
        },
      },
    });
    const main = harness.contentEl; // any container works for our fake
    harness.appendTurnUsage(main, {
      lastTurnUsage: { input: 100, output: 50, cacheRead: 0, cacheCreation: 0, total: 150 },
      lastTurnCallCount: 4,
    });
    const rows = main.children.filter((c) => c.classList.contains("turn-usage-row"));
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].textContent, "This turn: 150  (4 LLM calls)");
  });

  it("appendSessionUsage mounts a session-usage-row div with the expected text", () => {
    const harness = createHarness({
      i18n: {
        lang: "en",
        translations: {
          dashboardSessionUsage: "Session",
          dashboardCallCount: "{n} LLM calls",
        },
      },
    });
    const main = harness.contentEl;
    harness.appendSessionUsage(main, {
      sessionTokenUsage: { input: 500, output: 200, cacheRead: 0, cacheCreation: 0, total: 700 },
      sessionCallCount: 11,
    });
    const rows = main.children.filter((c) => c.classList.contains("session-usage-row"));
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].textContent, "Session: 700  (11 LLM calls)");
  });
});
