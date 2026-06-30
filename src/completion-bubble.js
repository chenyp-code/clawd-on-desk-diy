"use strict";

const { BrowserWindow } = require("electron");
const path = require("path");
const { keepOutOfTaskbar } = require("./taskbar");

const isLinux = process.platform === "linux";
const isMac = process.platform === "darwin";
const isWin = process.platform === "win32";
const WIN_TOPMOST_LEVEL = "pop-up-menu";
const LINUX_WINDOW_TYPE = "toolbar";
const WIDTH = 320;
// Narrower than update-bubble (340) — completion only needs a one-line summary
// and a primary action; less horizontal footprint reduces overlap risk when
// stacked next to permission bubbles.
const EDGE_MARGIN = 8;
const GAP = 6;
const MAC_FLOATING_TOPMOST_DELAY_MS = 120;
const OK_ACTION_ID = "ok";

function requiredDependency(value, name, owner) {
  if (!value) throw new Error(`${owner} requires ${name}`);
  return value;
}

function registerCompletionBubbleIpc(options = {}) {
  const ipcMain = requiredDependency(options.ipcMain, "ipcMain", "registerCompletionBubbleIpc");
  const completionBubble = requiredDependency(options.completionBubble, "completionBubble", "registerCompletionBubbleIpc");
  requiredDependency(completionBubble.handleCompletionBubbleHeight, "completionBubble.handleCompletionBubbleHeight", "registerCompletionBubbleIpc");
  requiredDependency(completionBubble.handleCompletionBubbleAction, "completionBubble.handleCompletionBubbleAction", "registerCompletionBubbleIpc");
  const disposers = [];

  function on(channel, listener) {
    ipcMain.on(channel, listener);
    disposers.push(() => ipcMain.removeListener(channel, listener));
  }

  on("completion-bubble-height", (event, height) => completionBubble.handleCompletionBubbleHeight(event, height));
  on("completion-bubble-action", (event, actionId) => completionBubble.handleCompletionBubbleAction(event, actionId));

  return {
    dispose() {
      while (disposers.length) {
        const dispose = disposers.pop();
        dispose();
      }
    },
  };
}

function deferMacFloatingVisibility(ctx, win) {
  if (!isMac || !win || win.isDestroyed()) return;
  const deferUntil = Date.now() + MAC_FLOATING_TOPMOST_DELAY_MS;
  win.__clawdMacDeferredVisibilityUntil = deferUntil;
  setTimeout(() => {
    if (!win || win.isDestroyed()) return;
    if (win.__clawdMacDeferredVisibilityUntil === deferUntil) {
      delete win.__clawdMacDeferredVisibilityUntil;
    }
    if (typeof ctx.reapplyMacVisibility === "function") ctx.reapplyMacVisibility();
  }, MAC_FLOATING_TOPMOST_DELAY_MS);
}

function getPolicy(ctx) {
  if (typeof ctx.getBubblePolicy === "function") {
    try {
      const policy = ctx.getBubblePolicy("completion");
      if (policy && typeof policy.enabled === "boolean") return policy;
    } catch {}
  }
  return { enabled: true, autoCloseMs: 2000, bypassDnd: true };
}

function estimateHeight(payload) {
  let height = 110;
  if (payload && payload.prompt) {
    const promptText = String(payload.prompt);
    const promptLines = promptText.split(/\r?\n/).length;
    // Approximate: 18px per wrapped line at WIDTH=320px (~36 chars/line for 13px sans).
    const wrappedLines = Math.max(1, Math.ceil(promptText.length / 36));
    height += Math.max(promptLines, wrappedLines) * 18;
  }
  // Token stats block (per-turn + session totals) adds two lines, each
  // ~22px tall at the bumped font size. Reserve the space up front so the
  // initial layout doesn't jump when the renderer paints the rows.
  // Triggered by either stat field; missing-paired cases (one row only)
  // still render at the same height to keep the layout stable when the
  // renderer omits the missing side.
  if (payload && (payload.lastTurnUsage || payload.sessionTokenUsage)) {
    height += 44;
  }
  return height;
}

function computeAutoCloseRemainingMs(shownAt, autoCloseMs, now = Date.now()) {
  const totalMs = Number(autoCloseMs);
  if (!Number.isFinite(totalMs) || totalMs <= 0) return 0;
  const startedAt = Number(shownAt);
  if (!Number.isFinite(startedAt) || startedAt <= 0) return totalMs;
  return Math.max(0, totalMs - Math.max(0, now - startedAt));
}

