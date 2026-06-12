"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  DIRECTIONS,
  pickWalkingTarget,
  isInAvoidRadius,
  computeWalkDuration,
} = require("../src/walking-target-picker");

describe("DIRECTIONS", () => {
  it("lists all 8 cardinal + diagonal + paused", () => {
    assert.deepStrictEqual(
      [...DIRECTIONS].sort(),
      ["down", "down-left", "down-right", "left", "paused", "right", "up", "up-left", "up-right"]
    );
  });
});

describe("isInAvoidRadius", () => {
  it("returns true when target is inside avoid radius", () => {
    assert.strictEqual(isInAvoidRadius({ x: 100, y: 100 }, { x: 110, y: 110 }, 50), true);
  });
  it("returns false when target is outside avoid radius", () => {
    assert.strictEqual(isInAvoidRadius({ x: 100, y: 100 }, { x: 200, y: 100 }, 50), false);
  });
  it("uses Euclidean distance (diagonal counts)", () => {
    assert.strictEqual(isInAvoidRadius({ x: 0, y: 0 }, { x: 30, y: 30 }, 50), true);
    assert.strictEqual(isInAvoidRadius({ x: 0, y: 0 }, { x: 60, y: 60 }, 50), false);
  });
});

describe("computeWalkDuration", () => {
  it("returns configured walkDurationMs from roaming config", () => {
    const ms = computeWalkDuration(
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      { walkDurationMs: 3500, walkSpeedPxPerSec: 80 }
    );
    assert.strictEqual(ms, 3500);
  });

  it("clamps to cap walkDurationMs if speed requires it", () => {
    const ms = computeWalkDuration(
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { walkDurationMs: 3500, walkSpeedPxPerSec: 80, maxWalkDurationMs: 6000 }
    );
    assert.ok(ms <= 6000);
  });
});

describe("pickWalkingTarget", () => {
  const displays = [
    { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
  ];
  const primaryWa = displays[0].workArea;
  const size = { width: 120, height: 120 };
  const roaming = {
    minTargetDistPx: 180,
    maxTargetDistPx: 320,
    avoidRadiusPx: 150,
    walkDurationMs: 3500,
  };

  it("returns a clamped position inside the workArea (with margin)", () => {
    const origin = { x: 960, y: 520 };
    for (let i = 0; i < 50; i++) {
      const target = pickWalkingTarget({
        origin,
        size,
        displays,
        primaryWa,
        roaming,
        rng: Math.random,
      });
      assert.ok(Number.isFinite(target.x));
      assert.ok(Number.isFinite(target.y));
      assert.ok(target.x >= primaryWa.x - 80);
      assert.ok(target.y >= primaryWa.y - 40);
      assert.ok(target.x + size.width <= primaryWa.x + primaryWa.width + 80);
      assert.ok(target.y + size.height <= primaryWa.y + primaryWa.height + 40);
    }
  });

  it("respects avoid radius: target is outside avoid radius of origin", () => {
    const origin = { x: 960, y: 520 };
    for (let i = 0; i < 50; i++) {
      const target = pickWalkingTarget({
        origin,
        size,
        displays,
        primaryWa,
        roaming,
        rng: Math.random,
      });
      const dx = target.x - origin.x;
      const dy = target.y - origin.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      assert.ok(dist >= 150, `target distance ${dist} < avoid radius 150`);
    }
  });

  it("returns a moving direction (one of 8 directions, never paused)", () => {
    const target = pickWalkingTarget({
      origin: { x: 960, y: 520 },
      size,
      displays,
      primaryWa,
      roaming,
      rng: Math.random,
    });
    assert.ok(DIRECTIONS.has(target.direction));
    assert.notStrictEqual(target.direction, "paused");
  });

  it("uses injected rng for deterministic targets", () => {
    const a = pickWalkingTarget({
      origin: { x: 960, y: 520 },
      size,
      displays,
      primaryWa,
      roaming,
      rng: () => 0.99,
    });
    const b = pickWalkingTarget({
      origin: { x: 960, y: 520 },
      size,
      displays,
      primaryWa,
      roaming,
      rng: () => 0.99,
    });
    assert.deepStrictEqual(a, b);
  });
});
