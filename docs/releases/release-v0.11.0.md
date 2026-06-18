## v0.11.0

v0.11.0 is a **merge release** that reconciles our v0.9.3 Claude Code
token/call stats + idle roaming work with upstream
[rullerzhou-afk/clawd-on-desk](https://github.com/rullerzhou-afk/clawd-on-desk)
v0.10.0 (on-demand agent installations, CodeWhale + Reasonix CLI support,
auto-pilot, per-display text size, mobile companion token rotation,
Wayland/Linux ozone, etc.). Both lines of work ship together; nothing is
dropped.

For the full feature list of each side, see the prior release notes:

- [v0.9.3 — Claude Code token / call stats](./release-v0.9.3.md)
- [v0.10.0 — On-demand agents, CodeWhale, Reasonix, auto-pilot, mobile
  security, platform hardening](./release-v0.10.0.md)

### What's New in v0.11.0

- **Two idle-roaming systems now coexist.** v0.9.3 shipped the per-theme
  *walking* animation (8 directional SVG frames, ~3.5 s walking +
  ~2.5 s paused). v0.10.0 shipped upstream's *free roam* mode (state
  `"roam"`, gentle horizontal-bob CSS animation, idle-delay-tunable).
  Both are wired through `tick.js` / `main.js` / `renderer.js` and
  `state-priority.js`. Theme-driven walking kicks in when the active
  theme has walking SVGs and idle-roaming is on; free roam kicks in
  otherwise. They never fight over the state machine because walking
  uses `walking: 0.5` and roam uses `roam: 1` in the priority table —
  both stay below `idle: 1` and far below any active session state.
- **Tmux session metadata preserved across the merge.** While
  resolving the `state.js` base-object conflict, our v0.9.3 branch had
  accidentally dropped `tmuxSocket` / `tmuxClient` from the merged
  snapshot (both fields were still being set on line ~1343 of the
  same function but never made it into the persisted session object).
  Without the fix, v0.10.0's tmux terminal-focus resolution would have
  silently broken. Re-added in the merge commit.
- **Merged agent registry.** README and `agents/registry.js` now list
  all 17 agents: Claude Code, Codex, Copilot, Gemini, Antigravity,
  Cursor, CodeBuddy, Kiro, Kimi, Qwen, **CodeWhale** (v0.10.0),
  Reasonix (v0.10.0), opencode, Pi, OpenClaw, Hermes, **Qoder**
  (v0.9.3). The agent bullet list follows v0.10.0's "optional ...
  install from Settings → Agents" wording uniformly.
- **Five-locale token / call stat strings carried forward.** All
  v0.9.3 word-based stat labels (本轮 / 累計 / ↑ input / ↓ output /
  ↻ cache) continue to work in English, Simplified Chinese,
  Traditional Chinese, Korean, and Japanese. The completion bubble
  keeps its parallel `STATS_LABEL_DICTS` / `STATS_CALL_DICTS` table
  in the HTML bundle (CSP blocks `script src` on `file://`).
- **Updated release-process docs.** `docs/project/release-process.md`
  picks up the v0.11.0 versioning decision and the three-way-merge
  steps that were used to reconcile origin/main into our fork.

### Implementation Notes

- **Three-way merge of 269 files, 10 conflicted.** `git merge
  origin/main --no-ff --no-commit` produced conflicts in
  `.gitignore`, `README.md`, `package.json`, `package-lock.json`,
  `src/main.js`, `src/renderer.js`, `src/state-priority.js`,
  `src/state.js`, `src/tick.js`, `test/state-priority.test.js`. All
  resolved by hand. The `state.js` resolution was the only one that
  had a semantic fix attached (the dropped `tmuxSocket` /
  `tmuxClient` re-inclusion).
- **State priority table grows by one.** `state-priority.js` now
  carries both `walking: 0.5` (v0.9.3) and `roam: 1` (v0.10.0). Both
  are documented in the table comment so future contributors don't
  assume one supersedes the other.
