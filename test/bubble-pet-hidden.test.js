"use strict";

// Regression coverage for the petHidden suppression contract across bubbles.
//
// Background: AGENTS.md distinguishes petHidden (out-of-sight) from DND
// (silenced). Permission bubbles already honour that — showPermissionBubble()
// has no petHidden guard, so a fresh request still reaches the user when the
// pet is hidden. This file locks in that the same "petHidden ≠ DND" rule now
// applies to the update and completion bubbles too, after the fix that
// removed their syncVisibility() short-circuits.

const assert = require("node:assert");
const Module = require("node:module");
const { describe, it, afterEach } = require("node:test");

const UPDATE_BUBBLE_MODULE_PATH = require.resolve("../src/update-bubble");
const COMPLETION_BUBBLE_MODULE_PATH = require.resolve("../src/completion-bubble");

class FakeBrowserWindow {
  static instances = [];

  static fromWebContents(contents) {
    return FakeBrowserWindow.instances.find((win) => win.webContents === contents) || null;
  }

  constructor(options) {
    this.options = options;
    this.destroyed = false;
    this.visible = false;
    this.bounds = null;
    this.listeners = new Map();
    this.webContents = {
      _loading: false,
      isDestroyed: () => false,
      isLoading: () => false,
      once: () => {},
      send: () => {},
    };
    FakeBrowserWindow.instances.push(this);
  }

  loadFile() {}
  on(event, handler) { this.listeners.set(event, handler); }
  setAlwaysOnTop() {}
  setBounds(bounds) { this.bounds = bounds; }
  showInactive() { this.visible = true; }
  hide() { this.visible = false; }
  isVisible() { return this.visible; }
  isDestroyed() { return this.destroyed; }
  destroy() {
    this.destroyed = true;
    const handler = this.listeners.get("closed");
    if (typeof handler === "function") handler();
  }
}

function loadBubbleModule(modulePath, fakeElectron) {
  delete require.cache[modulePath];
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "electron") return fakeElectron;
    return originalLoad.apply(this, arguments);
  };
  try {
    return require(modulePath);
  } finally {
    Module._load = originalLoad;
  }
}

function buildUpdateCtx(overrides = {}) {
  return {
    win: { isDestroyed: () => false },
    bubbleFollowPet: false,
    petHidden: true,
    getBubblePolicy: () => ({ enabled: true, autoCloseMs: 0 }),
    getPendingPermissions: () => [],
    getPetWindowBounds: () => ({ x: 20, y: 20, width: 120, height: 120 }),
    getNearestWorkArea: () => ({ x: 0, y: 0, width: 1920, height: 1080 }),
    getUpdateBubbleAnchorRect: () => null,
    getHitRectScreen: () => null,
    getHudReservedOffset: () => 0,
    guardAlwaysOnTop: () => {},
    reapplyMacVisibility: () => {},
    ...overrides,
  };
}

function buildCompletionCtx(overrides = {}) {
  return {
    win: { isDestroyed: () => false },
    bubbleFollowPet: false,
    petHidden: true,
    miniMode: false,
    getBubblePolicy: () => ({ enabled: true, autoCloseMs: 2_000, bypassDnd: true }),
    getPendingPermissions: () => [],
    getPetWindowBounds: () => ({ x: 20, y: 20, width: 120, height: 120 }),
    getNearestWorkArea: () => ({ x: 0, y: 0, width: 1920, height: 1080 }),
    getUpdateBubbleAnchorRect: () => null,
    getHitRectScreen: () => null,
    getUpdateBubble: () => null,
    getHudReservedOffset: () => 0,
    guardAlwaysOnTop: () => {},
    reapplyMacVisibility: () => {},
    ...overrides,
  };
}

afterEach(() => {
  FakeBrowserWindow.instances = [];
  delete require.cache[UPDATE_BUBBLE_MODULE_PATH];
  delete require.cache[COMPLETION_BUBBLE_MODULE_PATH];
});

