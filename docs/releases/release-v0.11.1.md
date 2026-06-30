## v0.11.1

v0.11.1 is a **bug-fix patch** on top of v0.11.0. It repairs the bubble
suppression contract across permission, update, and completion bubbles so
the petHidden / mini-mode rules stay internally consistent. No new
features, no breaking changes.

### What's New in v0.11.1

- **`petHidden` (hidden pet) and `miniMode` (pet tucked at the screen
  edge) are positioning states, not silence preferences.** v0.11.0
  had drifted: the update bubble and completion bubble each carried a
  short-circuit that hid them when `petHidden` / `miniMode` was on,
  even though permission bubbles correctly keep firing. v0.11.1 removes
  those short-circuits so all three bubble types behave the same way:
  the user still wants notifications when the pet is out of sight or
  pinned to the edge.
- **Update bubbles surface in `mini-sleep` (mini mode + DND).** The
  updater's `isSilentMode()` previously read `DND || mini`, which made
  `mini-sleep` silent and silently dropped the deferred
  "new-version-available" prompt on the floor. The semantics are now
  `DND && !mini`: DND alone is silence (deferred), mini alone is not
  (fires immediately), and `mini + DND` is also not — because the user
  tucked the pet at the edge precisely so they could be notified while
  sleeping.
- **Completion bubbles bypass mini mode.** Completion bubbles already
  bypass DND via `bubble-policy.js`'s `bypassDnd: true`; v0.11.1 extends
  the same rule to mini. `miniTransitioning` still suppresses
  everything during the mini enter/exit animation (that's owned by the
  bubble lifecycle in `main.js` / `mini.js`, not the bubble itself), but
  steady-state mini mode no longer swallows the toast.
- **Hidden pet drops to work-area bottom-right even with `bubbleFollowPet`
  on.** With the pet out of sight, anchoring a bubble to its last
  visible position is a visual orphan. All three bubble modules now
  resolve `bubbleFollowPet` against `petHidden` — when hidden, the
  bubble lands at the work-area bottom-right regardless of the toggle.
- **Hardened `_completionBubbleCtx`.** The completion-bubble context
  in `main.js` was missing the `doNotDisturb` getter that updater's
  context already exposes. With the getter missing, completion bubbles
  read `doNotDisturb === undefined` (falsy), so even DND-alone never
  gated them through the policy path. The runtime/test mismatch was
  the actual bug: tests use a plain-property ctx, runtime uses getters,
  and the missing getter slipped past the unit suite. Added.

### Implementation Notes

- **`isFollowingPet()` helper added to all three bubble modules.**
  `update-bubble.js`, `completion-bubble.js`, and `permission.js` each
  gained a one-liner: `return !!ctx.bubbleFollowPet && !ctx.petHidden;`.
  `computeBounds` / `repositionBubbles` now consult the helper instead
  of reading `ctx.bubbleFollowPet` directly, so hidden-pet always
  falls through to the work-area bottom-right anchor.
- **`isSilentMode()` inverted to `DND && !mini`.** `src/updater.js` had
  `return !!ctx.doNotDisturb || !!ctx.miniMode;` since the early mini
  work. The merge of `petHidden ≠ DND` semantics (already in AGENTS.md
  for the permission bubble) makes this the same conceptual rule:
  silence = the user's explicit "don't bother me" preference, nothing
  else. `onSilentModeExit()`'s comment was updated to match.
- **Completion bubble `syncVisibility` no longer checks `miniMode`.**
  The old code had `if (ctx.petHidden || ctx.miniMode) { bubble.hide();
  return; }`. The whole branch is gone; `syncVisibility` now only
  performs `showInactive()` + macOS floating defer + `reapplyMacVisibility`,
  exactly like update bubble's post-fix path.
- **Test mock → runtime parity gap surfaced.** The bubble-pet-hidden
  tests use a plain-property ctx (`petHidden: true`), so they never
  exercised the getter path. The runtime ctx in `main.js` uses `get
  petHidden()` / `get doNotDisturb()` getters so `isPetHidden()` and the
  prefs reflow through the module boundary. If we add another getter
  to `_completionBubbleCtx`, we need to add it to the test ctx too.
  Worth a future cleanup: convert bubble ctx to a `Proxy` so the test
  ctx can be shared verbatim.

### Bug Fixes

