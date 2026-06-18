"use strict";

const { describe, it, afterEach, mock } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

let activeControllers = [];

function loadController({ themeOverrides = {}, prefs = { idleRoamingEnabled: true }, theme, skipWalking = false } = {}) {
  const controllerPath = require.resolve("../src/roaming-controller");
  const animatorPath = require.resolve("../src/walking-animator");
  delete require.cache[controllerPath];
  delete require.cache[animatorPath];
  const themeLoader = require("../src/theme-loader");
  themeLoader.init(path.join(__dirname, "..", "src"));
  const baseTheme = theme || themeLoader.loadTheme("clawd");
  const walkingState = skipWalking ? {} : {
    up: ["x.svg"], down: ["x.svg"], left: ["x.svg"], right: ["x.svg"],
    "up-left": ["x.svg"], "up-right": ["x.svg"],
    "down-left": ["x.svg"], "down-right": ["x.svg"],
    paused: ["x.svg"],
  };
  const finalTheme = {
    ...baseTheme,
    walkingRoaming: { ...(baseTheme.walkingRoaming || {}) },
    states: { ...baseTheme.states, walking: walkingState },
    ...themeOverrides,
  };
  if (themeOverrides.states) {
    finalTheme.states = { ...finalTheme.states, ...themeOverrides.states };
  }

  const ctx = {
    theme: finalTheme,
    win: { isDestroyed: () => false, getBounds: () => ({ x: 0, y: 0, width: 120, height: 120 }), setPosition: mock.fn(), setBounds: mock.fn() },
    applyState: mock.fn(),
    syncHitWin: mock.fn(),
    repositionSessionHud: mock.fn(),
    repositionBubbles: mock.fn(),
    syncContainedClip: mock.fn(),
    sendToRenderer: mock.fn(),
    getNearestWorkArea: () => ({ x: 0, y: 0, width: 1920, height: 1040 }),
    getPetWindowBounds: () => ({ x: 0, y: 0, width: 120, height: 120 }),
    clampToScreenVisual: (x, y) => ({ x, y }),
    bubbleFollowPet: false,
    pendingPermissions: [],
    sessions: new Map(),
    idlePaused: false,
    dragLocked: false,
    menuOpen: false,
    miniMode: false,
    doNotDisturb: false,
    getIdleRoamingEnabled: () => !!(prefs && prefs.idleRoamingEnabled),
    resolveDisplayState: () => "idle",
  };

  const ctrl = require("../src/roaming-controller")(ctx);
  activeControllers.push(ctrl);
  return { ctrl, ctx };
}

function loadControllerWithCustomTheme(theme) {
  return loadController({ theme });
}

afterEach(() => {
  for (const c of activeControllers) {
    try { c.cleanup(); } catch {}
  }
  activeControllers = [];
});

