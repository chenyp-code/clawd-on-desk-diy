# Release Process

Use this flow when preparing a Clawd app release.

## Before Tagging

1. Update `package.json` to the release version.
2. Add `docs/releases/release-vX.Y.Z.md`.
3. Run the local tests that match the change scope. For full release prep, run:

```bash
npm test
node scripts/verify-sidecar-binaries.js prebuild:all
```

4. Run the `Build & Release` workflow manually on `main`.

Manual workflow dispatch builds Windows, macOS, and Linux artifacts, fetches the
pinned `cc-connect-clawd` sidecar release, verifies source-pinned checksums, and
uploads build artifacts. It does not publish a GitHub Release.

## Draft Release

After the manual build artifacts look good, create and push the final version
tag:

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

Pushing a `v*` tag runs the same build workflow again and creates a draft GitHub
Release with the generated installers and release notes. Draft releases are not
visible to normal users and are not consumed by the updater.

Download and smoke-test the draft release assets before publishing the draft.
If the draft is wrong, fix the issue before publishing; do not publish a known
bad draft release.

## Sidecar Dependency

Clawd release builds do not consume upstream `cc-connect` latest artifacts. They
download the fixed `cc-connect-clawd` fork release pinned by
`scripts/fetch-sidecar-binaries.js`, verify SHA256 values pinned in that script,
and package those binaries into app resources.

When the sidecar needs an upstream update, publish a new fixed sidecar release
from the fork first, then update the Clawd pin and rerun the fetch/verify tests.

## Local Manual Build (China mirror workaround)

The `Build & Release` GitHub workflow assumes GitHub is reachable. When building
on a machine where GitHub is unreachable (e.g. mainland China without a working
proxy), electron-builder itself fails to download Electron + NSIS resources, and
the sidecar fetch times out. Use the wrapper script below — it auto-detects
whether the user's local proxy is up and adjusts env vars accordingly.

```bash
scripts/build-windows.sh                  # x64 installer
scripts/build-windows.sh --win nsis:arm64 # ARM64 installer
```

The script handles three quirks:

- **Intermittent proxy at `127.0.0.1:7890`.** The user's local clash/VPN proxy
  is sometimes on, sometimes off. When ON, Go's `http.Transport` inside
  `app-builder` picks up the IE-level proxy entry and mis-parses it as `:0`,
  dying with `dial tcp :0`. Setting `HTTPS_PROXY`/`HTTP_PROXY` explicitly
  bypasses that. When OFF, leaving the env vars unset lets requests go direct.
  The script does this detection on every run via `Test-NetConnection`.
- **GitHub unreachability.** `ELECTRON_MIRROR` and `ELECTRON_BUILDER_BINARIES_MIRROR`
  redirect the two download paths electron-builder hits (`electron-vX.Y.Z-*.zip`
  and `nsis-*.7z` / `nsis-resources-*.7z`) to npmmirror, which is reachable in
  both proxy-on and proxy-off states.
- **`npm run build:win:x64` prebuild hook.** The script calls `electron-builder`
  directly via `npx`, bypassing the `scripts/verify-sidecar-binaries.js` hook
  that fails when `bin/cc-connect-clawd/` is empty. The resulting installer
  will lack Telegram approval — run `npm run fetch:sidecars` separately in an
  environment with GitHub access if Telegram support is needed.

Output: `dist/Clawd-on-Desk-Setup-<version>-x64.exe` (~120 MB) + `dist/latest.yml`.

Installer is **unsigned** without `CSC_LINK` / `CSC_KEY_PASSWORD`. SmartScreen
will warn on first install; users click "more info → run anyway".

`dist/` is already in `.gitignore`.
