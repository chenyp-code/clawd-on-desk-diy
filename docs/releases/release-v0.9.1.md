## v0.9.1

v0.9.1 is a focused release on the **completion bubble**: making the
"task done" notification actually useful by showing what was asked
and how long it took, plus letting you tune how long the bubble
lingers. It also adds a local Windows build wrapper for contributors
working from networks where GitHub is unreachable.

### New Features

- **Completion bubble shows the user request.** The completion bubble
  now displays the session's prompt title (the first user request that
  started the work) instead of an empty header, so when a long task
  finishes in another window you can tell at a glance which request
  just wrapped up.
- **Task duration chip in the completion bubble.** A small gray
  duration label sits next to the "已完成" pill and reports how long
  the task took. Format: milliseconds under 1s, one-decimal seconds
  under 10s, whole seconds under a minute, `m+s` from one minute up
  (`2.3s`, `47s`, `1m23s`). Hidden when the elapsed time is unknown
  (e.g. resumed sessions that never received a `UserPromptSubmit`).
- **Settings: Completion bubble auto-close.** A new slider / number
  control in Settings → General lets you choose how many seconds the
  completion bubble stays on screen before auto-dismissing
  (`completionBubbleAutoCloseSeconds`, 0 = off). The change is wired
  through the preferences store, the settings effect router, and the
  i18n catalogs in all five locales.
- **Local Windows build wrapper (`scripts/build-windows.sh`).** A
  small bash wrapper around `electron-builder --win nsis:x64` that
  detects whether the local clash/VPN proxy is up and sets
  `HTTPS_PROXY` / `HTTP_PROXY` accordingly, always routes
  Electron / NSIS downloads through `npmmirror` to bypass GitHub, and
  skips the sidecar prebuild hook (so the installer builds even when
  `bin/cc-connect-clawd/` is empty — the resulting installer will
  lack Telegram approval, run `npm run fetch:sidecars` separately
  in a GitHub-reachable environment to enable it). Usage:
  `scripts/build-windows.sh` for x64, `scripts/build-windows.sh
  --win nsis:arm64` for ARM64. Documented in
  `docs/project/release-process.md` under "Local Manual Build (China
  mirror workaround)".

### Bug Fixes

- **Completion bubble missing the request on resumed sessions.**
  When a Claude Code session was resumed, the `UserPromptSubmit` hook
  that supplies the session title never fired for the *current* turn,
  so the bubble came up with an empty header. The hook now falls back
  to the most recent user prompt in the transcript JSONL
  (`~/.claude/projects/.../<sessionId>.jsonl`) when the live prompt
  payload is unavailable, so resumed sessions also get a meaningful
  title.

### Upgrade Notes

- No data migration is required. Existing settings, sessions, and
  preferences are unchanged.
- The default completion-bubble auto-close value carries over from
  v0.9.0; if you have not touched it before, v0.9.1 still ships
  with the previous default. Visit Settings → General → Completion
  bubble to adjust it.
- The local build wrapper is a developer-only addition; end-user
  installers are unaffected. The official Windows / macOS / Linux
  installers still come from the `Build & Release` GitHub workflow.
- Release metadata is bumped to `0.9.1` in `package.json`.

### Docs & Contributors

- `docs/project/release-process.md` now has a "Local Manual Build
  (China mirror workaround)" section that documents
  `scripts/build-windows.sh` and the three quirks it works around
  (intermittent proxy, GitHub unreachability, sidecar prebuild
  hook). `.gitignore` was updated to whitelist the new script.
- The completion-bubble work shipped with new unit tests for the
  duration formatter (`test/completion-bubble-format.test.js`),
  bubble positioning (`test/completion-bubble-position.test.js`),
  end-to-end promote integration including the new
  `durationMs` path (`test/completion-bubble-promote-integration.test.js`),
  and a smoke test for the bubble renderer
  (`test/completion-bubble-smoke.js`). `test/bubble-policy.test.js`,
  `test/clawd-hook.test.js`, and `test/settings-actions.test.js`
  were extended to cover the new code paths.

### Known Limitations

- **Resumed-session duration is unknown.** When a Claude Code
  session is resumed, the duration chip stays hidden because
  Clawd never received the `UserPromptSubmit` that started the
  current turn. The title still works (transcript fallback), but
  the duration cannot be reconstructed from the on-disk transcript.
- **Local build wrapper is Windows x64 / ARM64 only.** macOS and
  Linux local builds are not wrapped; the script intentionally
  passes through to `npx electron-builder` and could be extended
  per platform later if needed.
- **macOS / Linux real-machine QA remains best-effort.** CI builds
  artifacts, but Windows remains the primary hands-on validation
  environment.
