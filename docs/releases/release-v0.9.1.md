## v0.9.1

v0.9.1 is a focused release on the **completion bubble**: making the
"task done" notification actually useful by showing what was asked
and how long it took, plus letting you tune how long the bubble
lingers. It also adds a local Windows build wrapper for contributors
working from networks where GitHub is unreachable. This release is
shipped from a fork at **chenyp-code/clawd-on-desk-diy** (see the
"Fork rebrand" section below) — all functional URLs in the binary
point at the fork home, so v0.9.1 does not auto-update from the
upstream repo.

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

### Fork Rebrand

This release is published from a personal fork of the upstream
[rullerzhou-afk/clawd-on-desk](https://github.com/rullerzhou-afk/clawd-on-desk)
project, hosted at **[chenyp-code/clawd-on-desk-diy](https://github.com/chenyp-code/clawd-on-desk-diy)**.
The rebrand is more than cosmetic — the following functional pieces
in the built binary now point at the fork home, not upstream:

- **About panel repo link** — `src/settings-ipc.js` `get-about-info`
  returns `repoUrl: "https://github.com/chenyp-code/clawd-on-desk-diy"`
  instead of the upstream URL. Clicking "View on GitHub" in the
  About dialog opens the fork.
- **Auto-update endpoint** — `src/updater.js` `RELEASES_LATEST_URL`
  and the GitHub API path the background scheduler hits both point
  at `chenyp-code/clawd-on-desk-diy`. v0.9.1 will not see updates
  published to the upstream repo; only releases pushed to the
  fork's GitHub Releases will be offered. (If you specifically
  want to follow upstream, build from a clone of the upstream
  repo and install that instead.)
- **electron-builder publish target** — `package.json`
  `build.publish.owner` and `build.publish.repo` are set to
  `chenyp-code` / `clawd-on-desk-diy` so the manual `Build & Release`
  workflow uploads new installers to the fork's releases page.
- **Pi extension install path** — `hooks/pi-install.js`
  `EXTENSION_DIR_NAME` is now `clawd-on-desk-diy`, so the extension
  lands at `~/.pi/agent/extensions/clawd-on-desk-diy` instead of
  `~/.pi/agent/extensions/clawd-on-desk`. The marker
  `app: "clawd-on-desk"` is intentionally kept unchanged so any
  pre-existing install on the old path still reads as a Clawd-
  managed install; if you had the old `clawd-on-desk` install
  before upgrading to the fork, manually remove
  `~/.pi/agent/extensions/clawd-on-desk` to avoid Pi loading both
  copies (the new uninstall script only cleans the new path).

Documentation also reflects the fork identity:

- All localized READMEs (English + zh-CN / zh-TW / ja-JP / ko-KR)
  point badges, release links, clone URLs, and issue tracker links
  at the fork. The "Forked from" attribution and the original-
  creator / artwork credits stay accurate to
  [@rullerzhou-afk](https://github.com/rullerzhou-afk) (鹿鹿) — this
  fork does not claim authorship of the original work.
- The setup guide and three `docs/plans/plan-issue-*` documents
  that referenced upstream issues by URL are updated to the fork's
  issue tracker. Issue numbers in the plan files (244, 357, 416)
  are upstream-specific and may not exist in the fork — clicking
  them from the fork's docs is expected to 404 until the
  corresponding issues are re-filed.
- `.gitignore` already whitelists the new release-notes file under
  `docs/releases/`.

The fork rebrand was added in two commits on top of the original
v0.9.1 feature commit:

- `4cc784b` — `README.md` rebrand + Pi install path rename
  (1 file outside README: `hooks/pi-install.js` + its test).
- `af529e5` — 13 other files: localized READMEs, setup guides,
  plan docs, `package.json` `build.publish`, `src/settings-ipc.js`
  `repoUrl`, `src/updater.js` release endpoints and tests.

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
