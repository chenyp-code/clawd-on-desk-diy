"use strict";

const { describe, it, beforeEach, afterEach, mock } = require("node:test");
const assert = require("node:assert");

describe("animateWindowXY", () => {
  let realSetTimeout;
  let setTimeoutMock;
  let frames;
  let onDone;

  beforeEach(() => {
    frames = [];
    onDone = mock.fn();
    realSetTimeout = global.setTimeout;
    setTimeoutMock = mock.fn((fn, ms) => {
      frames.push({ fn, ms });
      return frames.length;
    });
    global.setTimeout = setTimeoutMock;
  });

  afterEach(() => {
    global.setTimeout = realSetTimeout;
    mock.restoreAll();
  });

  function loadAnimator() {
    const path = require.resolve("../src/walking-animator");
    delete require.cache[path];
    return require("../src/walking-animator");
  }

  function makeCtx() {
    return {
      win: {
        isDestroyed: () => false,
        getBounds: () => ({ x: 0, y: 0, width: 120, height: 120 }),
        setPosition: mock.fn(),
        setBounds: mock.fn(),
      },
      syncHitWin: mock.fn(),
      repositionSessionHud: mock.fn(),
      repositionBubbles: mock.fn(),
      syncContainedClip: mock.fn(),
      bubbleFollowPet: false,
      pendingPermissions: [],
    };
  }

  it("calls setPosition each frame and finishes via onDone", () => {
    const { animateWindowXY } = loadAnimator();
    const ctx = makeCtx();
    animateWindowXY(ctx, { x: 240, y: 100 }, 800, onDone);

    assert.strictEqual(frames.length, 1);
    assert.strictEqual(frames[0].ms, 16);

    for (let i = 0; i < 25; i++) frames[0].fn();
    const halfwayCall = ctx.win.setPosition.mock.calls[Math.floor(ctx.win.setPosition.mock.calls.length / 2)];
    assert.ok(halfwayCall);

    for (let i = 0; i < 60; i++) {
      if (frames.length === 0) break;
      const last = frames[frames.length - 1];
      if (last && last.ms === 16) last.fn();
    }

    assert.strictEqual(onDone.mock.calls.length, 1);
    const lastCall = ctx.win.setPosition.mock.calls[ctx.win.setPosition.mock.calls.length - 1];
    assert.deepStrictEqual(lastCall.arguments[0], { x: 240, y: 100 });
  });

  it("invokes onDone immediately if already at target", () => {
    const { animateWindowXY } = loadAnimator();
    const ctx = {
      win: {
        isDestroyed: () => false,
        getBounds: () => ({ x: 240, y: 100, width: 120, height: 120 }),
      },
      syncHitWin: mock.fn(),
      repositionSessionHud: mock.fn(),
    };
    animateWindowXY(ctx, { x: 240, y: 100 }, 800, onDone);
    assert.strictEqual(onDone.mock.calls.length, 1);
    assert.strictEqual(frames.length, 0);
  });

  it("bails out cleanly when window is destroyed mid-animation", () => {
    let destroyed = false;
    const { animateWindowXY } = loadAnimator();
    const ctx = {
      win: {
        isDestroyed: () => destroyed,
        getBounds: () => ({ x: 0, y: 0, width: 120, height: 120 }),
        setPosition: mock.fn(),
      },
      syncHitWin: mock.fn(),
      repositionSessionHud: mock.fn(),
    };
    animateWindowXY(ctx, { x: 240, y: 100 }, 800, onDone);
    destroyed = true;
    if (frames[0]) frames[0].fn();
    assert.strictEqual(onDone.mock.calls.length, 1);
  });

  it("returns a cancel function that prevents further frames and onDone", () => {
    const { animateWindowXY } = loadAnimator();
    const ctx = makeCtx();
    const cancel = animateWindowXY(ctx, { x: 240, y: 100 }, 800, onDone);
    cancel();
    assert.strictEqual(frames.length, 1, "frame should not have been re-scheduled");
    if (frames[0]) frames[0].fn();
    assert.strictEqual(onDone.mock.calls.length, 0);
    assert.strictEqual(ctx.win.setPosition.mock.calls.length, 0);
  });
});
