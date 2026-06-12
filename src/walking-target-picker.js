"use strict";

const { computeLooseClamp } = require("./work-area");

const DIRECTIONS = new Set([
  "up",
  "down",
  "left",
  "right",
  "up-left",
  "up-right",
  "down-left",
  "down-right",
  "paused",
]);

const MOVING_DIRECTIONS = [
  "up",
  "down",
  "left",
  "right",
  "up-left",
  "up-right",
  "down-left",
  "down-right",
];

const DIRECTION_VECTORS = Object.freeze({
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
  "up-left": { dx: -0.7071, dy: -0.7071 },
  "up-right": { dx: 0.7071, dy: -0.7071 },
  "down-left": { dx: -0.7071, dy: 0.7071 },
  "down-right": { dx: 0.7071, dy: 0.7071 },
});

const SQRT2 = Math.SQRT2;
const DIRECTION_VECTORS_NORMALIZED = Object.freeze({
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
  "up-left": { dx: -1 / SQRT2, dy: -1 / SQRT2 },
  "up-right": { dx: 1 / SQRT2, dy: -1 / SQRT2 },
  "down-left": { dx: -1 / SQRT2, dy: 1 / SQRT2 },
  "down-right": { dx: 1 / SQRT2, dy: 1 / SQRT2 },
});

function isInAvoidRadius(origin, target, avoidRadiusPx) {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  return dx * dx + dy * dy < avoidRadiusPx * avoidRadiusPx;
}

function computeWalkDuration(origin, target, roaming) {
  const configured = roaming.walkDurationMs || 3500;
  const cap = roaming.maxWalkDurationMs || 8000;
  return Math.max(800, Math.min(cap, configured));
}

function pickWalkingTarget({ origin, size, displays, primaryWa, roaming, rng = Math.random, maxRetries = 8 }) {
  const minDist = roaming.minTargetDistPx || 180;
  const maxDist = roaming.maxTargetDistPx || 320;
  const avoid = roaming.avoidRadiusPx || 150;

  let bestCandidate = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const dirKey = MOVING_DIRECTIONS[Math.floor(rng() * MOVING_DIRECTIONS.length)];
    const vec = DIRECTION_VECTORS_NORMALIZED[dirKey];
    const dist = minDist + rng() * (maxDist - minDist);
    const rawX = origin.x + vec.dx * dist;
    const rawY = origin.y + vec.dy * dist;

    const loose = computeLooseClamp(
      displays,
      primaryWa,
      rawX,
      rawY,
      size.width,
      size.height,
      { marginX: 80, marginTop: 40, marginBottom: 40 }
    );
    const candidate = { x: loose.x, y: loose.y, direction: dirKey };

    if (!isInAvoidRadius(origin, candidate, avoid)) {
      return candidate;
    }
    if (!bestCandidate) bestCandidate = candidate;
  }
  return bestCandidate || {
    x: origin.x,
    y: origin.y,
    direction: "paused",
  };
}

module.exports = {
  DIRECTIONS,
  DIRECTION_VECTORS,
  MOVING_DIRECTIONS,
  isInAvoidRadius,
  computeWalkDuration,
  pickWalkingTarget,
};
