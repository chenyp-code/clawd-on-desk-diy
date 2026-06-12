## v0.9.2

v0.9.2 adds **idle desktop roaming**: when the mouse is still and no AI
coding session is running, Clawd can walk around your desktop in 8
random directions instead of just standing or sleeping. It is the first
v0.9.x release to introduce a brand-new pet state — `walking` — and the
infrastructure that supports it (a separate target picker, an
`animateWindowXY` window-move primitive, a roaming controller, a
preference toggle, a settings UI switch in 5 locales, and a per-theme
`walking` asset slot in all three built-in themes plus the template).

### New Features

- **Idle desktop roaming.** After ~20 seconds of mouse idle with no
  live AI coding session, Clawd may start a walk/pause loop —
  ~3.5 s walking in one of 8 directions, then ~2.5 s paused — until
  any mouse activity or higher-priority event interrupts it. The
  feature sits between `idle` and `sleeping` in the state priority
  table, so notifications, attention, errors, working / thinking /
  sweeping / carrying / juggling and the deep-sleep sequence all
  preempt it cleanly. Default target distance is 180–320 px, target
  points within 150 px of the mouse cursor are rejected (up to 8
  retries), and targets are clamped into the current display's work
  area via `computeLooseClamp`.
- **Settings toggle: Idle desktop roaming.** New switch row under
  `Settings…` → `General` → `Appearance`, persisted as
  `idleRoamingEnabled` (default `true`). Localized into English,
  Simplified Chinese, Traditional Chinese, Korean, and Japanese.
  Routed through the settings effect router so flipping it off
  immediately stops any active walk.
- **Per-theme walking opt-in.** Themes can declare the feature with
  two new sections in `theme.json`: a `states.walking` slot
  containing 9 files (`up`/`down`/`left`/`right`/`up-left`/
  `up-right`/`down-left`/`down-right`/`paused`) and a top-level
  `walkingRoaming` block tuning `walkDurationMs`, `pauseDurationMs`,
  `walkSpeedPxPerSec`, `minTargetDistPx`, `maxTargetDistPx`, and
  `avoidRadiusPx`. Themes that omit either piece stay completely
  still while idle. All three built-in themes (Clawd, Calico,
  Cloudling) and the `themes/template/` scaffold ship the slot;
  the built-in themes ship placeholder SVGs in `assets/svg/` that
  authors can swap for real per-direction art without touching the
  rendering pipeline.
- **`animateWindowXY` window-move primitive.** New
  `src/walking-animator.js` mirrors the existing `animateWindowX`
  used by mini mode but supports 2D motion. It uses a frame counter
  (not wall-clock time), calls `win.setPosition({x, y})`, and exposes
  a `cancel()` function plus a `completed` flag so `onDone` fires at
  most once. Bench-tested via Node's built-in test runner with a
  manual frame driver.
- **Target picker + roaming controller modules.** Two new pure-logic
  modules — `src/walking-target-picker.js` (random 8-direction
  selection, distance, work-area clamp, mouse avoid radius) and
  `src/roaming-controller.js` (walk/pause cycle, gating on
  sessions / drag / menu / mini / DND / theme support, IPC
  `walking-direction` to the renderer) — keep the new behavior off
  the hot path in `tick.js` and `main.js`.
- **Renderer direction awareness.** `src/renderer.js` now listens for
  a `walking-direction` IPC message and stores it alongside the
  current state so the right per-direction asset is shown for each
  walk segment. The direction is cleared automatically when the
  state leaves `walking`.

### Improvements

- **State priority table now includes `walking(0.5)`.** Added between
  `idle(1)` and `sleeping(0)` so higher-priority events naturally
  preempt the walk without any special-case logic in `state.js`.
- **Theme schema validates the walking slot strictly.** When
  `states.walking` is present it must be an object with all 9
  direction keys; missing keys or non-object values are rejected
  with a clear error. The schema also validates the
  `walkingRoaming` block (numbers, sensible bounds) and fills in
  `DEFAULT_WALKING_ROAMING` for themes that declare the slot but
  leave the config block out.
- **Bug fix discovered during validation:** the visual-fallback
  chain check in `src/theme-schema.js` previously walked the entire
  `fallbackTo` chain even for states that had no `fallbackTo` at
  all, which made the loop scan unrelated states. The check now
  skips entries with no `fallbackTo`, matching the behavior the
  tests already expected.

### Upgrade Notes

- No data migration is required. The new `idleRoamingEnabled`
  preference defaults to `true` and is added at next prefs load
  via the existing migrate path.
- Roaming will only fire for themes that ship the new `walking`
  state slot. Third-party themes built against earlier releases
  stay perfectly still — they do not need to change.
- Theme authors who want to opt in can copy the `walking` slot and
  `walkingRoaming` block from `themes/template/theme.json` and
  provide their own 9 direction assets.
- The new IPC channel `walking-direction` is internal; nothing else
  needs to handle it.
- Release metadata is bumped to `0.9.2` in `package.json`.

### Docs & Contributors

- `docs/guides/state-mapping.md` and the zh-CN translation have a
  new `walking` row in the state-event table plus an "Idle desktop
  roaming" subsection covering trigger conditions, the global
  toggle, per-theme opt-in, and the priority slot.
- `docs/guides/guide-theme-creation.md` now documents the `walking`
  state in the additional-states table and adds a dedicated
  "Walking — Idle Desktop Roaming" section with the full JSON
  shape and per-knob explanation.
- `docs/project/theme-state-ui.md` lists `walking(0.5)` in the
  priority breakdown and gains an "Idle Desktop Roaming (Walking)"
  project-level overview that links picker / animator / controller
  / tick / settings-router wiring.
- `AGENTS.md` Core Files table adds the three new `src/walking-*`
  / `src/roaming-controller.js` modules and a Constraints line
  describing the two-layer (global toggle + per-theme) enablement.
- All five top-level READMEs (English, zh-CN, zh-TW, ko-KR, ja-JP)
  add a single Features bullet under Animations & Interaction
  describing the feature, default-on toggle path, and the cancel-
  on-mouse-move behavior.
- Test coverage added: `test/walking-target-picker.test.js` (10
  tests), `test/walking-animator.test.js` (4 tests),
  `test/roaming-controller.test.js` (10 tests), plus extensions to
  `test/state-priority.test.js`, `test/theme-schema.test.js`,
  `test/prefs.test.js`, `test/settings-actions.test.js`, and
  `test/settings-effect-router.test.js`.

### Known Limitations

- **Built-in themes ship placeholder walking SVGs.** The 27 new
  `assets/svg/{clawd,calico,cloudling}-walking-*.svg` files render
  as minimal pixel sketches with a `walk-bob` keyframe. The
  rendering pipeline, target selection, IPC plumbing, and settings
  toggle are production-ready; the per-direction art for the
  built-ins is intentionally simple and can be upgraded in a later
  minor release without any schema or wiring change.
- **macOS / Linux real-machine QA remains best-effort.** Roaming
  was developed and verified on Windows. The window-move primitive
  uses Electron's `setPosition({x, y})` and `screen.getDisplayNearestPoint`,
  both of which work the same way on all three platforms, but
  display-edge edge cases on macOS and Linux are reviewed by
  inspection rather than hands-on testing.
- **Hermes plugin Python tests are still red on this Windows env.**
  The 13 failures in `test/hermes-plugin.test.js` are pre-existing
  and caused by `python` not being on PATH (Windows exit code 9009);
  they are unrelated to this release. The other 3804 tests pass.
