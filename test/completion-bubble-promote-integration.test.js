"use strict";

// Integration: prove state.js's promoteCompletion() actually fires the
// completion bubble hook in ctx when the #406 gate confirms a real task finish.
// Mirrors the pattern of test/completion-notify-integration.test.js but
// focuses on the completion-bubble hook instead of the Telegram push.

const { describe, it, beforeEach, afterEach, mock } = require("node:test");
const assert = require("node:assert");
const path = require("path");

const themeLoader = require("../src/theme-loader");
themeLoader.init(path.join(__dirname, "..", "src"));
const theme = themeLoader.loadTheme("clawd");

function makeCtx(overrides = {}) {
  return {
    lang: "en",
    theme,
    doNotDisturb: false,
    miniTransitioning: false,
    miniMode: false,
    mouseOverPet: false,
    idlePaused: false,
    forceEyeResend: false,
    eyePauseUntil: 0,
    mouseStillSince: Date.now(),
    miniSleepPeeked: false,
    playSound: () => {},
    sendToRenderer: () => {},
    syncHitWin: () => {},
    sendToHitWin: () => {},
    miniPeekIn: () => {},
    miniPeekOut: () => {},
    buildContextMenu: () => {},
    buildTrayMenu: () => {},
    pendingPermissions: [],
    resolvePermissionEntry: () => {},
    processKill: () => true,
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    ...overrides,
  };
}

function stop(api, id, opts = {}) {
  api.updateSession(id, "attention", "Stop", { agentId: "claude-code", ...opts });
}

describe("promoteCompletion fires ctx.showCompletionBubble", () => {
  let api;
  let bubbles;
  let savedDebounceEnv;

  beforeEach(() => {
    mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
    savedDebounceEnv = process.env.CLAWD_COMPLETION_DEBOUNCE_MS;
    process.env.CLAWD_COMPLETION_DEBOUNCE_MS = "500";
    bubbles = [];
    api = require("../src/state")(makeCtx({
      showCompletionBubble: (payload) => { bubbles.push(payload); },
    }));
  });
  afterEach(() => {
    api.cleanup();
    mock.timers.reset();
    if (savedDebounceEnv === undefined) delete process.env.CLAWD_COMPLETION_DEBOUNCE_MS;
    else process.env.CLAWD_COMPLETION_DEBOUNCE_MS = savedDebounceEnv;
  });

  it("fires the hook exactly once after the debounce window elapses", () => {
    stop(api, "s1", {
      assistantLastOutput: "All done.",
      sessionTitle: "Refactor the auth flow",
    });
    assert.strictEqual(bubbles.length, 0, "no bubble while debounce holds");
    mock.timers.tick(500);
    assert.strictEqual(bubbles.length, 1, "exactly one bubble after promote");
    assert.strictEqual(bubbles[0].sessionId, "s1");
    assert.strictEqual(bubbles[0].prompt, "Refactor the auth flow");
  });

  it("does NOT fire the hook when background tasks are pending", () => {
    stop(api, "s1", { backgroundTasksCount: 1 });
    mock.timers.tick(5000);
    assert.strictEqual(bubbles.length, 0, "live background work suppresses completion bubble");
  });

  it("does NOT fire the hook during the held window even with Notification", () => {
    stop(api, "s1", { assistantLastOutput: "Done.", sessionTitle: "task" });
    mock.timers.tick(200);
    api.updateSession("s1", "notification", "Notification", { agentId: "claude-code" });
    assert.strictEqual(bubbles.length, 0, "no bubble during the hold");
    mock.timers.tick(500);
    assert.strictEqual(bubbles.length, 1, "exactly one bubble after promote");
  });

  it("passes empty prompt when sessionTitle is missing", () => {
    stop(api, "s1", { assistantLastOutput: "Done." });
    mock.timers.tick(500);
    assert.strictEqual(bubbles.length, 1);
    assert.strictEqual(bubbles[0].prompt, "");
  });

  it("does NOT throw if showCompletionBubble is not provided in ctx", () => {
    // Some legacy callers (Telegram-only flows) don't wire the bubble.
    // state.js must gate the call so it stays safe.
    api.cleanup();
    mock.timers.reset();
    const api2 = require("../src/state")(makeCtx({}));
    api2.updateSession("s1", "attention", "Stop", { agentId: "claude-code" });
    // Re-enable timers to advance past the debounce window. If state.js
    // crashed on the missing ctx method we'd never get here.
    mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
    mock.timers.tick(500);
    api2.cleanup();
    mock.timers.reset();
    assert.ok(true);
  });

  it("fires the hook synchronously in the immediate-celebration path (debounce=0, no live work)", () => {
    // Default production setup: CLAWD_COMPLETION_DEBOUNCE_MS=0, no background
    // tasks. updateSession's gate takes the "keep attention, immediate
    // celebration" branch — but that branch must still surface the bubble,
    // otherwise production users never see the completion toast at all.
    // (This regression was masked because every other test in this file
    // forces debounce=500, which routes through scheduleCompletionDebounce.)
    process.env.CLAWD_COMPLETION_DEBOUNCE_MS = "0";
    try {
      stop(api, "s1", { assistantLastOutput: "Done.", sessionTitle: "Fix the bug" });
      // No mock.timers.tick — the immediate branch is synchronous.
      assert.strictEqual(bubbles.length, 1, "bubble fires without debounce");
      assert.strictEqual(bubbles[0].sessionId, "s1");
      assert.strictEqual(bubbles[0].prompt, "Fix the bug");
    } finally {
      // Restore the beforeEach default so the next test isn't poisoned.
      process.env.CLAWD_COMPLETION_DEBOUNCE_MS = "500";
    }
  });
});