describe("petHidden overrides bubbleFollowPet for bottom-right placement", () => {
  // petBounds is at the bottom-right edge of the work area, so a followPet
  // path would clamp the bubble to x≈0 / y≈bottom. We assert the OPPOSITE:
  // when petHidden is true, the bounds use the work-area bottom-right anchor
  // directly (wa.x + wa.width - width - margin), independent of petBounds.

  it("update bubble drops to work-area bottom-right when petHidden + bubbleFollowPet", () => {
    const initUpdateBubble = loadBubbleModule(UPDATE_BUBBLE_MODULE_PATH, {
      BrowserWindow: FakeBrowserWindow,
    });
    const ctx = buildUpdateCtx({ bubbleFollowPet: true, petHidden: true });
    const api = initUpdateBubble(ctx);

    // Stash the bubble so computeBounds is reachable through the API.
    api.showUpdateBubble({
      mode: "up-to-date",
      title: "Up to date",
      message: "Already on the latest version.",
      requireAction: false,
      defaultAction: "dismiss",
    });

    // Anchor the pet to the bottom-right so a true followPet would land the
    // bubble somewhere completely different from the corner fallback.
    ctx.getPetWindowBounds = () => ({ x: 720, y: 800, width: 60, height: 60 });
    ctx.getNearestWorkArea = () => ({ x: 0, y: 0, width: 800, height: 900 });

    api.repositionUpdateBubble();
    const bubble = api.getBubbleWindow();
    assert.ok(bubble && bubble.bounds, "update bubble bounds should be set");

    // work area: 0..800 x 0..900; bubble width 340 (textScale=1), margin 8.
    // Expected bottom-right anchor: x = 800 - 340 - 8 = 452; y = 900 - 150 - 8 = 742.
    // (estimateHeight for "up-to-date" mode with no message is 150.)
    assert.strictEqual(bubble.bounds.x, 452, "hidden pet must drop bubble to bottom-right (x)");
    assert.strictEqual(bubble.bounds.y, 742, "hidden pet must drop bubble to bottom-right (y)");
  });

  it("completion bubble drops to work-area bottom-right when petHidden + bubbleFollowPet", () => {
    const initCompletionBubble = loadBubbleModule(COMPLETION_BUBBLE_MODULE_PATH, {
      BrowserWindow: FakeBrowserWindow,
    });
    const ctx = buildCompletionCtx({ bubbleFollowPet: true, petHidden: true });
    const api = initCompletionBubble(ctx);

    api.showCompletionBubble({
      title: "Task done",
      prompt: "Refactor finished cleanly.",
    });

    ctx.getPetWindowBounds = () => ({ x: 720, y: 800, width: 60, height: 60 });
    ctx.getNearestWorkArea = () => ({ x: 0, y: 0, width: 800, height: 900 });

    api.repositionCompletionBubble();
    const bubble = api.getBubbleWindow();
    assert.ok(bubble && bubble.bounds, "completion bubble bounds should be set");

    // WIDTH=320, EDGE_MARGIN=8, GAP=6, prompt "Refactor finished cleanly."
    // (26 chars) inflates estimateHeight by +18 = 128. reservedHeight includes
    // +GAP (no permission stack, no update bubble). Bottom-right anchor:
    // x = 800 - 320 - 8 = 472; y = 900 - 8 - 128 - 6 = 758.
    assert.strictEqual(bubble.bounds.x, 472, "hidden pet must drop bubble to bottom-right (x)");
    assert.strictEqual(bubble.bounds.y, 758, "hidden pet must drop bubble to bottom-right (y)");
    api.cleanup();
  });

  it("update bubble follows pet normally when petHidden is false", () => {
    const initUpdateBubble = loadBubbleModule(UPDATE_BUBBLE_MODULE_PATH, {
      BrowserWindow: FakeBrowserWindow,
    });
    const ctx = buildUpdateCtx({ bubbleFollowPet: true, petHidden: false });
    const api = initUpdateBubble(ctx);

    api.showUpdateBubble({
      mode: "up-to-date",
      title: "Up to date",
      message: "Already on the latest version.",
      requireAction: false,
      defaultAction: "dismiss",
    });

    // Pet centred at (360, 120) — bubble should anchor below it.
    ctx.getPetWindowBounds = () => ({ x: 300, y: 60, width: 120, height: 120 });
    ctx.getNearestWorkArea = () => ({ x: 0, y: 0, width: 800, height: 900 });
    ctx.getHitRectScreen = () => ({ left: 300, top: 60, right: 420, bottom: 180 });
    ctx.getUpdateBubbleAnchorRect = () => null;

    api.repositionUpdateBubble();
    const bubble = api.getBubbleWindow();
    assert.ok(bubble && bubble.bounds, "update bubble bounds should be set");

    // followCx=360, belowPetY=180+6=186; x=360-170=190, y=186.
    assert.strictEqual(bubble.bounds.x, 190, "visible pet must anchor bubble below pet (x)");
    assert.strictEqual(bubble.bounds.y, 186, "visible pet must anchor bubble below pet (y)");
  });
});

