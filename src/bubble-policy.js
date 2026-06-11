"use strict";

const BUBBLE_KINDS = Object.freeze(["permission", "notification", "update", "completion"]);
const BUBBLE_KIND_SET = new Set(BUBBLE_KINDS);
const NOTIFICATION_DEFAULT_SECONDS = 6;
const UPDATE_DEFAULT_SECONDS = 9;
const COMPLETION_DEFAULT_SECONDS = 2;
// Permission default = 0 (off): permission requests block tool execution, so an
// auto-dismiss is a defensive fallback for cases where the agent's HTTP socket
// stays half-alive (proxy/EDR/etc.) and abortHandler never fires. Users opt in.
const PERMISSION_DEFAULT_SECONDS = 0;
const MAX_AUTO_CLOSE_SECONDS = 3600;

function isValidBubbleKind(kind) {
  return BUBBLE_KIND_SET.has(kind);
}

function normalizeAutoCloseSeconds(value, defaultValue) {
  if (typeof value !== "number" || !Number.isFinite(value)) return defaultValue;
  const n = Math.trunc(value);
  if (n < 0) return defaultValue;
  if (n > MAX_AUTO_CLOSE_SECONDS) return MAX_AUTO_CLOSE_SECONDS;
  return n;
}

function isAllBubblesHidden(snapshot = {}) {
  if (snapshot.hideBubbles === true) return true;
  const permissionEnabled = snapshot.permissionBubblesEnabled !== false;
  const notificationSeconds = normalizeAutoCloseSeconds(
    snapshot.notificationBubbleAutoCloseSeconds,
    NOTIFICATION_DEFAULT_SECONDS
  );
  const updateSeconds = normalizeAutoCloseSeconds(
    snapshot.updateBubbleAutoCloseSeconds,
    UPDATE_DEFAULT_SECONDS
  );
  // completionBubbleAutoCloseSeconds is intentionally NOT consulted here: the
  // completion bubble is causal feedback for the user's own task, and a user
  // who only disables permission/notification/update bubbles hasn't asked to
  // hide "your task finished" pings. Returning false keeps the global hide
  // toggle consistent with that intent.
  // permissionBubbleAutoCloseSeconds doesn't gate the "all hidden" check —
  // disabling permission bubbles is via permissionBubblesEnabled; autoclose
  // is an orthogonal dismissal policy on top of an already-enabled bubble.
  return !permissionEnabled && notificationSeconds === 0 && updateSeconds === 0;
}

function getBubblePolicy(snapshot = {}, kind) {
  if (!isValidBubbleKind(kind)) {
    throw new Error(`Unknown bubble policy kind: ${kind}`);
  }

  let policy;
  let bypassDnd = false;
  if (kind === "permission") {
    const enabled = snapshot.permissionBubblesEnabled !== false;
    const seconds = normalizeAutoCloseSeconds(
      snapshot.permissionBubbleAutoCloseSeconds,
      PERMISSION_DEFAULT_SECONDS
    );
    // autoCloseMs > 0 means "auto-dismiss without decision after N seconds".
    // 0 means never auto-dismiss (keep waiting for user / agent disconnect).
    policy = { enabled, autoCloseMs: seconds > 0 ? seconds * 1000 : 0 };
  } else if (kind === "notification") {
    const seconds = normalizeAutoCloseSeconds(
      snapshot.notificationBubbleAutoCloseSeconds,
      NOTIFICATION_DEFAULT_SECONDS
    );
    policy = {
      enabled: seconds > 0,
      autoCloseMs: seconds > 0 ? seconds * 1000 : 0,
    };
  } else if (kind === "completion") {
    const seconds = normalizeAutoCloseSeconds(
      snapshot.completionBubbleAutoCloseSeconds,
      COMPLETION_DEFAULT_SECONDS
    );
    policy = {
      enabled: seconds > 0,
      autoCloseMs: seconds > 0 ? seconds * 1000 : 0,
    };
    // Causal feedback: the user explicitly triggered the work that just
    // finished. Even with hideBubbles=true they want to see "your task
    // done" — only an explicit seconds=0 turns this off. The flag is
    // omitted when false so existing deepStrictEqual tests on the other
    // kinds don't churn; consumers that care about DND-bypass behavior
    // check `policy.bypassDnd === true`.
    bypassDnd = true;
  } else {
    const seconds = normalizeAutoCloseSeconds(
      snapshot.updateBubbleAutoCloseSeconds,
      UPDATE_DEFAULT_SECONDS
    );
    policy = {
      enabled: seconds > 0,
      autoCloseMs: seconds > 0 ? seconds * 1000 : 0,
    };
  }

  // Apply the global hideBubbles short-circuit AFTER the kind-specific policy
  // is computed, so kinds that carry bypassDnd (currently only "completion")
  // can opt out of the global suppression. Anything that didn't opt out gets
  // hard-disabled; autoCloseMs is reset to 0 because there's nothing to time.
  if (snapshot.hideBubbles === true && !bypassDnd) {
    return { enabled: false, autoCloseMs: 0 };
  }
  if (bypassDnd) policy.bypassDnd = true;
  return policy;
}