- **Update bubble silently dropped in mini-sleep.** Discovered by user
  smoke: pet at the right edge in mini mode, DND on, new version
  detected, no bubble fires. Root cause: `isSilentMode()` returned
  truthy for `DND || mini`, so the deferred prompt was held forever
  even after `miniMode` was the only "silent" flag. Fix: `isSilentMode
  = DND && !mini`. Covered by three new `updater.test.js` cases.
- **Completion bubble hidden when pet is hidden.** The
  `syncVisibility` short-circuit on `petHidden` was supposed to mirror
  update bubble, but update bubble has been wrong all along (see
  above). Both branches removed. Covered by `bubble-pet-hidden.test.js`.
- **Completion bubble hidden in mini mode (no DND).** Caught by user
  smoke after the first fix: completion toast never shows in mini
  alone. Fix: drop the `miniMode` branch from `syncVisibility` entirely
  (DND bypass is already handled by policy). Covered by
  `bubble-pet-hidden.test.js` (case: `miniMode=true`, DND off).
- **Completion bubble hidden in mini-sleep.** Same code path, but with
  DND on. Root cause: missing `doNotDisturb` getter on
  `_completionBubbleCtx` meant `ctx.doNotDisturb` was `undefined` →
  `bubble-policy.js`'s `bypassDnd: true` evaluation was working on a
  half-wired ctx, and the rest of the chain was silent. Fix: add the
  getter. Surfaced by debug `console.log` after the first two fixes.
- **`onSilentModeExit` docstring out of date.** The function comment
  described a two-flag silent model (DND off + mini off both required)
  that no longer matches `isSilentMode()`. Updated to describe the
  actual `DND && !mini` rule.

### Upgrade Notes

- This release ships from `main` at the v0.11.1 tag. v0.11.0 is the
  prior `package.json` version on this fork's main but has never been
  tagged (the `v0.11.0` tag exists only on upstream
  `rullerzhou-afk/clawd-on-desk`).
- No data migration is required. `prefs` schema is unchanged.
- After upgrade, existing users will see a different bubble behavior:
  when the pet is hidden or tucked at the edge, update + completion
  bubbles now appear (as the permission bubble already did), landing
  at the work-area bottom-right if `bubbleFollowPet` is on. Permission
  bubbles are unchanged.
- Release metadata is bumped to `0.11.1` in `package.json` and
  `package-lock.json`.

### Test Coverage

- 4319 / 4344 tests pass on this release (running the full
  `test/*.test.js` suite).
- The 13 Hermes plugin failures and 12 skips remain pre-existing on
  Windows (python not on PATH, exit code 9009); unrelated to this
  release. See `docs/guides/known-limitations.md`.
- New tests:
  - `test/bubble-pet-hidden.test.js` (new file): 8 cases locking the
    petHidden / miniMode suppression contract across update + completion
    bubbles — bottom-right anchor when hidden + followPet, follows pet
    when visible + followPet, syncVisibility ignores petHidden, syncVisibility
    ignores miniMode, syncVisibility ignores miniMode + DND.
  - `test/updater.test.js`: replaced 3 cases that asserted the old
    `DND || mini` semantic with 3 cases that lock the new `DND && !mini`
    semantic (mini alone fires, mini-sleep fires, DND-alone defers and
    fires on `onSilentModeExit`).
- Manual smoke: launched fresh with pet hidden (tray Hide), triggered
  one completion toast + one fake update notification, both surfaced
  at the work-area bottom-right with `bubbleFollowPet=true`. Repeated
  with pet at the right edge in mini mode (DND off): both bubbles
  appeared, anchored to the pet. Repeated with mini-sleep (DND on):
  same as mini-alone, bubbles fire.

### Known Limitations

- **macOS / Linux real-machine QA remains best-effort.** No new visual
  surfaces were added; the bubble positioning paths were validated on
  Windows.
- **Mock/runtime ctx parity gap is not auto-enforced.** Tests use
  plain-property ctx, runtime uses getters. A future cleanup should
  converge the two (proxy ctx, or property-style ctx at the bubble
  boundary) so missing getters can't slip past unit tests again.
- **Walk + roam still share a single toggle.** Same as v0.11.0 — both
  idle motion systems are wired through one switch in Settings →
  General → Idle desktop roaming.
- **DND alone still defers update bubbles.** That's intentional — DND
  is the actual silence preference. Exiting DND fires any deferred
  prompt via `onSilentModeExit()`.