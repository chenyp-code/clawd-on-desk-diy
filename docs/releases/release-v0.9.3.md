## v0.9.3

v0.9.3 ships the **Claude Code token / call stats** feature: when an
AI coding session finishes — or while it is running — Clawd now shows
how many tokens that session consumed (per-turn + session-cumulative)
and how many LLM calls it made. The numbers flow from the hook all the
way through to the HUD row, the dashboard, and the completion bubble
itself, in all five supported locales. This is the first release to
expose Claude Code's per-turn / cumulative `usage` block to the user
through the pet.

### New Features

- **HUD: per-turn + session-cumulative usage chips.** Each Claude Code
  row in the session HUD now shows two small chips: a teal "本轮
  {tokens} · {n} 次调用" chip for the most recent turn and an indigo
  "累计 {tokens} · {n} 次调用" chip for the lifetime of the session.
  The numbers refresh on every `PostToolUse` / `Stop` event from the
  hook and fall back to "—" until the first usage block lands. A
  faint detail line behind the chip shows the input / output / cache
  breakdown on hover.
- **Completion bubble: token + call totals in the body.** The "task
  done" bubble now reserves a two-row block below the prompt for
  per-turn and session totals (`本轮 1.2K · 3 次调用` /
  `累计 5.0K · 10 次调用`), each with a faint `↑ input · ↓ output ·
  ↻ cache` breakdown under it. Word-based labels (matching the HUD)
  replaced the previous `▲` / `Σ` glyphs so non-technical readers do
  not have to decode them. The block is hidden entirely when neither
  field is set, so legacy / pre-stats sessions render the same
  compact card.
- **Dashboard: per-turn + session-cumulative rows.** The Sessions
  dashboard's session detail card adds two rows mirroring the HUD
  chip: "本轮: 1.2K (3 次 LLM 调用)" and "会话累计: 5.0K (10 次
  LLM 调用)". Counts use locale-formatted thousands separators; the
  same call-count cap (`0` when unknown) applies.
- **Settings migration: `hudShowContextUsage` covers usage stats.**
  The existing `sessionHudShowContextUsage` toggle now hides the new
  per-turn / session-cumulative chips as well as the legacy context
  percentage chip, so users who preferred a clean HUD can disable
  all token-related chips from one switch. The migration runs at
  first prefs load.
- **Five-locale coverage.** All new stat strings ship in English,
  Simplified Chinese, Traditional Chinese, Korean, and Japanese;
  the completion bubble carries its own parallel dictionary so the
  CSP-blocked `file://` renderer does not have to load the full
  i18n bundle.

### Implementation Notes

- **Hook side: extract per-turn usage + call count.** The Claude
  hook reads the last `assistant` entry from the session's
  `entries/` JSONL files via `extractClaudeLastTurnUsageFromEntries`
  and counts `assistant` messages since the previous `user` turn via
  `countAssistantCallsInLastTurn`. Both helpers are pure and unit
  tested. The hook also remembers the last `assistant` entry id
  (`last_assistant_entry_id`) so the server side can detect turn
  boundaries and reset `lastTurnUsage` / `lastTurnCallCount` without
  double-counting.
- **Server side: pass-through + accumulation.** `buildStateBody`
  forwards `usage` (per-turn), `last_assistant_entry_id`, and
  `last_assistant_call_count` to the state server.
  `normalizeAssistantUsageForMerge` validates the shape strictly
  (any missing field → `null`; no silent zero defaults). On the
  state side, `mergeSessionTokenUsage` accumulates into
  `sessionTokenUsage` idempotently (re-POSTs of the same turn do
  not double-count), and `resetSessionTokenUsage` zeroes it on
  `SessionStart`. `lastTurnCallCount` clamps to `0` on negative
  input to match the plan spec.
- **Snapshot side: surface the new fields + invalidate the cache.**
  `buildSessionSnapshot` now exposes `lastTurnUsage`,
  `lastTurnCallCount`, `sessionTokenUsage`, and `sessionCallCount`
  to the HUD and dashboard renderers. The snapshot signature
  includes all six new fields so renderers actually receive the
  update — without that line in the signature, the new fields
  were cached away and the whole feature silently did nothing.
- **i18n: 5-locale word-based labels.** The new keys
  `hudThisTurnChip`, `hudSessionChip`, `dashboardThisTurnUsage`,
  `dashboardSessionUsage`, `dashboardCallCount`, and
  `usageStatLabel` are filled in for all five locales. The bubble
  keeps a parallel `STATS_LABEL_DICTS` / `STATS_CALL_DICTS` table
  in its HTML bundle (CSP blocks `script src` on `file://`) —
  keep both in sync when adding languages.
