"use strict";

const DEFAULT_CLAUDE_CONTEXT_LIMIT = 200000;
const CLAUDE_1M_CONTEXT_LIMIT = 1000000;
const CLAUDE_1M_CONTEXT_MARKER_RE = /(?:^|[^a-z0-9])1m(?:[^a-z0-9]|$)/i;

function normalizeUsageNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function resolveClaudeContextLimit(model) {
  const raw = typeof model === "string" ? model.toLowerCase() : "";
  if (!raw) return DEFAULT_CLAUDE_CONTEXT_LIMIT;
  if (CLAUDE_1M_CONTEXT_MARKER_RE.test(raw)) return CLAUDE_1M_CONTEXT_LIMIT;
  if (raw.includes("opus") || raw.includes("sonnet") || raw.includes("haiku")) {
    return DEFAULT_CLAUDE_CONTEXT_LIMIT;
  }
  return null;
}

function computeClaudeUsageFromEntry(entry) {
  const message = entry && entry.message && typeof entry.message === "object"
    ? entry.message
    : null;
  const usage = message && message.usage && typeof message.usage === "object"
    ? message.usage
    : (entry && entry.usage && typeof entry.usage === "object" ? entry.usage : null);
  if (!usage) return null;

  const used =
    normalizeUsageNumber(usage.input_tokens)
    + normalizeUsageNumber(usage.cache_read_input_tokens)
    + normalizeUsageNumber(usage.cache_creation_input_tokens);
  if (!Number.isFinite(used) || used <= 0) return null;

  const model =
    (message && typeof message.model === "string" && message.model)
    || (typeof entry.model === "string" && entry.model)
    || "";
  const limit = resolveClaudeContextLimit(model);
  const out = { used, source: "claude" };
  if (limit) {
    out.limit = limit;
    out.percent = Math.max(0, Math.min(100, Math.round((used / limit) * 100)));
  }
  return out;
}

// Mirror the transcript-pollution guards used by the assistant-output
// extractor in clawd-hook.js. Without these, the most recent usage-bearing
// entry can belong to a Task sub-agent (sidechain), a different session
// (resumed/forked transcript), or a synthetic API-error message — none of
// which reflect the main session's context window.
function entryMatchesSession(entry, sessionId) {
  if (!sessionId) return true;
  if (!entry || typeof entry !== "object") return false;
  return !entry.sessionId || entry.sessionId === sessionId;
}

function entryLooksSubagent(entry) {
  if (!entry || typeof entry !== "object") return false;
  return entry.isSidechain === true
    || entry.isSubagent === true
    || entry.is_subagent === true
    || entry.subagent === true;
}

function extractClaudeContextUsageFromEntries(entries, sessionId) {
  if (!Array.isArray(entries)) return null;
  // Walk backwards so the first acceptable entry is the most recent one,
  // skipping non-assistant / sub-agent / cross-session / API-error entries
  // rather than letting a trailing message win. Usage is only meaningful on
  // assistant turns; the type guard also stops a future non-assistant record
  // that happens to carry a usage object from being read as Claude context.
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (!entry || typeof entry !== "object") continue;
    if (entry.type !== "assistant") continue;
    if (entry.isApiErrorMessage === true) continue;
    if (!entryMatchesSession(entry, sessionId)) continue;
    if (entryLooksSubagent(entry)) continue;
    const usage = computeClaudeUsageFromEntry(entry);
    if (usage) return usage;
  }
  return null;
}

function computeAssistantUsage(entry) {
  const message = entry && entry.message && typeof entry.message === "object" ? entry.message : null;
  const usage = message && message.usage && typeof message.usage === "object" ? message.usage : null;
  if (!usage) return null;
  const input = normalizeUsageNumber(usage.input_tokens);
  const output = normalizeUsageNumber(usage.output_tokens);
  const cacheRead = normalizeUsageNumber(usage.cache_read_input_tokens);
  const cacheCreation = normalizeUsageNumber(usage.cache_creation_input_tokens);
  const total = input + output + cacheRead + cacheCreation;
  if (total <= 0) return null;
  return { input, output, cacheRead, cacheCreation, total };
}

function userEntryIsToolResultOnly(entry) {
  const content = entry && entry.message && entry.message.content;
  if (!Array.isArray(content) || content.length === 0) return false;
  return content.every((part) => part && typeof part === "object" && part.type === "tool_result");
}

function extractClaudeLastTurnUsageFromEntries(entries, sessionId) {
  if (!Array.isArray(entries)) return null;
  let turnStart = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (!e || typeof e !== "object") continue;
    if (e.type !== "user") continue;
    if (userEntryIsToolResultOnly(e)) continue;
    if (!entryMatchesSession(e, sessionId)) continue;
    turnStart = i;
    break;
  }
  if (turnStart < 0) return null;

  let aggregate = null;
  for (let i = turnStart + 1; i < entries.length; i++) {
    const e = entries[i];
    if (!e || typeof e !== "object") continue;
    if (e.type !== "assistant") continue;
    if (e.isApiErrorMessage === true) continue;
    if (!entryMatchesSession(e, sessionId)) continue;
    if (entryLooksSubagent(e)) continue;
    const u = computeAssistantUsage(e);
    if (!u) continue;
    if (!aggregate) aggregate = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 };
    aggregate.input += u.input;
    aggregate.output += u.output;
    aggregate.cacheRead += u.cacheRead;
    aggregate.cacheCreation += u.cacheCreation;
    aggregate.total += u.total;
  }
  if (!aggregate) return null;
  aggregate.source = "claude";
  return aggregate;
}

function countAssistantCallsInLastTurn(entries, sessionId) {
  if (!Array.isArray(entries)) return 0;
  let turnStart = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (!e || typeof e !== "object") continue;
    if (e.type !== "user") continue;
    if (!entryMatchesSession(e, sessionId)) continue;
    if (userEntryIsToolResultOnly(e)) continue;
    turnStart = i;
    break;
  }
  if (turnStart < 0) return 0;

  let count = 0;
  for (let i = turnStart + 1; i < entries.length; i++) {
    const e = entries[i];
    if (!e || typeof e !== "object") continue;
    if (e.type !== "assistant") continue;
    if (e.isApiErrorMessage === true) continue;
    if (!entryMatchesSession(e, sessionId)) continue;
    if (entryLooksSubagent(e)) continue;
    count += 1;
  }
  return count;
}

module.exports = {
  CLAUDE_1M_CONTEXT_LIMIT,
  DEFAULT_CLAUDE_CONTEXT_LIMIT,
  computeAssistantUsage,
  computeClaudeUsageFromEntry,
  countAssistantCallsInLastTurn,
  extractClaudeContextUsageFromEntries,
  extractClaudeLastTurnUsageFromEntries,
  resolveClaudeContextLimit,
};