function computeCompletionBubbleBounds({
  bubbleFollowPet,
  width,
  edgeMargin,
  gap,
  height,
  reservedHeight,
  hudReservedOffset = 0,
  workArea,
  petBounds,
  anchorRect,
  hitRect,
}) {
  const permissionStackOffset = Math.max(0, Number(reservedHeight) || 0);
  let x = workArea.x + workArea.width - width - edgeMargin;
  let y = workArea.y + workArea.height - edgeMargin - height - permissionStackOffset;

  const followRect = anchorRect || hitRect;

  if (bubbleFollowPet && petBounds && followRect) {
    const followTop = Math.round(followRect.top);
    const followRectBottom = Math.round(followRect.bottom);
    const followCx = Math.round((followRect.left + followRect.right) / 2);
    const reserve = Math.max(0, Number(hudReservedOffset) || 0);
    const underPetY = followRectBottom + gap + reserve + permissionStackOffset;
    const abovePetY = followTop - gap - height;
    const workAreaBottom = workArea.y + workArea.height - edgeMargin;
    const maxY = workAreaBottom - height;

    if (underPetY + height <= workAreaBottom) {
      x = Math.max(workArea.x, Math.min(followCx - Math.round(width / 2), workArea.x + workArea.width - width));
      y = underPetY;
    } else if (abovePetY >= workArea.y + edgeMargin) {
      x = Math.max(workArea.x, Math.min(followCx - Math.round(width / 2), workArea.x + workArea.width - width));
      y = abovePetY;
    } else {
      const followRight = Math.round(followRect.right);
      const followLeft = Math.round(followRect.left);
      const followCy = Math.round((followRect.top + followRect.bottom) / 2);
      const spaceRight = workArea.x + workArea.width - followRight;
      const spaceLeft = followLeft - workArea.x;
      if (spaceRight >= width || spaceRight >= spaceLeft) {
        x = Math.min(followRight + gap, workArea.x + workArea.width - width);
      } else {
        x = Math.max(workArea.x, followLeft - gap - width);
      }
      y = Math.max(
        workArea.y + edgeMargin,
        Math.min(followCy - Math.round(height / 2), maxY)
      );
    }
  }

  y = Math.max(workArea.y + edgeMargin, y);
  return { x, y, width, height };
}

