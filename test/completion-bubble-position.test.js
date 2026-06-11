"use strict";

// Tests for the completion bubble module. The module requires `electron` at
// top level (BrowserWindow), so we stub it via the require.cache mock pattern
// established in test/mini.test.js and test/tick.test.js. We only need
// BrowserWindow / ipcMain stubs for `require()` to succeed; the actual bubble
// windowing isn't exercised here — these tests cover the pure helpers and
// the bounds computation.

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");

const electronPath = require.resolve("electron");
const completionBubblePath = require.resolve("../src/completion-bubble");
const taskbarPath = require.resolve("../src/taskbar");
const previousElectron = Object.prototype.hasOwnProperty.call(require.cache, electronPath)
  ? require.cache[electronPath]
  : null;
const previousCompletionBubble = Object.prototype.hasOwnProperty.call(require.cache, completionBubblePath)
  ? require.cache[completionBubblePath]
  : null;
const previousTaskbar = Object.prototype.hasOwnProperty.call(require.cache, taskbarPath)
  ? require.cache[taskbarPath]
  : null;

require.cache[electronPath] = {
  id: electronPath,
  filename: electronPath,
  loaded: true,
  exports: {
    BrowserWindow: class {},
    ipcMain: { on: () => {}, removeListener: () => {} },
    contextBridge: { exposeInMainWorld: () => {} },
    ipcRenderer: { on: () => {}, send: () => {} },
  },
};
require.cache[taskbarPath] = {
  id: taskbarPath,
  filename: taskbarPath,
  loaded: true,
  exports: { keepOutOfTaskbar: () => {} },
};
delete require.cache[completionBubblePath];

const completionBubble = require("../src/completion-bubble");
const { __test } = completionBubble;
const {
  computeCompletionBubbleBounds,
  estimateHeight,
  computeAutoCloseRemainingMs,
} = __test;

after(() => {
  if (previousElectron) require.cache[electronPath] = previousElectron;
  else delete require.cache[electronPath];
  if (previousCompletionBubble) require.cache[completionBubblePath] = previousCompletionBubble;
  else delete require.cache[completionBubblePath];
  if (previousTaskbar) require.cache[taskbarPath] = previousTaskbar;
  else delete require.cache[taskbarPath];
});

describe("completion bubble positioning", () => {
  const baseOpts = () => ({
    bubbleFollowPet: true,
    width: 320,
    edgeMargin: 8,
    gap: 6,
    height: 130,
    reservedHeight: 0,
    workArea: { x: 0, y: 0, width: 800, height: 900 },
    petBounds: { x: 300, y: 60, width: 120, height: 120 },
    anchorRect: { left: 320, top: 88, right: 400, bottom: 168 },
  });

  it("anchors below the follow rect with the reserved stack offset applied", () => {
    // No permission stack + no update bubble: bubble sits just under pet.
    const bounds = computeCompletionBubbleBounds({
      ...baseOpts(),
      reservedHeight: 0,
    });
    // followTop=88, followRectBottom=168; underPetY = 168+6+0 = 174
    // followCx = (320+400)/2 = 360; x = 360 - 160 = 200
    assert.deepStrictEqual(bounds, { x: 200, y: 174, width: 320, height: 130 });
  });

  it("drops further when a permission stack reserves space above", () => {
    const bounds = computeCompletionBubbleBounds({
      ...baseOpts(),
      reservedHeight: 206,
    });
    // underPetY = 168 + 6 + 206 = 380
    assert.deepStrictEqual(bounds, { x: 200, y: 380, width: 320, height: 130 });
  });

  it("centers horizontally over the pet's center axis", () => {
    const bounds = computeCompletionBubbleBounds(baseOpts());
    assert.strictEqual(bounds.x, 200);
  });

  it("clamps the y coordinate inside the work area top edge", () => {
    const bounds = computeCompletionBubbleBounds({
      ...baseOpts(),
      // Anchor pet near the top so the bubble would naturally land above
      // edgeMargin without the clamp.
      anchorRect: { left: 320, top: -100, right: 400, bottom: 20 },
      petBounds: { x: 300, y: -180, width: 120, height: 120 },
    });
    assert.ok(bounds.y >= 8, `y=${bounds.y} must be clamped to edgeMargin`);
  });

  it("falls back when the cumulative reserve exceeds the below-pet lane", () => {
    const bounds = computeCompletionBubbleBounds({
      ...baseOpts(),
      reservedHeight: 700,
    });
    // When reserve is huge, switch to side-of-pet fallback. y must still
    // fit the work area (clamped at maxY = 900 - 8 - 130 = 762).
    assert.ok(bounds.y >= 8 && bounds.y <= 762, `y=${bounds.y} fits in work area`);
  });
});

describe("completion bubble estimateHeight", () => {
  it("returns the base height for an empty payload", () => {
    assert.strictEqual(estimateHeight({}), 110);
    assert.strictEqual(estimateHeight(null), 110);
  });

  it("scales with prompt length", () => {
    const small = estimateHeight({ prompt: "hi" });
    const large = estimateHeight({
      prompt: "This is a much longer prompt that should wrap across multiple lines at width 320px",
    });
    assert.ok(large > small, `large (${large}) should be taller than small (${small})`);
  });
});

describe("completion bubble autoClose remaining", () => {
  it("returns the full window when no start timestamp is given", () => {
    assert.strictEqual(computeAutoCloseRemainingMs(0, 2000, Date.now()), 2000);
  });

  it("subtracts elapsed time from the window", () => {
    const now = Date.now();
    const shownAt = now - 500;
    assert.strictEqual(computeAutoCloseRemainingMs(shownAt, 2000, now), 1500);
  });

  it("clamps to zero once the window has elapsed", () => {
    const now = Date.now();
    const shownAt = now - 5000;
    assert.strictEqual(computeAutoCloseRemainingMs(shownAt, 2000, now), 0);
  });

  it("returns 0 when autoCloseMs is non-positive", () => {
    assert.strictEqual(computeAutoCloseRemainingMs(Date.now(), 0), 0);
    assert.strictEqual(computeAutoCloseRemainingMs(Date.now(), -100), 0);
  });
});