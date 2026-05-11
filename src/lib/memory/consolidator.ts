import { existsSync } from "fs";
import { readFile, rm } from "fs/promises";

import { query } from "@anthropic-ai/claude-agent-sdk";

import { applyDiff, readAutoMemory, writeAutoMemory, type AutoMemoryDiff } from "./auto-store";
import { loadAutoMemoryConfig, updateAutoMemoryConfig } from "./auto-config";
import { consolidatorClaudeProjectsDir, consolidatorCwd, ensureConsolidatorCwd } from "./paths";

/**
 * Post-session consolidator. After a chat session goes idle, run a
 * cheap Haiku call that reads the recent transcript and emits a JSON
 * diff describing stable user-level facts to remember. Then apply that
 * diff to `/root/.memory/global/auto.md`.
 *
 * Trigger / debounce live in `ConsolidationScheduler` so the runtime
 * can attach the scheduler to its existing turn_complete pipeline
 * without dragging in the whole module just to schedule.
 */

/** Pinned consolidator system prompt. Tight scope by design. */
export const CONSOLIDATOR_SYSTEM_PROMPT = `You extract STABLE, USER-LEVEL facts from a chat transcript so a future
chat session knows them. Output JSON only — no prose, no code fences.

ALLOWED: name, role, location/timezone, languages, primary tech stack,
durable communication preferences, recurring tools/services they use.

FORBIDDEN: project-specific facts, transient preferences ("today I'm…"),
instructions to the AI ("answer in lowercase"), opinions about people,
secrets, anything that contradicts the existing curated memory, anything
imperative (do/don't/never/always/use/prefer/avoid…).

Output schema:
{ "add": string[], "remove": string[] }

Each string must be a single self-contained sentence in third person
about the user (e.g. "User is based in Belgrade and prefers TypeScript
strict mode."). If nothing in the conversation qualifies, output null.

Every string ≤ 500 chars. No newlines inside a string.`;

/** Max characters of transcript to feed the consolidator (~3K tokens). */
export const MAX_TRANSCRIPT_CHARS = 12_000;

/** Model alias used for the consolidator. Public so tests can stub it. */
export const CONSOLIDATOR_MODEL = "claude-haiku-4-5";

interface JsonlMessage {
  type?: string;
  message?: {
    role?: string;
    content?: string | Array<{ type?: string; text?: string }>;
  };
}

/**
 * Parse the SDK's persisted JSONL transcript into a plain-text
 * USER/ASSISTANT script suitable for feeding to the consolidator. Drops
 * tool calls, system messages, and anything we can't confidently render
 * as conversational text. Tail-trims to `maxChars` so old context is
 * shed before recent context.
 */
export function summarizeTranscript(
  jsonlContent: string,
  maxChars: number = MAX_TRANSCRIPT_CHARS,
): string {
  const turns: string[] = [];
  for (const line of jsonlContent.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let obj: JsonlMessage;
    try {
      obj = JSON.parse(line) as JsonlMessage;
    } catch {
      continue;
    }
    const role = obj.type;
    const content = obj.message?.content;
    if (role === "user") {
      const text = typeof content === "string" ? content : extractTextBlocks(content);
      if (text) turns.push(`USER: ${text}`);
    } else if (role === "assistant") {
      const text = typeof content === "string" ? content : extractTextBlocks(content);
      if (text) turns.push(`ASSISTANT: ${text}`);
    }
    // Other roles (tool_result, system, etc.) intentionally dropped.
  }
  let combined = turns.join("\n\n");
  if (combined.length > maxChars) {
    combined = combined.slice(combined.length - maxChars);
    // Realign to a turn boundary so the consolidator sees whole turns.
    const m = combined.search(/^(USER|ASSISTANT):/m);
    if (m > 0) combined = combined.slice(m);
  }
  return combined;
}

