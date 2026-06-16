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

  // Locale-neutral token count formatter. Returns null for invalid input so
  // callers can decide how to render. Uses uppercase K/M, e.g. "1.2K", "1.2M".
  // The completion-bubble HTML renderer inlines a copy of this helper because
  // its CSP blocks <script src>; keep both copies in sync when changing rules.
  function formatTokenCount(n) {
    if (n === null || n === undefined) return null;
    const v = Number(n);
    if (!Number.isFinite(v) || v < 0) return null;
    if (v < 1000) return String(Math.round(v));
    if (v < 10000) return `${(v / 1000).toFixed(1)}K`;
    if (v < 1000000) return `${Math.round(v / 1000)}K`;
    return `${(v / 1000000).toFixed(1)}M`;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { formatDurationMs, formatTokenCount };
  } else {
    root.ClawdCompletionBubbleFormat = { formatDurationMs, formatTokenCount };
  }
})(typeof globalThis !== "undefined" ? globalThis : this);