describe("update bubble syncVisibility honours petHidden ≠ DND", () => {
  it("shows the bubble while petHidden is true (no guard short-circuit)", async () => {
    const initUpdateBubble = loadBubbleModule(UPDATE_BUBBLE_MODULE_PATH, {
      BrowserWindow: FakeBrowserWindow,
    });
    const ctx = buildUpdateCtx({ petHidden: true });
    const api = initUpdateBubble(ctx);

    await api.showUpdateBubble({
      mode: "up-to-date",
      title: "Up to date",
      message: "Already on the latest version.",
      requireAction: false,
      defaultAction: "dismiss",
    });

    const bubble = api.getBubbleWindow();
    assert.ok(bubble, "update bubble should have been created");
    assert.strictEqual(bubble.isVisible(), true, "petHidden must not retract the update bubble");
  });

  it("keeps the bubble visible if petHidden flips true after show", async () => {
    const initUpdateBubble = loadBubbleModule(UPDATE_BUBBLE_MODULE_PATH, {
      BrowserWindow: FakeBrowserWindow,
    });
    const ctx = buildUpdateCtx({ petHidden: false });
    const api = initUpdateBubble(ctx);

    await api.showUpdateBubble({
      mode: "up-to-date",
      title: "Up to date",
      message: "Already on the latest version.",
      requireAction: false,
      defaultAction: "dismiss",
    });

    const bubble = api.getBubbleWindow();
    assert.strictEqual(bubble.isVisible(), true);

    ctx.petHidden = true;
    api.syncVisibility();

    assert.strictEqual(bubble.isVisible(), true, "syncVisibility must keep the update bubble shown when petHidden flips");
  });
});

describe("completion bubble syncVisibility honours petHidden ≠ DND", () => {
  // showCompletionBubble() returns a promise that resolves only when the user
  // dismisses OR autoClose fires; with autoCloseMs > 0 we let the timer settle
  // the promise. We don't await — the bubble window is created synchronously
  // during show(), so the visibility check below is safe immediately.

  it("shows the bubble while petHidden is true (no guard short-circuit)", () => {
    const initCompletionBubble = loadBubbleModule(COMPLETION_BUBBLE_MODULE_PATH, {
      BrowserWindow: FakeBrowserWindow,
    });
    const ctx = buildCompletionCtx({ petHidden: true });
    const api = initCompletionBubble(ctx);

    api.showCompletionBubble({
      title: "Task done",
      prompt: "Refactor finished cleanly.",
    });

    const bubble = api.getBubbleWindow();
    assert.ok(bubble, "completion bubble should have been created");
    assert.strictEqual(bubble.isVisible(), true, "petHidden must not retract the completion bubble");

    api.cleanup();
  });

  it("keeps the bubble visible if petHidden flips true after show", () => {
    const initCompletionBubble = loadBubbleModule(COMPLETION_BUBBLE_MODULE_PATH, {
      BrowserWindow: FakeBrowserWindow,
    });
    const ctx = buildCompletionCtx({ petHidden: false });
    const api = initCompletionBubble(ctx);

    api.showCompletionBubble({
      title: "Task done",
      prompt: "Refactor finished cleanly.",
    });

    const bubble = api.getBubbleWindow();
    assert.strictEqual(bubble.isVisible(), true);

    ctx.petHidden = true;
    api.syncVisibility();

    assert.strictEqual(bubble.isVisible(), true, "syncVisibility must keep the completion bubble shown when petHidden flips");

    api.cleanup();
  });

  it("shows the bubble when miniMode is true (mini is positioning, not silence)", () => {
    // mini mode is a positioning state, not a silence preference — same
    // rule as petHidden. Completion bubbles bypass DND via
    // bubble-policy.js bypassDnd, and mini doesn't gate visibility either,
    // so the bubble shows whether or not mini is on.
    const initCompletionBubble = loadBubbleModule(COMPLETION_BUBBLE_MODULE_PATH, {
      BrowserWindow: FakeBrowserWindow,
    });
    const ctx = buildCompletionCtx({ petHidden: false, miniMode: true });
    const api = initCompletionBubble(ctx);

    api.showCompletionBubble({
      title: "Task done",
      prompt: "Refactor finished cleanly.",
    });

    const bubble = api.getBubbleWindow();
    assert.ok(bubble, "completion bubble should have been created");
    assert.strictEqual(bubble.isVisible(), true, "mini mode alone must NOT suppress the completion toast");

    api.cleanup();
  });

  it("shows the bubble when miniMode + doNotDisturb (mini-sleep, user wants notifications)", () => {
    // mini-sleep is mini mode + DND. Completion bubbles bypass DND by
    // policy (bubble-policy.js bypassDnd), so they fire regardless of DND.
    const initCompletionBubble = loadBubbleModule(COMPLETION_BUBBLE_MODULE_PATH, {
      BrowserWindow: FakeBrowserWindow,
    });
    const ctx = buildCompletionCtx({
      petHidden: false,
      miniMode: true,
      doNotDisturb: true,
    });
    const api = initCompletionBubble(ctx);

    api.showCompletionBubble({
      title: "Task done",
      prompt: "Refactor finished cleanly.",
    });

    const bubble = api.getBubbleWindow();
    assert.ok(bubble, "completion bubble should have been created");
    assert.strictEqual(bubble.isVisible(), true, "mini-sleep must surface the completion toast");

    api.cleanup();
  });
});