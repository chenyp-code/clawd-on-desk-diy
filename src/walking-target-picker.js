"use strict";

const { findNearestWorkArea } = require("./work-area");

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

// Canonical ordered list of all 9 walking direction keys (8 moving + paused).
// Exported as a frozen array so other modules can iterate in a stable order
// (theme cards, override validation) or use `.includes()` for membership.
const WALKING_DIRECTIONS = Object.freeze([...DIRECTIONS]);

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

// Directions that move the pet INTO a given screen edge (toward smaller x,
// larger x, smaller y, or larger y). When the pet is touching that edge, the
// picker excludes these so it can't pick a direction that would walk it off
// the screen.
const DIRECTIONS_INTO_EDGE = Object.freeze({
  left: new Set(["left", "up-left", "down-left"]),
  right: new Set(["right", "up-right", "down-right"]),
  top: new Set(["up", "up-left", "up-right"]),
  bottom: new Set(["down", "down-left", "down-right"]),
});

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

function clampToNearestWorkArea(displays, primaryWa, origin, x, y, w, h) {
  // Use the work area of the *nearest* display, not the bounding box of every
  // attached display. The bounding-box approach let the pet land in the gap
  // between monitors or hang off the edge of a multi-display desktop — the
  // user sees the pet "walking off the screen."
  const cx = origin.x + w / 2;
  const cy = origin.y + h / 2;
  const wa = findNearestWorkArea(displays, primaryWa, cx, cy);
  return {
    x: Math.max(wa.x, Math.min(x, wa.x + wa.width - w)),
    y: Math.max(wa.y, Math.min(y, wa.y + wa.height - h)),
  };
}

// Returns the subset of MOVING_DIRECTIONS the pet is allowed to pick given
// its current position and the work area of the display it's on. When the
// pet is touching an edge of that work area (within `threshold` pixels),
// directions that would move it further into that edge are excluded. Falls
// back to the full MOVING_DIRECTIONS list if filtering would leave no
// options (e.g. origin lies outside the work area).
function getAllowedDirections(origin, size, workArea, threshold = 5) {
  if (!workArea) return [...MOVING_DIRECTIONS];
  const allowed = new Set(MOVING_DIRECTIONS);
  if (origin.x - workArea.x <= threshold) {
    for (const d of DIRECTIONS_INTO_EDGE.left) allowed.delete(d);
  }
  if (workArea.x + workArea.width - (origin.x + size.width) <= threshold) {
    for (const d of DIRECTIONS_INTO_EDGE.right) allowed.delete(d);
  }
  if (origin.y - workArea.y <= threshold) {
    for (const d of DIRECTIONS_INTO_EDGE.top) allowed.delete(d);
  }
  if (workArea.y + workArea.height - (origin.y + size.height) <= threshold) {
    for (const d of DIRECTIONS_INTO_EDGE.bottom) allowed.delete(d);
  }
  return [...allowed];
}

function pickWalkingTarget({ origin, size, displays, primaryWa, roaming, rng = Math.random, maxRetries = 8 }) {
  const minDist = roaming.minTargetDistPx || 180;
  const maxDist = roaming.maxTargetDistPx || 320;
  const avoid = roaming.avoidRadiusPx || 150;

  const cx = origin.x + size.width / 2;
  const cy = origin.y + size.height / 2;
  const wa = findNearestWorkArea(displays, primaryWa, cx, cy);
  const allowed = getAllowedDirections(origin, size, wa);
  const directionPool = allowed.length > 0 ? allowed : MOVING_DIRECTIONS;

  let bestCandidate = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const dirKey = directionPool[Math.floor(rng() * directionPool.length)];
    const vec = DIRECTION_VECTORS_NORMALIZED[dirKey];
    const dist = minDist + rng() * (maxDist - minDist);
    const rawX = origin.x + vec.dx * dist;
    const rawY = origin.y + vec.dy * dist;

    const clamped = clampToNearestWorkArea(
      displays,
      primaryWa,
      origin,
      rawX,
      rawY,
      size.width,
      size.height,
    );
    const candidate = { x: clamped.x, y: clamped.y, direction: dirKey };

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
  DIRECTIONS_INTO_EDGE,
  MOVING_DIRECTIONS,
  WALKING_DIRECTIONS,
  getAllowedDirections,
  isInAvoidRadius,
  computeWalkDuration,
  clampToNearestWorkArea,
  pickWalkingTarget,
};