function buildAggregateHideCommit(hidden, snapshot = {}) {
  if (hidden) return { hideBubbles: true };

  const permissionEnabled = snapshot.permissionBubblesEnabled !== false;
  const notificationSeconds = normalizeAutoCloseSeconds(
    snapshot.notificationBubbleAutoCloseSeconds,
    NOTIFICATION_DEFAULT_SECONDS
  );
  const updateSeconds = normalizeAutoCloseSeconds(
    snapshot.updateBubbleAutoCloseSeconds,
    UPDATE_DEFAULT_SECONDS
  );
  const commit = {
    hideBubbles: false,
    // Always carry the completion setting through the commit so toggling
    // hideBubbles never silently resets it. completionBubbleAutoCloseSeconds
    // is intentionally absent from the "all zero" branch below — see
    // isAllBubblesHidden for the rationale.
    completionBubbleAutoCloseSeconds: normalizeAutoCloseSeconds(
      snapshot.completionBubbleAutoCloseSeconds,
      COMPLETION_DEFAULT_SECONDS
    ),
  };

  if (!permissionEnabled && notificationSeconds === 0 && updateSeconds === 0) {
    commit.permissionBubblesEnabled = true;
    commit.notificationBubbleAutoCloseSeconds = NOTIFICATION_DEFAULT_SECONDS;
    commit.updateBubbleAutoCloseSeconds = UPDATE_DEFAULT_SECONDS;
  }

  return commit;
}

function buildCategoryEnabledCommit(snapshot = {}, category, enabled) {
  if (!isValidBubbleKind(category)) {
    return { error: `setBubbleCategoryEnabled.category must be one of: ${BUBBLE_KINDS.join(", ")}` };
  }
  if (typeof enabled !== "boolean") {
    return { error: "setBubbleCategoryEnabled.enabled must be a boolean" };
  }

  const next = {
    permissionBubblesEnabled: snapshot.permissionBubblesEnabled !== false,
    notificationBubbleAutoCloseSeconds: normalizeAutoCloseSeconds(
      snapshot.notificationBubbleAutoCloseSeconds,
      NOTIFICATION_DEFAULT_SECONDS
    ),
    updateBubbleAutoCloseSeconds: normalizeAutoCloseSeconds(
      snapshot.updateBubbleAutoCloseSeconds,
      UPDATE_DEFAULT_SECONDS
    ),
    // Carry completion through every category commit so toggling one category
    // doesn't accidentally zero out an unrelated field.
    completionBubbleAutoCloseSeconds: normalizeAutoCloseSeconds(
      snapshot.completionBubbleAutoCloseSeconds,
      COMPLETION_DEFAULT_SECONDS
    ),
  };

  if (category === "permission") {
    next.permissionBubblesEnabled = enabled;
  } else if (category === "notification") {
    next.notificationBubbleAutoCloseSeconds = enabled
      ? (next.notificationBubbleAutoCloseSeconds > 0
          ? next.notificationBubbleAutoCloseSeconds
          : NOTIFICATION_DEFAULT_SECONDS)
      : 0;
  } else if (category === "completion") {
    // Completion uses seconds semantics (like notification/update), not a
    // boolean enabled flag. setBubbleCategoryEnabled with category=completion
    // is treated as "respect whatever seconds value is already set"; users
    // who want to fully silence completion set seconds=0 directly.
  } else {
    next.updateBubbleAutoCloseSeconds = enabled
      ? (next.updateBubbleAutoCloseSeconds > 0
          ? next.updateBubbleAutoCloseSeconds
          : UPDATE_DEFAULT_SECONDS)
      : 0;
  }

  next.hideBubbles = isAllBubblesHidden(next);
  return { commit: next };
}

module.exports = {
  BUBBLE_KINDS,
  NOTIFICATION_DEFAULT_SECONDS,
  UPDATE_DEFAULT_SECONDS,
  COMPLETION_DEFAULT_SECONDS,
  PERMISSION_DEFAULT_SECONDS,
  MAX_AUTO_CLOSE_SECONDS,
  getBubblePolicy,
  isAllBubblesHidden,
  buildAggregateHideCommit,
  buildCategoryEnabledCommit,
  normalizeAutoCloseSeconds,
};
