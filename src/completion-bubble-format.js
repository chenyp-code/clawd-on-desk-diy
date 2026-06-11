"use strict";

// Locale-neutral task duration formatter. The completion-bubble HTML
// renderer inlines a copy of formatDurationMs because its CSP blocks
// <script src> on file:// (script-src 'unsafe-inline' only). Keep both
// implementations in sync when changing the format rules.
(function (root) {
  function formatDurationMs(ms) {
    if (!Number.isFinite(ms) || ms < 0) return null;
    if (ms < 1000) return `${Math.round(ms)}ms`;
    const seconds = ms / 1000;
    if (seconds < 60) {
      // One decimal under 10s so a 2.3s task reads as "2.3s"; over 10s the
      // decimal adds noise and we round.
      return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
    }
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${min}m${sec}s`;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { formatDurationMs };
  } else {
    root.ClawdCompletionBubbleFormat = { formatDurationMs };
  }
})(typeof globalThis !== "undefined" ? globalThis : this);