describe("RoamingController lifecycle", () => {
  it("isActive returns false initially", () => {
    const { ctrl } = loadController();
    assert.strictEqual(ctrl.isActive(), false);
  });

  it("start is no-op when theme has no walking assets", () => {
    const fakeTheme = {
      name: "fake",
      version: "1.0.0",
      viewBox: { x: 0, y: 0, width: 100, height: 100 },
      states: {
        idle: ["idle.svg"],
        working: ["working.svg"],
        thinking: ["thinking.svg"],
      },
      walkingRoaming: { enabled: true },
    };
    const { ctrl } = loadControllerWithCustomTheme(fakeTheme);
    // Suppress walking injection so the test exercises the no-assets path
    const controllerPath = require.resolve("../src/roaming-controller");
    const animatorPath = require.resolve("../src/walking-animator");
    delete require.cache[controllerPath];
    delete require.cache[animatorPath];
    const reloaded = loadController({ theme: fakeTheme, skipWalking: true });
    reloaded.ctrl.start();
    assert.strictEqual(reloaded.ctrl.isActive(), false);
  });

  it("start applies walking state when conditions met", () => {
    const { ctrl, ctx } = loadController();
    ctrl.start();
    assert.strictEqual(ctrl.isActive(), true);
    assert.ok(ctx.applyState.mock.calls.some((c) => c.arguments[0] === "walking"));
  });

  it("cancel transitions back to idle", () => {
    const { ctrl } = loadController();
    ctrl.start();
    ctrl.cancel();
    assert.strictEqual(ctrl.isActive(), false);
  });

  it("cancel resolves to idle (not stale 'walking') so tick can restart it later", () => {
    // Mirrors state.js's contract: resolveDisplayState returns "walking"
    // while the controller is active and fromSessions ("idle") once inactive.
    // Without this, cancel() pins the state at "walking" with an inactive
    // controller and tick.js never resumes roaming after a drag.
    const { ctrl, ctx } = loadController();
    ctx.resolveDisplayState = () => (ctrl.isActive() ? "walking" : "idle");
    ctrl.start();
    ctrl.cancel();
    const lastApplyState = ctx.applyState.mock.calls[ctx.applyState.mock.calls.length - 1];
    assert.strictEqual(
      lastApplyState.arguments[0],
      "idle",
      "cancel() must resolve to the post-cancel display state, not the stale 'walking'",
    );
  });

  it("start is no-op when getIdleRoamingEnabled returns false", () => {
    const { ctrl, ctx } = loadController({ prefs: { idleRoamingEnabled: false } });
    ctrl.start();
    assert.strictEqual(ctrl.isActive(), false);
    assert.strictEqual(ctx.applyState.mock.calls.length, 0);
  });

  it("start is no-op when dragLocked", () => {
    const { ctrl, ctx } = loadController();
    ctx.dragLocked = true;
    ctrl.start();
    assert.strictEqual(ctrl.isActive(), false);
  });

  it("start is no-op when menuOpen", () => {
    const { ctrl, ctx } = loadController();
    ctx.menuOpen = true;
    ctrl.start();
    assert.strictEqual(ctrl.isActive(), false);
  });

  it("start is no-op when miniMode", () => {
    const { ctrl, ctx } = loadController();
    ctx.miniMode = true;
    ctrl.start();
    assert.strictEqual(ctrl.isActive(), false);
  });

  it("start is no-op when doNotDisturb", () => {
    const { ctrl, ctx } = loadController();
    ctx.doNotDisturb = true;
    ctrl.start();
    assert.strictEqual(ctrl.isActive(), false);
  });

  it("start is no-op when sessions is non-empty", () => {
    const { ctrl, ctx } = loadController();
    ctx.sessions = new Map([["s1", { state: "working" }]]);
    ctrl.start();
    assert.strictEqual(ctrl.isActive(), false);
  });

  it("cancels after maxRoamingDurationMs elapses", () => {
    // Use mock timers so the setTimeout(pauseDurationMs) chain in walk()
    // runs deterministically. NB: Node's mock.timers only fires one
    // timer per tick(), and the animator runs many recursive setTimeouts
    // — one per 16ms frame — so a single long tick won't drain them all.
    // We tick in a loop, one setTimeout per 50ms.
    // Total frames: walk duration floored at 800ms → ~50 frames.
    // After the first walk completes, schedulePause + walk() runs again,
    // and the cap check fires.
    mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
    try {
      const { ctrl, ctx } = loadController({
        themeOverrides: {
          walkingRoaming: {
            maxRoamingDurationMs: 100,
            pauseDurationMs: 5,
            walkDurationMs: 800,
          },
        },
      });
      // Provide a non-zero target so walk() actually moves (otherwise it
      // goes straight into pause and never makes progress toward the cap).
      ctx.getNearestWorkArea = () => ({ x: -1000, y: -1000, width: 4000, height: 2000 });
      ctrl.start();
      assert.strictEqual(ctrl.isActive(), true);
      // First walk: 800ms / 16ms = 50 animator frames. Then 5ms pause
      // timer (fires in next tick since 5 < 50). Then walk() runs again
      // with Date.now() well past the 100ms cap → cap fires.
      // 200 ticks × 50ms = 10000ms of mock time, comfortably past all of it.
      for (let i = 0; i < 200; i++) mock.timers.tick(50);
      assert.strictEqual(ctrl.isActive(), false);
      // cancel() should have routed to ctx.resolveDisplayState() ("idle")
      // and called applyState with it.
      assert.ok(ctx.applyState.mock.calls.some((c) => c.arguments[0] === "idle"));
    } finally {
      mock.timers.reset();
    }
  });

  it("maxRoamingDurationMs=0 disables the cap (no auto-cancel)", () => {
    mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
    try {
      const { ctrl, ctx } = loadController({
        themeOverrides: {
          walkingRoaming: {
            maxRoamingDurationMs: 0,
            pauseDurationMs: 5,
          },
        },
      });
      ctx.getNearestWorkArea = () => ({ x: -1000, y: -1000, width: 4000, height: 2000 });
      ctrl.start();
      assert.strictEqual(ctrl.isActive(), true);
      // Past where the cap would normally fire. Even with the walk/pause
      // loop running many cycles, no cap should fire.
      for (let i = 0; i < 200; i++) mock.timers.tick(50);
      assert.strictEqual(ctrl.isActive(), true);
      ctrl.cancel();
    } finally {
      mock.timers.reset();
    }
  });
});