function extractTextBlocks(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const out: string[] = [];
  for (const block of content) {
    if (
      block &&
      typeof block === "object" &&
      (block as { type?: unknown }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string"
    ) {
      const text = (block as { text: string }).text.trim();
      if (text) out.push(text);
    }
  }
  return out.join("\n");
}

/**
 * Parse the consolidator's response into a typed diff. Tolerant of
 * markdown code fences and whitespace, since Haiku occasionally wraps
 * JSON in ```json blocks despite the system prompt asking it not to.
 */
export function parseConsolidatorResponse(text: string): AutoMemoryDiff | null {
  const cleaned = text
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  if (!cleaned || cleaned.toLowerCase() === "null") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (parsed === null) return null;
  if (typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  const add = Array.isArray(obj.add)
    ? obj.add.filter((s): s is string => typeof s === "string")
    : [];
  const remove = Array.isArray(obj.remove)
    ? obj.remove.filter((s): s is string => typeof s === "string")
    : [];
  if (add.length === 0 && remove.length === 0) return null;
  return { add, remove };
}

/**
 * Pluggable LLM call. The default implementation hits Haiku via the
 * Agent SDK's `query()` in one-shot mode. Tests substitute a stub via
 * `setConsolidatorLlm()`.
 */
export type ConsolidatorLlm = (systemPrompt: string, userMessage: string) => Promise<string>;

let llmImpl: ConsolidatorLlm = defaultLlm;

export function setConsolidatorLlm(impl: ConsolidatorLlm): void {
  llmImpl = impl;
}

export function resetConsolidatorLlm(): void {
  llmImpl = defaultLlm;
}

async function defaultLlm(systemPrompt: string, userMessage: string): Promise<string> {
  // One-shot, non-agentic. Auth piggybacks on the existing Claude CLI
  // credentials at ~/.claude/.credentials.json so we don't need a
  // separate ANTHROPIC_API_KEY.
  //
  // Pinned cwd (instead of tmpdir()) so the SDK's per-cwd projects
  // directory is deterministic — we can find and delete the stub
  // session file the SDK writes regardless of `persistSession: false`.
  await ensureConsolidatorCwd();
  const stream = query({
    prompt: userMessage,
    options: {
      model: CONSOLIDATOR_MODEL,
      systemPrompt,
      tools: [],
      settingSources: [],
      maxTurns: 1,
      cwd: consolidatorCwd(),
      // Best-effort suppression. The SDK still creates an empty stub
      // file in some cases, so the post-run cleanup below is the real
      // guarantee.
      persistSession: false,
    } as Parameters<typeof query>[0]["options"],
  });

  let text = "";
  try {
    for await (const msg of stream) {
      const m = msg as Record<string, unknown>;
      if (m.type !== "assistant") continue;
      const message = m.message as { content?: unknown } | undefined;
      if (!Array.isArray(message?.content)) continue;
      for (const block of message.content as Array<{ type?: string; text?: string }>) {
        if (block.type === "text" && typeof block.text === "string") {
          text += block.text;
        }
      }
    }
  } finally {
    // Whatever happened, scrub the consolidator's stub project dir so
    // it doesn't appear in the chat sidebar. The SDK sometimes creates
    // a stub JSONL before honoring `persistSession`, and may also drop
    // sidecar artifacts. Removing the whole directory is safe — nothing
    // else writes here. Belt-and-braces alongside the session-listing
    // filter in `/api/sessions*`.
    await rm(consolidatorClaudeProjectsDir(), { recursive: true, force: true }).catch(() => {});
  }
  return text;
}

export interface ConsolidationOutcome {
  ran: boolean;
  added: number;
  removed: number;
  rejected: number;
  trimmed: boolean;
  error?: string;
  /** Resulting total bytes of auto.md after the diff. */
  totalBytes: number;
}

/**
 * Run one consolidation pass for the given transcript file. Idempotent
 * surface: never throws — a failure becomes `{ran: true, error}` so
 * callers can audit-log and move on without crashing the chat.
 */
export async function runConsolidator(transcriptPath: string): Promise<ConsolidationOutcome> {
  const config = await loadAutoMemoryConfig();
  if (!config.enabled) {
    return { ran: false, added: 0, removed: 0, rejected: 0, trimmed: false, totalBytes: 0 };
  }

  let transcript: string;
  try {
    if (!existsSync(transcriptPath)) {
      return {
        ran: false,
        added: 0,
        removed: 0,
        rejected: 0,
        trimmed: false,
        totalBytes: 0,
        error: "transcript-missing",
      };
    }
    transcript = await readFile(transcriptPath, "utf-8");
  } catch (err) {
    return {
      ran: false,
      added: 0,
      removed: 0,
      rejected: 0,
      trimmed: false,
      totalBytes: 0,
      error: err instanceof Error ? err.message : "transcript-read-failed",
    };
  }

  const summary = summarizeTranscript(transcript);
  if (summary.trim().length === 0) {
    return { ran: false, added: 0, removed: 0, rejected: 0, trimmed: false, totalBytes: 0 };
  }

  const existing = await readAutoMemory();
  const userMessage = [
    `EXISTING_MEMORY:`,
    existing.facts.length ? existing.facts.map((f) => `- ${f}`).join("\n") : "(none)",
    "",
    `CONVERSATION:`,
    summary,
  ].join("\n");

  let raw: string;
  try {
    raw = await llmImpl(CONSOLIDATOR_SYSTEM_PROMPT, userMessage);
  } catch (err) {
    return {
      ran: true,
      added: 0,
      removed: 0,
      rejected: 0,
      trimmed: false,
      totalBytes: existing.size,
      error: err instanceof Error ? err.message : "llm-failed",
    };
  }

  const diff = parseConsolidatorResponse(raw);
  if (!diff) {
    await updateAutoMemoryConfig({ lastConsolidatedAt: Date.now() });
    return {
      ran: true,
      added: 0,
      removed: 0,
      rejected: 0,
      trimmed: false,
      totalBytes: existing.size,
    };
  }

  const result = applyDiff(existing.facts, diff);
  if (result.added === 0 && result.removed === 0) {
    await updateAutoMemoryConfig({ lastConsolidatedAt: Date.now() });
    return {
      ran: true,
      added: 0,
      removed: 0,
      rejected: result.rejected.length,
      trimmed: result.trimmed,
      totalBytes: existing.size,
    };
  }

  await writeAutoMemory(result.facts);
  await updateAutoMemoryConfig({ lastConsolidatedAt: Date.now() });
  const after = await readAutoMemory();
  return {
    ran: true,
    added: result.added,
    removed: result.removed,
    rejected: result.rejected.length,
    trimmed: result.trimmed,
    totalBytes: after.size,
  };
}

/**
 * Per-session debounce wrapper. Each call resets the per-session timer.
 * Fires once after the configured idle window with no further activity.
 * Concurrent runs for the same session are coalesced.
 */
export class ConsolidationScheduler {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private inFlight = new Set<string>();

  constructor(
    private readonly runner: (
      transcriptPath: string,
    ) => Promise<ConsolidationOutcome> = runConsolidator,
  ) {}

  schedule(sessionId: string, transcriptPath: string, idleMs: number): void {
    const existing = this.timers.get(sessionId);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      this.timers.delete(sessionId);
      if (this.inFlight.has(sessionId)) return;
      this.inFlight.add(sessionId);
      this.runner(transcriptPath)
        .catch(() => {
          /* runner already swallows errors; defensive */
        })
        .finally(() => this.inFlight.delete(sessionId));
    }, idleMs);
    this.timers.set(sessionId, t);
  }

  cancel(sessionId: string): void {
    const existing = this.timers.get(sessionId);
    if (existing) clearTimeout(existing);
    this.timers.delete(sessionId);
  }

  cancelAll(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  /** Test helper. */
  pending(): number {
    return this.timers.size;
  }
}
