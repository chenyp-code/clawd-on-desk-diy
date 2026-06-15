"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  DIRECTIONS,
  pickWalkingTarget,
  isInAvoidRadius,
  computeWalkDuration,
  clampToNearestWorkArea,
  getAllowedDirections,
  MOVING_DIRECTIONS,
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

  it("returns a clamped position strictly inside the nearest workArea (no margin)", () => {
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
      assert.ok(target.x >= primaryWa.x, `target.x ${target.x} < workArea.x ${primaryWa.x}`);
      assert.ok(target.y >= primaryWa.y, `target.y ${target.y} < workArea.y ${primaryWa.y}`);
      assert.ok(
        target.x + size.width <= primaryWa.x + primaryWa.width,
        `target.x+w ${target.x + size.width} > workArea right ${primaryWa.x + primaryWa.width}`
      );
      assert.ok(
        target.y + size.height <= primaryWa.y + primaryWa.height,
        `target.y+h ${target.y + size.height} > workArea bottom ${primaryWa.y + primaryWa.height}`
      );
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

describe("clampToNearestWorkArea", () => {
  // Two monitors side by side with a 100px horizontal gap between them.
  // The old computeLooseClamp used the bounding box of both, which let the pet
  // land in the gap — the visible "walks off the screen" bug.
  const displays = [
    { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
    { bounds: { x: 2020, y: 0, width: 1920, height: 1080 }, workArea: { x: 2020, y: 0, width: 1920, height: 1040 } },
  ];
  const primaryWa = displays[0].workArea;
  const size = { width: 120, height: 120 };

  it("clamps an over-right target on the left monitor to that monitor's right edge", () => {
    const origin = { x: 1800, y: 500 };
    const clamped = clampToNearestWorkArea(displays, primaryWa, origin, 1900, 500, size.width, size.height);
    // origin midpoint is on the left monitor → must stay there
    assert.strictEqual(clamped.x, 1920 - size.width);
    assert.strictEqual(clamped.y, 500);
  });

  it("never produces a target inside the inter-monitor gap", () => {
    const origin = { x: 1800, y: 500 };
    for (let i = 0; i < 200; i++) {
      const target = pickWalkingTarget({
        origin,
        size,
        displays,
        primaryWa,
        roaming: { minTargetDistPx: 180, maxTargetDistPx: 320, avoidRadiusPx: 150, walkDurationMs: 3500 },
        rng: Math.random,
      });
      const cx = target.x + size.width / 2;
      const inLeft = cx >= 0 && cx <= 1920;
      const inRight = cx >= 2020 && cx <= 3940;
      assert.ok(
        inLeft || inRight,
        `target center ${cx} fell into the gap between monitors`
      );
    }
  });
});

describe("getAllowedDirections", () => {
  const size = { width: 120, height: 120 };
  const workArea = { x: 0, y: 0, width: 1920, height: 1040 };

  it("returns all 8 directions when the pet is well inside the work area", () => {
    const origin = { x: 900, y: 500 };
    const allowed = getAllowedDirections(origin, size, workArea);
    assert.deepStrictEqual(allowed.sort(), [...MOVING_DIRECTIONS].sort());
  });

  it("excludes leftward directions when the pet is touching the left edge", () => {
    const origin = { x: 0, y: 500 };
    const allowed = getAllowedDirections(origin, size, workArea);
    assert.deepStrictEqual(
      allowed.sort(),
      ["down", "down-right", "right", "up", "up-right"]
    );
  });

  it("excludes rightward directions when the pet is touching the right edge", () => {
    const origin = { x: 1920 - size.width, y: 500 };
    const allowed = getAllowedDirections(origin, size, workArea);
    assert.deepStrictEqual(
      allowed.sort(),
      ["down", "down-left", "left", "up", "up-left"]
    );
  });

  it("excludes upward directions when the pet is touching the top edge", () => {
    const origin = { x: 900, y: 0 };
    const allowed = getAllowedDirections(origin, size, workArea);
    assert.deepStrictEqual(
      allowed.sort(),
      ["down", "down-left", "down-right", "left", "right"]
    );
  });

  it("excludes downward directions when the pet is touching the bottom edge", () => {
    const origin = { x: 900, y: 1040 - size.height };
    const allowed = getAllowedDirections(origin, size, workArea);
    assert.deepStrictEqual(
      allowed.sort(),
      ["left", "right", "up", "up-left", "up-right"]
    );
  });

  it("leaves only up + up-right + right at the bottom-left corner", () => {
    const origin = { x: 0, y: 1040 - size.height };
    const allowed = getAllowedDirections(origin, size, workArea);
    assert.deepStrictEqual(allowed.sort(), ["right", "up", "up-right"]);
  });

  it("leaves only up + up-left + left at the bottom-right corner", () => {
    const origin = { x: 1920 - size.width, y: 1040 - size.height };
    const allowed = getAllowedDirections(origin, size, workArea);
    assert.deepStrictEqual(allowed.sort(), ["left", "up", "up-left"]);
  });

  it("leaves only down + down-left + left at the top-right corner", () => {
    const origin = { x: 1920 - size.width, y: 0 };
    const allowed = getAllowedDirections(origin, size, workArea);
    assert.deepStrictEqual(allowed.sort(), ["down", "down-left", "left"]);
  });

  it("falls back to all 8 directions when no workArea is given", () => {
    const allowed = getAllowedDirections({ x: 0, y: 0 }, size, null);
    assert.deepStrictEqual(allowed.sort(), [...MOVING_DIRECTIONS].sort());
  });

  it("respects a custom edge threshold", () => {
    // 10px from the left edge, threshold of 15px → still considered "touching"
    const origin = { x: 10, y: 500 };
    const allowed = getAllowedDirections(origin, size, workArea, 15);
    assert.deepStrictEqual(
      allowed.sort(),
      ["down", "down-right", "right", "up", "up-right"]
    );
  });
});

describe("pickWalkingTarget edge-aware", () => {
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

  it("never picks a leftward direction at the left edge", () => {
    const origin = { x: 0, y: 500 };
    for (let i = 0; i < 100; i++) {
      const target = pickWalkingTarget({
        origin,
        size,
        displays,
        primaryWa,
        roaming,
        rng: Math.random,
      });
      assert.ok(
        !["left", "up-left", "down-left"].includes(target.direction),
        `picked ${target.direction} at left edge`
      );
    }
  });

  it("never picks a rightward direction at the right edge", () => {
    const origin = { x: 1920 - size.width, y: 500 };
    for (let i = 0; i < 100; i++) {
      const target = pickWalkingTarget({
        origin,
        size,
        displays,
        primaryWa,
        roaming,
        rng: Math.random,
      });
      assert.ok(
        !["right", "up-right", "down-right"].includes(target.direction),
        `picked ${target.direction} at right edge`
      );
    }
  });

  it("never picks an upward direction at the top edge", () => {
    const origin = { x: 900, y: 0 };
    for (let i = 0; i < 100; i++) {
      const target = pickWalkingTarget({
        origin,
        size,
        displays,
        primaryWa,
        roaming,
        rng: Math.random,
      });
      assert.ok(
        !["up", "up-left", "up-right"].includes(target.direction),
        `picked ${target.direction} at top edge`
      );
    }
  });

  it("never picks a downward direction at the bottom edge", () => {
    const origin = { x: 900, y: 1040 - size.height };
    for (let i = 0; i < 100; i++) {
      const target = pickWalkingTarget({
        origin,
        size,
        displays,
        primaryWa,
        roaming,
        rng: Math.random,
      });
      assert.ok(
        !["down", "down-left", "down-right"].includes(target.direction),
        `picked ${target.direction} at bottom edge`
      );
    }
  });
});
