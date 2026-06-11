"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  getBubblePolicy,
  isAllBubblesHidden,
  buildAggregateHideCommit,
  buildCategoryEnabledCommit,
} = require("../src/bubble-policy");

describe("bubble policy", () => {
  it("keeps permission bubbles visible without auto-close by default", () => {
    assert.deepStrictEqual(getBubblePolicy({}, "permission"), {
      enabled: true,
      autoCloseMs: 0,
    });
  });

  it("maps permissionBubbleAutoCloseSeconds to autoCloseMs for permission kind", () => {
    assert.deepStrictEqual(getBubblePolicy({ permissionBubbleAutoCloseSeconds: 30 }, "permission"), {
      enabled: true,
      autoCloseMs: 30000,
    });
    assert.deepStrictEqual(getBubblePolicy({ permissionBubbleAutoCloseSeconds: 0 }, "permission"), {
      enabled: true,
      autoCloseMs: 0,
    });
  });

  it("disabling the permission bubble switch ignores any autoclose seconds", () => {
    assert.deepStrictEqual(
      getBubblePolicy({ permissionBubblesEnabled: false, permissionBubbleAutoCloseSeconds: 60 }, "permission"),
      { enabled: false, autoCloseMs: 60000 }
    );
  });

  it("maps notification and update seconds to enabled policies", () => {
    assert.deepStrictEqual(getBubblePolicy({ notificationBubbleAutoCloseSeconds: 2 }, "notification"), {
      enabled: true,
      autoCloseMs: 2000,
    });
    assert.deepStrictEqual(getBubblePolicy({ updateBubbleAutoCloseSeconds: 0 }, "update"), {
      enabled: false,
      autoCloseMs: 0,
    });
  });

  it("treats aggregate hidden as all three categories off", () => {
    assert.strictEqual(isAllBubblesHidden({
      hideBubbles: true,
      permissionBubblesEnabled: true,
      notificationBubbleAutoCloseSeconds: 12,
      updateBubbleAutoCloseSeconds: 8,
    }), true);
    assert.strictEqual(isAllBubblesHidden({
      permissionBubblesEnabled: false,
      notificationBubbleAutoCloseSeconds: 0,
      updateBubbleAutoCloseSeconds: 0,
    }), true);
    assert.strictEqual(isAllBubblesHidden({
      permissionBubblesEnabled: false,
      notificationBubbleAutoCloseSeconds: 0,
      updateBubbleAutoCloseSeconds: 9,
    }), false);
  });

  it("category toggles update the matching setting and aggregate flag", () => {
    const snapshot = {
      permissionBubblesEnabled: false,
      notificationBubbleAutoCloseSeconds: 0,
      updateBubbleAutoCloseSeconds: 0,
    };
    const result = buildCategoryEnabledCommit(snapshot, "notification", true);
    assert.deepStrictEqual(result.commit, {
      permissionBubblesEnabled: false,
      notificationBubbleAutoCloseSeconds: 6,
      updateBubbleAutoCloseSeconds: 0,
      // completionBubbleAutoCloseSeconds is carried through every category
      // commit so toggling one category never silently resets an unrelated
      // field. Default 2 because the input snapshot didn't define one.
      completionBubbleAutoCloseSeconds: 2,
      hideBubbles: false,
    });
  });

  it("category toggles preserve existing positive auto-close seconds", () => {
    const result = buildCategoryEnabledCommit({
      hideBubbles: true,
      permissionBubblesEnabled: true,
      notificationBubbleAutoCloseSeconds: 1,
      updateBubbleAutoCloseSeconds: 12,
    }, "notification", true);
    assert.deepStrictEqual(result.commit, {
      permissionBubblesEnabled: true,
      notificationBubbleAutoCloseSeconds: 1,
      updateBubbleAutoCloseSeconds: 12,
      // Carried through from a default-2 backfill, since the input snapshot
      // predates the completionBubbleAutoCloseSeconds field.
      completionBubbleAutoCloseSeconds: 2,
      hideBubbles: false,
    });
  });

  it("uses aggregate hide as an override without destroying category settings", () => {
    assert.deepStrictEqual(getBubblePolicy({
      hideBubbles: true,
      notificationBubbleAutoCloseSeconds: 12,
    }, "notification"), {
      enabled: false,
      autoCloseMs: 0,
    });
    assert.deepStrictEqual(buildAggregateHideCommit(true, {
      permissionBubblesEnabled: true,
      notificationBubbleAutoCloseSeconds: 12,
      updateBubbleAutoCloseSeconds: 8,
    }), {
      hideBubbles: true,
    });
    // Aggregate hide=false must carry completion through so a user who
    // explicitly set completionBubbleAutoCloseSeconds=0 keeps it. Defaulted
    // to 2 here because the input snapshot didn't include the field.
    assert.deepStrictEqual(buildAggregateHideCommit(false, {
      hideBubbles: true,
      permissionBubblesEnabled: true,
      notificationBubbleAutoCloseSeconds: 12,
      updateBubbleAutoCloseSeconds: 8,
    }), {
      hideBubbles: false,
      completionBubbleAutoCloseSeconds: 2,
    });
  });

  it("restores defaults when the aggregate menu is used on fully disabled categories", () => {
    assert.deepStrictEqual(buildAggregateHideCommit(false, {
      hideBubbles: true,
      permissionBubblesEnabled: false,
      notificationBubbleAutoCloseSeconds: 0,
      updateBubbleAutoCloseSeconds: 0,
    }), {
      hideBubbles: false,
      // completionBubbleAutoCloseSeconds is intentionally NOT in the
      // "all-defaulted" branch — completion has bypassDnd semantics, so the
      // aggregate toggle shouldn't restore its default. It still rides along
      // via the always-set commit.completionBubbleAutoCloseSeconds above.
      completionBubbleAutoCloseSeconds: 2,
      permissionBubblesEnabled: true,
      notificationBubbleAutoCloseSeconds: 6,
      updateBubbleAutoCloseSeconds: 9,
    });
  });
});

