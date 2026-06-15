"use strict";

const { pickWalkingTarget, computeWalkDuration, WALKING_DIRECTIONS } = require("./walking-target-picker");
const { animateWindowXY } = require("./walking-animator");

let screenModule = null;
try {
  screenModule = require("electron").screen;
} catch {
  screenModule = null;
}

const DIRECTION_FALLBACK = {
  "up-left": "left",
  "up-right": "right",
  "down-left": "left",
  "down-right": "right",
};

function themeHasWalkingAssets(theme) {
  const walking = theme && theme.states && theme.states.walking;
  if (!walking || typeof walking !== "object") return false;
  return WALKING_DIRECTIONS.every(
    (dir) => Array.isArray(walking[dir]) && walking[dir].length > 0
  );
}

function getWalkingFileForDirection(theme, direction) {
  const walking = theme && theme.states && theme.states.walking;
  if (!walking) return null;
  const entry = walking[direction];
  if (Array.isArray(entry) && entry.length > 0) return entry[0];
  const fallbackKey = DIRECTION_FALLBACK[direction] || direction;
  const fallback = walking[fallbackKey];
  if (Array.isArray(fallback) && fallback.length > 0) return fallback[0];
  return null;
}

function mergeRoaming(theme, defaultRoaming) {
  return { ...defaultRoaming, ...(theme && theme.walkingRoaming) };
}

module.exports = function initRoamingController(ctx) {
  let active = false;
  let currentDirection = "paused";
  let cancelAnim = null;
  let pauseTimer = null;
  let walkStartedAt = 0;

  function getEffectiveRoaming() {
    return mergeRoaming(ctx.theme, ctx.defaultWalkingRoaming || {});
  }

  function isThemeSupported() {
    return themeHasWalkingAssets(ctx.theme);
  }

  function canStartNow() {
    if (!isThemeSupported()) return false;
    if (!ctx.getIdleRoamingEnabled || !ctx.getIdleRoamingEnabled()) return false;
    if (ctx.idlePaused) return false;
    if (ctx.dragLocked || ctx.menuOpen || ctx.miniMode || ctx.doNotDisturb) return false;
    if (process.env.CLAWD_FORCE_WALK === "1") return true;
    if (ctx.sessions && typeof ctx.sessions.size === "number" && ctx.sessions.size > 0) return false;
    return true;
  }

  function getOriginBounds() {
    if (typeof ctx.getPetWindowBounds === "function") return ctx.getPetWindowBounds();
    if (ctx.win && typeof ctx.win.getBounds === "function") return ctx.win.getBounds();
    return { x: 0, y: 0, width: 120, height: 120 };
  }

  function getSize() {
    if (typeof ctx.getEffectiveCurrentPixelSize === "function") return ctx.getEffectiveCurrentPixelSize();
    if (typeof ctx.getCurrentPixelSize === "function") return ctx.getCurrentPixelSize();
    return { width: 120, height: 120 };
  }

  function getPrimaryWorkArea() {
    if (typeof ctx.getNearestWorkArea === "function") {
      const bounds = getOriginBounds();
      return ctx.getNearestWorkArea(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    }
    return { x: 0, y: 0, width: 1920, height: 1040 };
  }

  function getAllDisplays() {
    if (!screenModule || typeof screenModule.getAllDisplays !== "function") return [];
    try {
      const d = screenModule.getAllDisplays();
      return Array.isArray(d) ? d : [];
    } catch {
      return [];
    }
  }

  function applyWalking(direction) {
    const file = getWalkingFileForDirection(ctx.theme, direction) ||
                 getWalkingFileForDirection(ctx.theme, "right") ||
                 getWalkingFileForDirection(ctx.theme, "paused");
    currentDirection = direction;
    if (typeof ctx.applyState === "function") ctx.applyState("walking", file, direction);
    if (typeof ctx.sendToRenderer === "function") {
      ctx.sendToRenderer("walking-direction", direction);
    }
  }

  function pickNextStep() {
    const origin = getOriginBounds();
    const size = getSize();
    const primaryWa = getPrimaryWorkArea();
    const roaming = getEffectiveRoaming();
    const target = pickWalkingTarget({
      origin,
      size,
      displays: getAllDisplays(),
      primaryWa,
      roaming,
      rng: Math.random,
    });
    return { origin, target };
  }

  function walk() {
    if (!active) return;
    const roaming = getEffectiveRoaming();
    // Cap the total time the pet spends walking in one go. Walking replaces
    // idle as the default state, but the pet shouldn't walk forever — once
    // maxRoamingDurationMs elapses we voluntarily give way to whatever the
    // state resolver picks (idle by default, which then triggers the normal
    // mouse-idle → sleep sequence).
    const maxRoaming = Number.isFinite(roaming.maxRoamingDurationMs) ? roaming.maxRoamingDurationMs : 60000;
    if (maxRoaming > 0 && Date.now() - walkStartedAt >= maxRoaming) {
      cancel("max-duration");
      return;
    }
    const { origin, target } = pickNextStep();
    if (!target) {
      schedulePause();
      return;
    }
    applyWalking(target.direction);
    const duration = computeWalkDuration(origin, target, roaming);
    cancelAnim = animateWindowXY(ctx, { x: target.x, y: target.y }, duration, () => {
      cancelAnim = null;
      if (!active) return;
      schedulePause();
    });
  }

  function schedulePause() {
    if (!active) return;
    applyWalking("paused");
    const roaming = getEffectiveRoaming();
    const pauseMs = roaming.pauseDurationMs || 2500;
    pauseTimer = setTimeout(() => {
      pauseTimer = null;
      if (!active) return;
      walk();
    }, pauseMs);
  }

  function cancel(reason) {
    if (!active) return;
    active = false;
    walkStartedAt = 0;
    if (cancelAnim) {
      cancelAnim();
      cancelAnim = null;
    }
    if (pauseTimer) {
      clearTimeout(pauseTimer);
      pauseTimer = null;
    }
    const next = (typeof ctx.resolveDisplayState === "function") ? ctx.resolveDisplayState() : "idle";
    if (typeof ctx.applyState === "function") ctx.applyState(next);
    if (typeof ctx.sendToRenderer === "function") {
      ctx.sendToRenderer("walking-direction", null);
    }
  }

  return {
    start() {
      if (active) return;
      if (!canStartNow()) return;
      active = true;
      walkStartedAt = Date.now();
      walk();
    },
    cancel,
    isActive() { return active; },
    getDirection() { return currentDirection; },
    refreshTheme() {
      if (active) {
        const roaming = getEffectiveRoaming();
        if (roaming.enabled === false) {
          cancel("theme-disabled");
        }
      }
    },
    refreshSettings() {
      if (active && (!ctx.getIdleRoamingEnabled || !ctx.getIdleRoamingEnabled())) {
        cancel("settings-disabled");
      }
    },
    handleDisplayChange() {
      if (!active) return;
      cancel("display-change");
    },
    cleanup() {
      this.cancel("cleanup");
    },
  };
};