module.exports = function initCompletionBubble(ctx) {
  let bubble = null;
  let measuredHeight = 0;
  let activePayload = null;
  let resolveAction = null;
  let hideTimer = null;
  let autoCloseTimer = null;
  let visibleSince = 0;

  function getPermissionStackHeight() {
    const pending = typeof ctx.getPendingPermissions === "function" ? ctx.getPendingPermissions() : [];
    let total = 0;
    for (const perm of pending) {
      if (!perm || !perm.bubble || perm.bubble.isDestroyed() || !perm.bubble.isVisible()) continue;
      total += perm.measuredHeight || 200;
      total += GAP;
    }
    return total;
  }

  // Stack the completion bubble below the permission stack AND below the
  // update bubble when both are visible. Order top-to-bottom: permissions →
  // completion → update. The update bubble itself accounts for the permission
  // stack via its own getPermissionStackHeight(); we only need to add its
  // height on top of that to land below it.
  function getUpdateBubbleHeight() {
    const update = typeof ctx.getUpdateBubble === "function" ? ctx.getUpdateBubble() : null;
    if (!update || update.isDestroyed() || !update.isVisible()) return 0;
    const bounds = update.getBounds();
    return (bounds && bounds.height) ? bounds.height : 0;
  }

  function ensureBubble() {
    if (bubble && !bubble.isDestroyed()) return bubble;

    bubble = new BrowserWindow({
      width: WIDTH,
      height: estimateHeight(activePayload),
      show: false,
      frame: false,
      transparent: true,
      alwaysOnTop: !isMac,
      resizable: false,
      skipTaskbar: true,
      hasShadow: false,
      focusable: false,
      ...(isLinux ? { type: LINUX_WINDOW_TYPE } : {}),
      ...(isMac ? { type: "panel" } : {}),
      webPreferences: {
        preload: path.join(__dirname, "preload-completion-bubble.js"),
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    if (isWin) bubble.setAlwaysOnTop(true, WIN_TOPMOST_LEVEL);

    bubble.loadFile(path.join(__dirname, "completion-bubble.html"));
    bubble.on("closed", () => {
      bubble = null;
      measuredHeight = 0;
      if (resolveAction) {
        const fallback = OK_ACTION_ID;
        const resolver = resolveAction;
        resolveAction = null;
        resolver({ action: fallback, source: "closed" });
      }
    });

    bubble.webContents.once("did-finish-load", () => {
      if (activePayload) bubble.webContents.send("completion-bubble-show", activePayload);
    });

    if (typeof ctx.guardAlwaysOnTop === "function") ctx.guardAlwaysOnTop(bubble);
    return bubble;
  }

  // Resolve bubbleFollowPet against petHidden: when the pet is out of sight
  // the user can't anchor a bubble to it, so we drop back to bottom-right
  // corner placement. Without this, hidden-pet + bubbleFollowPet=true would
  // pop the toast at the pet's last visible position with no pet in sight to
  // explain why it's there.
  function isFollowingPet() {
    return !!ctx.bubbleFollowPet && !ctx.petHidden;
  }

  function computeBounds() {
    if (!ctx.win || ctx.win.isDestroyed()) return null;
    const petBounds = ctx.getPetWindowBounds();
    const cx = petBounds.x + petBounds.width / 2;
    const cy = petBounds.y + petBounds.height / 2;
    const wa = ctx.getNearestWorkArea(cx, cy);
    const height = measuredHeight || estimateHeight(activePayload);
    const reservedHeight = getPermissionStackHeight() + getUpdateBubbleHeight() + GAP;
    const followPet = isFollowingPet();
    const anchorRect = followPet && typeof ctx.getUpdateBubbleAnchorRect === "function"
      ? ctx.getUpdateBubbleAnchorRect(petBounds)
      : null;
    const hitRect = followPet ? ctx.getHitRectScreen(petBounds) : null;

    const bounds = computeCompletionBubbleBounds({
      bubbleFollowPet: followPet,
      width: WIDTH,
      edgeMargin: EDGE_MARGIN,
      gap: GAP,
      height,
      reservedHeight,
      hudReservedOffset: typeof ctx.getHudReservedOffset === "function" ? ctx.getHudReservedOffset() : 0,
      workArea: wa,
      petBounds,
      anchorRect,
      hitRect,
    });
    return bounds;
  }

  function repositionCompletionBubble() {
    if (!bubble || bubble.isDestroyed()) return;
    const bounds = computeBounds();
    if (bounds) bubble.setBounds(bounds);
  }

  function syncVisibility() {
    if (!bubble || bubble.isDestroyed()) return;
    // mini mode is a positioning state ("pet is at the screen edge"), not a
    // silence preference — same as petHidden (see AGENTS.md "petHidden ≠ DND"
    // rule). Completion bubbles bypass DND via policy.bypassDnd (see
    // bubble-policy.js); we don't gate on mini either. miniTransitioning
    // briefly hides everything during mini enter/exit animations; that
    // suppression is owned by main.js / mini.js via the bubble lifecycle,
    // not here.
    bubble.showInactive();
    keepOutOfTaskbar(bubble);
    if (isMac) deferMacFloatingVisibility(ctx, bubble);
    else if (typeof ctx.reapplyMacVisibility === "function") ctx.reapplyMacVisibility();
  }

  // Settle the in-flight bubble promise with a tagged result. The completion
  // bubble is fire-and-forget in v1 (state.js doesn't await), but the
  // convention matches update-bubble's source ∈ {user, autoClose, policy,
  // closed} so future callers can plug in without re-deriving semantics.
  function settlePrevious(action, source = "user") {
    if (!resolveAction) return;
    const resolver = resolveAction;
    resolveAction = null;
    resolver({ action, source });
  }

  function clearAutoCloseTimer() {
    if (autoCloseTimer) {
      clearTimeout(autoCloseTimer);
      autoCloseTimer = null;
    }
  }

  function scheduleAutoClose(payload) {
    clearAutoCloseTimer();
    const policy = getPolicy(ctx);
    if (!policy.enabled || !(policy.autoCloseMs > 0)) return;
    visibleSince = Date.now();
    autoCloseTimer = setTimeout(() => {
      autoCloseTimer = null;
      if (resolveAction) settlePrevious(OK_ACTION_ID, "autoClose");
      hideCompletionBubble();
    }, policy.autoCloseMs);
  }

  // Re-evaluate the auto-close timer against the latest policy. Called when
  // the user changes completionBubbleAutoCloseSeconds mid-show, or when the
  // hideBubbles global toggle flips (DND bypass means completion shouldn't be
  // cancelled — but if seconds went 2 → 0 we must hide).
  function refreshAutoCloseForPolicy() {
    if (!bubble || bubble.isDestroyed() || !activePayload) return false;
    clearAutoCloseTimer();
    const policy = getPolicy(ctx);
    if (!policy.enabled) {
      hideForPolicy();
      return false;
    }
    if (!(policy.autoCloseMs > 0)) return true;
    const remainingMs = computeAutoCloseRemainingMs(visibleSince, policy.autoCloseMs, Date.now());
    if (remainingMs <= 0) {
      if (resolveAction) settlePrevious(OK_ACTION_ID, "autoClose");
      hideCompletionBubble();
      return false;
    }
    autoCloseTimer = setTimeout(() => {
      autoCloseTimer = null;
      if (resolveAction) settlePrevious(OK_ACTION_ID, "autoClose");
      hideCompletionBubble();
    }, remainingMs);
    return true;
  }

  function showCompletionBubble(payload) {
    const policy = getPolicy(ctx);
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    clearAutoCloseTimer();
    if (resolveAction) {
      // Late-arriving completion for a new session supersedes an in-flight
      // one. Same single-bubble contract as update-bubble — multi-session
      // completion races within the 2s window are rare and intentional.
      settlePrevious(OK_ACTION_ID, "closed");
    }
    activePayload = payload;
    if (!policy.enabled) {
      hideCompletionBubble();
      return Promise.resolve({ action: OK_ACTION_ID, source: "policy" });
    }
    const win = ensureBubble();

    const send = () => {
      measuredHeight = 0;
      repositionCompletionBubble();
      if (win && !win.isDestroyed()) {
        // countdownSeconds is derived from the policy's autoCloseMs so the
        // renderer can drive a visible "closes in Xs" label that ticks down
        // alongside the main-process timer. Floor to whole seconds; sub-
        // second precision would just flicker the label without value.
        const countdownSeconds = policy.autoCloseMs > 0
          ? Math.max(1, Math.round(policy.autoCloseMs / 1000))
          : 0;
        win.webContents.send("completion-bubble-show", {
          ...payload,
          countdownSeconds,
        });
        syncVisibility();
        scheduleAutoClose(payload);
      }
    };

    if (win.webContents.isLoading()) {
      win.webContents.once("did-finish-load", send);
    } else {
      send();
    }

    // Completion bubbles never block: no decision required, no action gating.
    // The returned promise is reserved for a future "wait for user ack before
    // triggering the next side-effect" feature.
    resolveAction = null;
    return new Promise((resolve) => {
      resolveAction = resolve;
    });
  }

  function hideCompletionBubble() {
    if (!bubble || bubble.isDestroyed()) return;
    bubble.webContents.send("completion-bubble-hide");
    clearAutoCloseTimer();
    visibleSince = 0;
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (bubble && !bubble.isDestroyed()) bubble.hide();
    }, 250);
  }

  function hideForPolicy() {
    if (resolveAction) {
      settlePrevious(OK_ACTION_ID, "policy");
    }
    hideCompletionBubble();
  }

  function resolveCurrentAction(actionId) {
    if (!resolveAction) return;
    const resolver = resolveAction;
    resolveAction = null;
    resolver({ action: actionId, source: "user" });
  }

  function handleCompletionBubbleAction(event, actionId) {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    if (!bubble || senderWin !== bubble) return;
    hideCompletionBubble();
    resolveCurrentAction(actionId || OK_ACTION_ID);
  }

  function handleCompletionBubbleHeight(event, height) {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    if (!bubble || senderWin !== bubble) return;
    if (typeof height === "number" && height > 0) {
      measuredHeight = Math.ceil(height);
      repositionCompletionBubble();
    }
  }

  function cleanup() {
    if (hideTimer) clearTimeout(hideTimer);
    clearAutoCloseTimer();
    settlePrevious(OK_ACTION_ID, "closed");
    if (bubble && !bubble.isDestroyed()) bubble.destroy();
    bubble = null;
  }

  return {
    showCompletionBubble,
    hideCompletionBubble,
    repositionCompletionBubble,
    handleCompletionBubbleAction,
    handleCompletionBubbleHeight,
    syncVisibility,
    hideForPolicy,
    refreshAutoCloseForPolicy,
    cleanup,
    getBubbleWindow: () => bubble,
  };
};

module.exports.registerCompletionBubbleIpc = registerCompletionBubbleIpc;

module.exports.__test = {
  computeAutoCloseRemainingMs,
  computeCompletionBubbleBounds,
  estimateHeight,
};