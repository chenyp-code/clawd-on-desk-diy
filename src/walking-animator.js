"use strict";

const FRAME_MS = 16;
const MIN_DURATION_MS = 200;

function animateWindowXY(ctx, target, durationMs, onDone) {
  const win = ctx && ctx.win;
  if (!win || (typeof win.isDestroyed === "function" && win.isDestroyed()) || typeof win.getBounds !== "function") {
    if (typeof onDone === "function") onDone();
    return () => {};
  }
  const bounds = win.getBounds();
  const startX = bounds.x;
  const startY = bounds.y;
  const safeDuration = Math.max(MIN_DURATION_MS, Number.isFinite(durationMs) ? durationMs : 1000);

  if (startX === target.x && startY === target.y) {
    if (typeof onDone === "function") onDone();
    return () => {};
  }

  let cancelled = false;
  let completed = false;
  let timer = null;

  const cancel = () => {
    cancelled = true;
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const startTime = Date.now();
  let frameCount = 0;
  const totalFrames = Math.max(1, Math.round(safeDuration / FRAME_MS));

  const step = () => {
    timer = null;
    if (cancelled || completed) return;
    if (!win || win.isDestroyed()) {
      if (typeof onDone === "function") onDone();
      return;
    }
    frameCount++;
    const t = Math.min(1, frameCount / totalFrames);
    const eased = t * (2 - t);
    const x = Math.round(startX + (target.x - startX) * eased);
    const y = Math.round(startY + (target.y - startY) * eased);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      if (typeof onDone === "function") onDone();
      return;
    }
    try {
      if (typeof win.setBounds === "function") {
        win.setBounds({ x, y, width: bounds.width, height: bounds.height });
      } else if (typeof win.setPosition === "function") {
        win.setPosition(x, y);
      }
    } catch {
      if (typeof onDone === "function") onDone();
      return;
    }
    if (typeof ctx.syncHitWin === "function") ctx.syncHitWin();
    if (typeof ctx.repositionSessionHud === "function") ctx.repositionSessionHud();
    if (typeof ctx.syncContainedClip === "function") ctx.syncContainedClip();
    if (ctx.bubbleFollowPet && Array.isArray(ctx.pendingPermissions) && ctx.pendingPermissions.length
        && (frameCount % 3 === 0 || t >= 1)) {
      if (typeof ctx.repositionBubbles === "function") ctx.repositionBubbles();
    }
    if (t < 1) {
      timer = setTimeout(step, FRAME_MS);
    } else {
      completed = true;
      if (typeof onDone === "function") onDone();
    }
  };
  timer = setTimeout(step, FRAME_MS);
  return cancel;
}

module.exports = { animateWindowXY };
