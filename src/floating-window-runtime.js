"use strict";

const noop = () => {};

function isLiveWindow(win) {
  return !!(win && (typeof win.isDestroyed !== "function" || !win.isDestroyed()));
}

function getPendingList(getPendingPermissions) {
  const pending = getPendingPermissions();
  return Array.isArray(pending) ? pending : [];
}

// Stack order from top to bottom (closest to user attention first):
//   permissions (active decisions) → completion (causal feedback) → update
//   (background lifecycle). The completion bubble layers itself under the
//   permission stack AND on top of the update bubble via its own bounds
//   computation; this module just makes sure each layer is repositioned and
//   toggled when the pet shows/hides.
function createFloatingWindowRuntime(options = {}) {
  const getPendingPermissions = options.getPendingPermissions || (() => []);
  const keepOutOfTaskbar = options.keepOutOfTaskbar || noop;
  const repositionPermissionBubbles = options.repositionPermissionBubbles || noop;
  const repositionCompletionBubble = options.repositionCompletionBubble || noop;
  const repositionUpdateBubble = options.repositionUpdateBubble || noop;
  const repositionSessionHud = options.repositionSessionHud || noop;
  const syncSessionHudVisibility = options.syncSessionHudVisibility || noop;
  const syncCompletionBubbleVisibility = options.syncCompletionBubbleVisibility || noop;
  const syncUpdateBubbleVisibility = options.syncUpdateBubbleVisibility || noop;
  const hideCompletionBubble = options.hideCompletionBubble || noop;
  const hideUpdateBubble = options.hideUpdateBubble || noop;

  function repositionFloatingBubbles() {
    if (getPendingList(getPendingPermissions).length) repositionPermissionBubbles();
    repositionCompletionBubble();
    repositionUpdateBubble();
  }

  function repositionAnchoredSurfaces() {
    repositionSessionHud();
    repositionFloatingBubbles();
  }

  function syncSessionHudVisibilityAndBubbles() {
    syncSessionHudVisibility();
    repositionFloatingBubbles();
  }

  function showFloatingSurfacesForPet() {
    for (const perm of getPendingList(getPendingPermissions)) {
      const bubble = perm && perm.bubble;
      if (isLiveWindow(bubble) && typeof bubble.showInactive === "function") {
        bubble.showInactive();
        keepOutOfTaskbar(bubble);
      }
    }
    syncCompletionBubbleVisibility();
    syncUpdateBubbleVisibility();
  }

  function hideFloatingSurfacesForPet() {
    for (const perm of getPendingList(getPendingPermissions)) {
      const bubble = perm && perm.bubble;
      if (isLiveWindow(bubble) && typeof bubble.hide === "function") {
        bubble.hide();
      }
    }
    hideCompletionBubble();
    hideUpdateBubble();
  }

  return {
    repositionFloatingBubbles,
    repositionAnchoredSurfaces,
    syncSessionHudVisibilityAndBubbles,
    showFloatingSurfacesForPet,
    hideFloatingSurfacesForPet,
  };
}

module.exports = createFloatingWindowRuntime;