- **Two ctx handles exposed from main.** `_tickCtx` now exposes both
  `roamingController` (v0.9.3 theme walking) and `roam` (v0.10.0
  free-roam). `tick.js` invokes both every idle cycle; whichever
  picks up the state wins, and the other sees its `isActive()`
  guard refuse the call.
- **Renderer handles two motion styles.** `renderer.js`'s
  `onStateChange` listener clears `walkingDirection` only when
  leaving `walking`, and toggles a `roam-walk` CSS class only on
  `roam`. So the same pet can be walking with directional SVGs one
  moment and free-roaming with a CSS bob the next.

### Bug Fixes

- **Merge: `tmuxSocket` / `tmuxClient` re-added to session base
  object.** Caught during conflict resolution: HEAD's v0.9.3 base
  object lost those fields when origin's v0.10.0 line for them was
  removed as part of the conflicting text. Without the fix, tmux
  terminal-focus resolution would have silently stopped working
  once a user upgraded to v0.11.0. Caught by manual review of the
  `state.js` diff rather than by a test — there is no test for
  `tmuxSocket` survival in the snapshot today.
- **Merge: README agent list keeps every agent on both sides.**
  HEAD added Qoder; origin added CodeWhale + Reasonix and rewrote
  the surrounding wording to "optional ... install from Settings →
  Agents". The merge takes origin's wording and inserts both sides'
  agents, so no agent is dropped or mis-described.

### Upgrade Notes

- This release is shipped from `main` at commit `e21a581`. The
  `v0.11.0` tag points at the merge commit. There is no `v0.9.3` or
  `v0.10.0` tag on this fork's main — both are subsumed.
- No data migration is required. `prefs` v11 (from v0.10.0) is
  unchanged; the v0.9.3 token/call stats remain derived live from
  hook events.
- First launch after upgrading will keep the user's existing v0.9.x
  prefs, then layer the v0.10.0 on-demand-agent model on top: the
  Settings → Agents tab will show installed / not-installed badges
  for every agent. Claude Code and Codex stay installed by default;
  the other 15 agents need a one-click install from that tab.
- The new `walking` state and the new `roam` state are independent
  visual modes. If a theme provides walking SVGs in all 8 directions
  (Clawd, Calico, Cloudling), theme walking is the default; themes
  without walking SVGs fall back to free-roam.
- Release metadata is bumped to `0.11.0` in `package.json` and
  `package-lock.json`.

### Test Coverage

- 4307 / 4332 tests pass on the merged tree.
- The 13 Hermes plugin failures and 12 skips are pre-existing on
  Windows (python not on PATH, exit code 9009); they are unrelated
  to this release. See `docs/guides/known-limitations.md`.
- Targeted run of merge-affected suites (roaming-controller,
  state-priority, state, state-session-snapshot, roam, server-route-
  state, session-token-usage, context-usage, server-state-title):
  374 / 374 pass.
- End-to-end manual smoke: launched fresh, POSTed a session with
  v0.9.3 token-stats fields + v0.10.0 tmuxSocket / tmuxClient
  fields simultaneously, exercised SessionStart → PostToolUse →
  SessionEnd lifecycle. State server accepts all merged fields, no
  JS errors, memory stable across the lifecycle.

### Known Limitations

- **macOS / Linux real-machine QA remains best-effort.** This is a
  merge release; no new visual surfaces were added. The walking
  animation, free-roam bob, and HUD chips were validated on Windows
  with the v0.9.3 and v0.10.0 artifacts respectively.
- **No backfill of stats from existing sessions.** Same as v0.9.3:
  the first turn after the upgrade will populate the chips; older
  sessions show "—" until a new event arrives.
- **Walk + roam both visible to the user.** Both idle motion
  systems are wired up; the toggle in Settings → General → Idle
  desktop roaming controls both at once (there is not yet a
  separate "free roam vs. theme walking" toggle — see
  `docs/investigations/` for the follow-up).