describe("promoteCompletion durationMs tracking", () => {
  let api;
  let bubbles;

  beforeEach(() => {
    mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
    bubbles = [];
    api = require("../src/state")(makeCtx({
      showCompletionBubble: (payload) => { bubbles.push(payload); },
    }));
  });
  afterEach(() => {
    api.cleanup();
    mock.timers.reset();
  });

  it("computes durationMs from UserPromptSubmit to Stop in the immediate-celebration path", () => {
    // UserPromptSubmit fires at mocked Date.now()=0 (mock.timers baseline),
    // Stop fires after tick(1500). durationMs should be ~1500.
    process.env.CLAWD_COMPLETION_DEBOUNCE_MS = "0";
    try {
      api.updateSession("s1", "thinking", "UserPromptSubmit", { agentId: "claude-code" });
      mock.timers.tick(1500);
      api.updateSession("s1", "attention", "Stop", { agentId: "claude-code" });
      assert.strictEqual(bubbles.length, 1);
      assert.strictEqual(typeof bubbles[0].durationMs, "number");
      // Allow a small tolerance for any rounding between tick and Date.now.
      assert.ok(bubbles[0].durationMs >= 1400 && bubbles[0].durationMs <= 1600,
        `expected durationMs ~1500, got ${bubbles[0].durationMs}`);
    } finally {
      delete process.env.CLAWD_COMPLETION_DEBOUNCE_MS;
    }
  });

  it("uses durationMs=null when no UserPromptSubmit preceded the Stop (resumed session)", () => {
    // Resumed/continued sessions never fire UserPromptSubmit mid-turn — see
    // clawd-hook.js transcript fallback. The bubble payload should carry
    // durationMs=null so the renderer hides the chip instead of showing
    // "0ms" or a wildly wrong value.
    process.env.CLAWD_COMPLETION_DEBOUNCE_MS = "0";
    try {
      // Skip UserPromptSubmit — go straight to a tool event then Stop.
      api.updateSession("s1", "working", "PreToolUse", { agentId: "claude-code" });
      api.updateSession("s1", "attention", "Stop", { agentId: "claude-code", sessionTitle: "Resumed task" });
      assert.strictEqual(bubbles.length, 1);
      assert.strictEqual(bubbles[0].durationMs, null);
      assert.strictEqual(bubbles[0].prompt, "Resumed task");
    } finally {
      delete process.env.CLAWD_COMPLETION_DEBOUNCE_MS;
    }
  });

  it("resets duration on each new UserPromptSubmit (per-turn timer)", () => {
    // Two consecutive turns: UserPromptSubmit → Stop → UserPromptSubmit → Stop.
    // The second Stop's duration should measure from the SECOND prompt,
    // not accumulate the first turn.
    process.env.CLAWD_COMPLETION_DEBOUNCE_MS = "0";
    try {
      api.updateSession("s1", "thinking", "UserPromptSubmit", { agentId: "claude-code" });
      mock.timers.tick(2000);
      api.updateSession("s1", "attention", "Stop", { agentId: "claude-code" });
      assert.strictEqual(bubbles.length, 1);
      const firstDuration = bubbles[0].durationMs;
      assert.ok(firstDuration >= 1900 && firstDuration <= 2100, `first: ${firstDuration}`);

      // Second turn.
      api.updateSession("s1", "thinking", "UserPromptSubmit", { agentId: "claude-code" });
      mock.timers.tick(500);
      api.updateSession("s1", "attention", "Stop", { agentId: "claude-code" });
      assert.strictEqual(bubbles.length, 2);
      const secondDuration = bubbles[1].durationMs;
      // Second duration should be ~500, not ~2500 (which would include turn 1).
      assert.ok(secondDuration >= 400 && secondDuration <= 600,
        `expected second duration ~500, got ${secondDuration}`);
    } finally {
      delete process.env.CLAWD_COMPLETION_DEBOUNCE_MS;
    }
  });
});