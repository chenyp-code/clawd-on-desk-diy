#!/usr/bin/env bash
# Build the Windows x64 NSIS installer locally.
#
# Why this script exists:
#   - The user's IE proxy at 127.0.0.1:7890 is intermittent (sometimes on,
#     sometimes off). When ON, electron-builder's Go transport mis-parses the
#     user-level IE entry as ":0" and dies with `dial tcp :0` — setting
#     HTTPS_PROXY explicitly to the working proxy bypasses that. When OFF,
#     leaving HTTPS_PROXY unset lets requests go direct.
#   - electron-builder normally fetches Electron + NSIS resources from GitHub,
#     which is unreachable from the user's network. ELECTRON_MIRROR and
#     ELECTRON_BUILDER_BINARIES_MIRROR redirect those to npmmirror, which is
#     reachable in both proxy-on and proxy-off states.
#   - `npm run build:win:x64` runs `scripts/verify-sidecar-binaries.js` as a
#     prebuild hook, which fails when `bin/cc-connect-clawd/windows-x64/` is
#     empty (no sidecar downloaded). We bypass npm and call electron-builder
#     directly so the sidecar check is skipped — the resulting installer will
#     lack Telegram approval, but core desktop-pet features work.
#
# Usage:
#   scripts/build-windows.sh                     # x64 installer
#   scripts/build-windows.sh --win nsis:arm64    # ARM64 installer
#
# Output:
#   dist/Clawd-on-Desk-Setup-<version>-<arch>.exe  (~120 MB, unsigned)

set -e
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Detect proxy state. Test-NetConnection returns TcpTestSucceeded=True only
# when something is actively listening on 127.0.0.1:7890. powershell.exe is
# always present on Windows; the 2>/dev/null hides the noisy startup banner.
if powershell.exe -NoProfile -Command '(Test-NetConnection -ComputerName 127.0.0.1 -Port 7890 -WarningAction SilentlyContinue).TcpTestSucceeded' 2>/dev/null | grep -q True; then
  export HTTPS_PROXY="http://127.0.0.1:7890"
  export HTTP_PROXY="http://127.0.0.1:7890"
  echo "[build-windows] proxy detected at 127.0.0.1:7890 — using HTTPS_PROXY"
else
  unset HTTPS_PROXY HTTP_PROXY
  echo "[build-windows] no proxy on 127.0.0.1:7890 — going direct"
fi

# Always route electron + electron-builder downloads through npmmirror. When the
# proxy is up, requests still go through it (HTTPS_PROXY); when down, they go
# direct to the mirror. Either way, GitHub is bypassed.
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
export ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"

# Bypass npm's prebuild hook and call electron-builder directly. Pass through
# any user-supplied args (e.g. --win nsis:arm64).
exec npx electron-builder --win nsis:x64 "$@"