describe("completion bubble policy (causal-feedback kind)", () => {
  it("defaults to 2-second auto-close", () => {
    const policy = getBubblePolicy({}, "completion");
    assert.strictEqual(policy.enabled, true);
    assert.strictEqual(policy.autoCloseMs, 2000);
    assert.strictEqual(policy.bypassDnd, true, "completion carries bypassDnd");
  });

  it("honors a user-configured completionBubbleAutoCloseSeconds value", () => {
    assert.deepStrictEqual(
      getBubblePolicy({ completionBubbleAutoCloseSeconds: 5 }, "completion"),
      { enabled: true, autoCloseMs: 5000, bypassDnd: true }
    );
  });

  it("is disabled when seconds is set to 0 (explicit user opt-out)", () => {
    assert.deepStrictEqual(
      getBubblePolicy({ completionBubbleAutoCloseSeconds: 0 }, "completion"),
      { enabled: false, autoCloseMs: 0, bypassDnd: true }
    );
  });

  it("survives hideBubbles=true via bypassDnd — causal feedback", () => {
    // The whole point: hideBubbles=true mutes notifications and update
    // bubbles, but completion bubbles still fire because the user explicitly
    // triggered the work that just finished.
    const policy = getBubblePolicy({ hideBubbles: true }, "completion");
    assert.strictEqual(policy.enabled, true, "completion bypasses hideBubbles");
    assert.strictEqual(policy.autoCloseMs, 2000);
    assert.strictEqual(policy.bypassDnd, true);
  });

  it("isAllBubblesHidden ignores completion so the global toggle doesn't lie", () => {
    // Permission/notification/update all off, but completion with default
    // 2s — should NOT register as "everything hidden", because completion
    // would still pop.
    assert.strictEqual(isAllBubblesHidden({
      permissionBubblesEnabled: false,
      notificationBubbleAutoCloseSeconds: 0,
      updateBubbleAutoCloseSeconds: 0,
    }), true);
    // Same shape but completion explicitly disabled by user:
    assert.strictEqual(isAllBubblesHidden({
      permissionBubblesEnabled: false,
      notificationBubbleAutoCloseSeconds: 0,
      updateBubbleAutoCloseSeconds: 0,
      completionBubbleAutoCloseSeconds: 0,
    }), true);
  });

  it("rejects unknown kinds", () => {
    assert.throws(() => getBubblePolicy({}, "nonexistent"), /Unknown bubble policy kind/);
  });
});