- **HUD chip styling.** Per-turn and session chips are visually
  distinct: teal (`#0d9488`) for the per-turn chip and indigo
  (`#4f46e5`) for the cumulative chip, so the eye can separate
  "this turn" from "since session start" at a glance. Font bumped
  10px → 11px to be more legible against the 28px row height.

### Bug Fixes

- **Completion bubble fired before the session existed.** The
  immediate-celebration path called `fireCompletionBubble` before
  `sessions.set(...)` ran, then bailed out when the session lookup
  missed — so the very first reply on a brand-new session had no
  bubble and no stats payload. `fireCompletionBubble` now does a
  null-safe read of `lastTurnUsage` / `lastTurnCallCount` /
  `sessionTokenUsage` / `sessionCallCount` and fires regardless.
- **`sessionSnapshotSignature` did not include the new fields.**
  Without the six new fields in the signature entry, the snapshot
  cache treated every session as unchanged after the first turn
  and never re-broadcast the stats to the renderers. Added all
  six fields (`lastTurnUsage`, `lastTurnCallCount`,
  `sessionTokenUsage`, `sessionCallCount`, and their `.total` /
  `.input` / `.output` / `.cacheRead` / `.cacheCreation` access
  paths) to the signature so HUD/dashboard/bubble all wake up on
  each `PostToolUse` / `Stop`.

### Upgrade Notes

- No data migration is required. The new stats are derived live
  from each hook event; nothing is persisted in `clawd-prefs.json`.
- The first time the HUD receives a snapshot after this update,
  the per-turn and session-cumulative chips will be empty until
  the next `PostToolUse` / `Stop` event from the running session
  arrives. There is no backfill.
- Users who want the HUD to stay clean can leave
  `sessionHudShowContextUsage = false`; the new chips hide
  together with the legacy context percentage chip.
- Release metadata is bumped to `0.9.3` in `package.json`.
- This release is shipped from the `feature/walking-roaming`
  branch. The tag will be visible on `main` once that branch is
  merged; the published v0.9.3 artifact is built from this tag.

### Test Coverage

New / extended tests covering this release:

- `test/hook-claude-last-turn-usage.test.js` —
  `extractClaudeLastTurnUsageFromEntries` (positive,
  cache-only, malformed, missing-files, multiple-turns).
- `test/hook-count-assistant-calls.test.js` —
  `countAssistantCallsInLastTurn` (single, multi, empty, broken
  JSONL, mixed roles).
- `test/hook-find-last-assistant-entry.test.js` —
  `findLastAssistantEntry` (latest-by-mtime, fallback-to-scalar,
  empty-session).
- `test/state-session-snapshot-token-stats.test.js` —
  `mergeSessionTokenUsage` idempotency, `resetSessionTokenUsage`
  on `SessionStart`, `lastTurnCallCount` clamp-to-zero.
- `test/state-session-snapshot.test.js` — extended to assert the
  new fields are surfaced and that the signature changes when
  they change.
- `test/completion-bubble-position.test.js` — extended
  `estimateHeight` tests for the 44px stats block reserve.
- `test/bubble-format.test.js`,
  `test/completion-bubble-format.test.js`,
  `test/session-hud-renderer.test.js`,
  `test/dashboard-renderer.test.js` — extended for the new
  word-based labels and the lang-aware stats dicts.
- Plan doc: `docs/plans/2026-06-16-claude-token-call-stats.md`
  (not in git, kept locally for traceability).

### Known Limitations

- **macOS / Linux real-machine QA remains best-effort.** The new
  stats feature is driven by hook data, which is OS-agnostic, but
  the visual presentation was validated on Windows. The HUD and
  completion bubble use the same render path as in v0.9.2.
- **Hermes plugin Python tests are still red on this Windows
  env.** The 13 failures in `test/hermes-plugin.test.js` are
  pre-existing and caused by `python` not being on PATH
  (Windows exit code 9009); they are unrelated to this release.
  The other 3908 tests pass.
- **Per-turn call count is "assistant messages in last turn",
  not "LLM round-trips".** A single turn can contain multiple
  `assistant` messages (e.g. one text reply plus several tool
  uses across separate `assistant` entries). The number reflects
  what is in the `entries/` JSONL, not what Claude Code reports
  on the wire.
- **Stats only refresh on `PostToolUse` / `Stop`.** Long-running
  turns that do not produce a hook event will not update the HUD
  until the next event. This matches the v0.9.2 baseline behavior
  and avoids a poll loop.
