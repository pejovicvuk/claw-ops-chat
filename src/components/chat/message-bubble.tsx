"use client";

import { lazy, memo, Suspense, useState } from "react";
import {
  FiTerminal,
  FiFile,
  FiEdit,
  FiChevronDown,
  FiChevronRight,
  FiCheck,
  FiX,
} from "react-icons/fi";
import type { ChatMessage } from "@/lib/types";

// Lazy: react-markdown + remark-gfm (~33kb gz) are deferred out of the main
// chunk. `preloadMarkdown` warms the chunk as soon as the user submits.
const MarkdownRenderer = lazy(() => import("./markdown-renderer"));
export function preloadMarkdown() {
  void import("./markdown-renderer");
}

function MarkdownFallback({ text }: { text: string }) {
  return (
    <pre className="whitespace-pre-wrap text-[14px] leading-relaxed text-canvas-fg">{text}</pre>
  );
}

/* ── Tool display mapping ── */

const TOOL_DISPLAY: Record<string, { icon: typeof FiTerminal; label: string }> = {
  Bash: { icon: FiTerminal, label: "Running command" },
  Read: { icon: FiFile, label: "Reading file" },
  Write: { icon: FiEdit, label: "Writing file" },
  Edit: { icon: FiEdit, label: "Editing file" },
  Glob: { icon: FiFile, label: "Searching files" },
  Grep: { icon: FiFile, label: "Searching content" },
  WebSearch: { icon: FiFile, label: "Searching web" },
  WebFetch: { icon: FiFile, label: "Fetching page" },
};

function getToolDisplay(name?: string) {
  if (!name) return { icon: FiTerminal, label: "Using tool" };
  return TOOL_DISPLAY[name] ?? { icon: FiTerminal, label: `Using ${name}` };
}

function extractToolDescription(toolName?: string, toolInput?: string): string {
  if (!toolInput) return "";
  try {
    const parsed = JSON.parse(toolInput);
    if (toolName === "Bash" && parsed.command) return parsed.command.slice(0, 80);
    if ((toolName === "Read" || toolName === "Write" || toolName === "Edit") && parsed.file_path)
      return parsed.file_path;
    if (toolName === "Grep" && parsed.pattern) return parsed.pattern;
    if (toolName === "Glob" && parsed.pattern) return parsed.pattern;
    return "";
  } catch {
    return "";
  }
}

/* ── Detect Unicode box-drawing content ── */
const BOX_CHARS = /[┌┐└┘├┤┬┴┼─│═║╔╗╚╝╠╣╦╩╬]/;

function hasBoxDrawing(text: string): boolean {
  return BOX_CHARS.test(text);
}

/* ── Component ── */

interface MessageBubbleProps {
  message: ChatMessage;
  isLatestToolUse?: boolean;
  onPermissionRespond?: (
    id: string,
    allow: boolean,
    allowSession?: boolean,
    message?: string,
  ) => void;
  onQuestionRespond?: (id: string, answers: Record<string, string | string[]>) => void;
  onPlanRespond?: (
    id: string,
    approve: boolean,
    opts?: { newMode?: "default" | "acceptEdits"; message?: string },
  ) => void;
}

export const MessageBubble = memo(function MessageBubble({
  message,
  isLatestToolUse,
  onPermissionRespond,
  onQuestionRespond,
  onPlanRespond,
}: MessageBubbleProps) {
  if (message.type === "error") {
    return (
      <div className="flex justify-center px-4 py-1.5">
        <span className="rounded-md bg-red-500/10 px-3 py-1.5 text-[12px] text-red-400">
          {message.content}
        </span>
      </div>
    );
  }

  if (message.role === "user") {
    return (
      <div className="flex justify-end px-4 py-1.5">
        <div
          className="max-w-[85%] rounded-2xl rounded-br-md px-3.5 py-2.5"
          style={{ backgroundColor: "var(--user-bubble)" }}
        >
          <p
            className="whitespace-pre-wrap text-[14px] leading-relaxed"
            style={{ color: "var(--user-bubble-fg)" }}
          >
            {message.content}
          </p>
        </div>
      </div>
    );
  }

  /* Tool use — only show the latest one (live activity indicator) */
  if (message.type === "tool_use") {
    if (!isLatestToolUse) return null;
    return <ToolUseIndicator message={message} />;
  }
  /* Tool results — only show errors */
  if (message.type === "tool_result") {
    if (!(message.isError ?? false)) return null;
    return <ToolResultBlock message={message} />;
  }
  if (message.type === "thinking") return <ThinkingBlock message={message} />;
  if (message.type === "permission_request")
    return <PermissionRequestBlock message={message} onRespond={onPermissionRespond} />;
  if (message.type === "plan_proposal")
    return <PlanProposalBlock message={message} onRespond={onPlanRespond} />;
  if (message.type === "ask_question")
    return <AskQuestionBlock message={message} onRespond={onQuestionRespond} />;

  return (
    <div className="flex justify-start px-4 py-1.5">
      <div className="min-w-0 max-w-[90%]">
        {message.content ? (
          <AssistantTextContent content={message.content} />
        ) : (
          <span className="inline-block h-4 w-0.5 animate-pulse bg-gray-400" />
        )}
      </div>
    </div>
  );
});

function AssistantTextContent({ content }: { content: string }) {
  const text = typeof content === "string" ? content : String(content ?? "");
  if (!hasBoxDrawing(text)) {
    return (
      <Suspense fallback={<MarkdownFallback text={text} />}>
        <MarkdownRenderer text={text} />
      </Suspense>
    );
  }

  const lines = text.split("\n");
  const segments: Array<{ type: "text" | "box"; content: string }> = [];
  let current: { type: "text" | "box"; lines: string[] } | null = null;

  for (const line of lines) {
    const isBox = BOX_CHARS.test(line);
    const type = isBox ? "box" : "text";
    if (!current || current.type !== type) {
      if (current) segments.push({ type: current.type, content: current.lines.join("\n") });
      current = { type, lines: [line] };
    } else {
      current.lines.push(line);
    }
  }
  if (current) segments.push({ type: current.type, content: current.lines.join("\n") });

  return (
    <>
      {segments.map((seg, i) =>
        seg.type === "box" ? (
          <div
            key={i}
            className="my-2 overflow-x-auto rounded-md border border-canvas-border bg-canvas-bg p-3"
          >
            <pre className="whitespace-pre font-mono text-[11px] leading-relaxed text-canvas-fg">
              {seg.content}
            </pre>
          </div>
        ) : (
          <Suspense key={i} fallback={<MarkdownFallback text={seg.content} />}>
            <MarkdownRenderer text={seg.content} />
          </Suspense>
        ),
      )}
    </>
  );
}

function ToolUseIndicator({ message }: { message: ChatMessage }) {
  const { icon: Icon, label } = getToolDisplay(message.toolName);
  const desc = extractToolDescription(message.toolName, message.toolInput);

  return (
    <div className="px-4 py-0.5">
      <div className="flex items-center gap-1.5 px-1 text-[11px] text-canvas-muted">
        <Icon size={11} className="shrink-0 opacity-60" style={{ color: "var(--accent)" }} />
        <span className="opacity-70" style={{ color: "var(--accent)" }}>
          {label}
        </span>
        {desc && (
          <span className="line-clamp-1 min-w-0 flex-1 font-mono text-[10px] opacity-50">
            {desc}
          </span>
        )}
      </div>
    </div>
  );
}

function ToolResultBlock({ message }: { message: ChatMessage }) {
  const [collapsed, setCollapsed] = useState(true);
  const isError = message.isError ?? false;

  if (!isError && !message.content.trim()) return null;

  if (isError) {
    return (
      <div className="px-4 py-0.5">
        <div className="flex items-center gap-1.5 rounded-md border-l-2 border-red-500/50 bg-red-500/5 px-2 py-1.5">
          <FiX size={10} className="shrink-0 text-red-400" />
          <span className="line-clamp-2 text-[11px] text-red-400">
            {message.content.slice(0, 200)}
          </span>
        </div>
      </div>
    );
  }

  const lineCount = message.content.split("\n").length;
  return (
    <div className="px-4 py-0">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex items-center gap-1 px-1 py-0.5 text-[10px] text-canvas-muted/50 hover:text-canvas-muted"
      >
        {collapsed ? <FiChevronRight size={9} /> : <FiChevronDown size={9} />}
        <span>
          output ({lineCount} {lineCount === 1 ? "line" : "lines"})
        </span>
      </button>
      {!collapsed && (
        <pre className="ml-2 max-h-[200px] overflow-y-auto rounded bg-canvas-bg/50 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-canvas-muted">
          {message.content.slice(0, 2000)}
        </pre>
      )}
    </div>
  );
}

function ThinkingBlock({ message }: { message: ChatMessage }) {
  const [collapsed, setCollapsed] = useState(false);

  if (!message.content) return null;

  return (
    <div className="px-4 py-1">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-left hover:bg-canvas-surface-hover"
      >
        {collapsed ? (
          <FiChevronRight size={10} className="shrink-0 text-accent/60" />
        ) : (
          <FiChevronDown size={10} className="shrink-0 text-accent/60" />
        )}
        <span className="text-[11px] text-canvas-muted">Thinking...</span>
      </button>
      {!collapsed && (
        <div className="ml-2 max-h-[300px] overflow-y-auto rounded-md border-l-2 border-accent/30 bg-canvas-surface-hover/50 px-3 py-2">
          <p className="whitespace-pre-wrap text-[11px] italic leading-relaxed text-canvas-muted">
            {message.content}
          </p>
        </div>
      )}
    </div>
  );
}

function PermissionRequestBlock({
  message,
}: {
  message: ChatMessage;
  onRespond?: (id: string, allow: boolean, allowSession?: boolean, message?: string) => void;
}) {
  const resolved = message.permissionResolved;
  const allowed = message.permissionAllowed;
  const toolName = message.toolName ?? "Tool";

  if (!resolved) return null;

  return (
    <div className="px-4 py-0.5">
      <div
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
          allowed ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"
        }`}
      >
        {allowed ? <FiCheck size={10} /> : <FiX size={10} />}
        {allowed ? "Allowed" : "Denied"}: {toolName}
      </div>
      {!allowed && message.permissionMessage && (
        <p className="mt-1 pl-4 text-[11px] italic text-red-400/80">
          &ldquo;{message.permissionMessage}&rdquo;
        </p>
      )}
    </div>
  );
}

/**
 * Plan-proposal card. Renders when Claude calls ExitPlanMode in plan
 * mode. Shows the plan as markdown + three actions: approve & keep
 * auto-approving edits (default — matches what most users want right
 * after they OK a plan), approve but keep confirming each edit, or
 * reject with an optional reason. Falls back to a resolved badge once
 * the user has chosen.
 */
function PlanProposalBlock({
  message,
  onRespond,
}: {
  message: ChatMessage;
  onRespond?: (
    id: string,
    approve: boolean,
    opts?: { newMode?: "default" | "acceptEdits"; message?: string },
  ) => void;
}) {
  const [showReject, setShowReject] = useState(false);
  const [rejectText, setRejectText] = useState("");
  const resolved = !!message.planResolved;
  const outcome = message.planOutcome;

  const handleApprove = (newMode: "default" | "acceptEdits") => {
    if (resolved) return;
    onRespond?.(message.planId ?? "", true, { newMode });
  };
  const handleReject = () => {
    if (resolved) return;
    onRespond?.(message.planId ?? "", false, { message: rejectText.trim() || undefined });
  };

  return (
    <div className="px-4 py-1.5">
      <div className="rounded-lg border border-accent/30 bg-canvas-surface-hover px-3.5 py-3">
        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-accent">
          <FiCheck size={11} />
          <span>Plan ready for review</span>
        </div>

        <div className="rounded-md border border-canvas-border bg-canvas-bg px-3 py-2">
          <Suspense fallback={<MarkdownFallback text={message.planContent || "*(empty plan)*"} />}>
            <MarkdownRenderer text={message.planContent || "*(empty plan)*"} />
          </Suspense>
        </div>

        {resolved ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
            {outcome === "approved_accept_edits" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2.5 py-1 font-medium text-green-400">
                <FiCheck size={10} /> Approved — auto-approving edits
              </span>
            )}
            {outcome === "approved_default" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2.5 py-1 font-medium text-green-400">
                <FiCheck size={10} /> Approved — confirm each step
              </span>
            )}
            {outcome === "rejected" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2.5 py-1 font-medium text-red-400">
                <FiX size={10} /> Rejected
              </span>
            )}
            {outcome === "rejected" && message.planMessage && (
              <p className="w-full pl-1 text-[11px] italic text-red-400/80">
                &ldquo;{message.planMessage}&rdquo;
              </p>
            )}
          </div>
        ) : showReject ? (
          <div className="mt-3">
            <textarea
              value={rejectText}
              onChange={(e) => setRejectText(e.target.value)}
              placeholder="Tell Claude what to change about the plan (optional)"
              rows={3}
              className="w-full rounded-md border border-canvas-border bg-canvas-bg px-2.5 py-1.5 text-[12px] text-canvas-fg placeholder:text-canvas-muted/60 focus:border-accent focus:outline-none"
              autoFocus
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={handleReject}
                className="rounded-md bg-red-500/90 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-red-500"
              >
                Send rejection
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowReject(false);
                  setRejectText("");
                }}
                className="rounded-md px-3 py-1.5 text-[12px] text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => handleApprove("acceptEdits")}
              className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-white active:opacity-80"
            >
              Approve &amp; auto-apply
            </button>
            <button
              type="button"
              onClick={() => handleApprove("default")}
              className="rounded-md border border-canvas-border px-3 py-1.5 text-[12px] font-medium text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
              title="Approve the plan, but keep asking before each edit or command"
            >
              Approve &amp; confirm each step
            </button>
            <button
              type="button"
              onClick={() => setShowReject(true)}
              className="rounded-md px-3 py-1.5 text-[12px] font-medium text-red-400 hover:bg-red-500/10"
            >
              Reject
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Per-question answer shape:
 *   single-select → string (label of chosen option)
 *   multi-select  → string[] (labels of chosen options)
 *   custom text   → prefix "Other: " + user text (single-select) OR array
 *                   containing "Other: <text>" entries (multi-select)
 */
type AnswerValue = string | string[];

const OTHER_LABEL = "Other";

function AskQuestionBlock({
  message,
  onRespond,
}: {
  message: ChatMessage;
  onRespond?: (id: string, answers: Record<string, AnswerValue>) => void;
}) {
  const questions = message.askQuestions ?? [];
  const resolved = message.askResolved;

  // Keyed by question text. Each entry is a Set of selected option labels
  // (covers single- and multi-select uniformly — the submit handler
  // unwraps a single-element set back to a string).
  const [selections, setSelections] = useState<Record<string, Set<string>>>({});
  const [customTexts, setCustomTexts] = useState<Record<string, string>>({});

  const toggle = (q: string, label: string, multi: boolean) => {
    setSelections((prev) => {
      const next = { ...prev };
      const current = new Set(next[q] ?? []);
      if (multi) {
        if (current.has(label)) current.delete(label);
        else current.add(label);
      } else {
        current.clear();
        current.add(label);
      }
      next[q] = current;
      return next;
    });
  };

  const isComplete = questions.every((q) => {
    const selected = selections[q.question];
    if (!selected || selected.size === 0) return false;
    // If "Other" is picked, require non-empty custom text.
    if (selected.has(OTHER_LABEL) && !(customTexts[q.question] ?? "").trim()) return false;
    return true;
  });

  const handleSubmit = () => {
    if (!isComplete) return;
    const answers: Record<string, AnswerValue> = {};
    for (const q of questions) {
      const picked = Array.from(selections[q.question] ?? []);
      const withCustom = picked.map((label) =>
        label === OTHER_LABEL ? `${OTHER_LABEL}: ${(customTexts[q.question] ?? "").trim()}` : label,
      );
      answers[q.question] = q.multiSelect ? withCustom : withCustom[0];
    }
    onRespond?.(message.askId ?? "", answers);
  };

  if (questions.length === 0) return null;

  return (
    <div className="px-4 py-1.5">
      <div className="rounded-lg border border-accent/30 bg-canvas-surface-hover px-3.5 py-3">
        {questions.map((q) => {
          const selected = selections[q.question] ?? new Set<string>();
          const otherSelected = selected.has(OTHER_LABEL);
          const optionsWithOther = [
            ...q.options,
            // Auto-add "Other" per SDK contract — SDK docs promise every
            // AskUserQuestion option list gets one. We generate locally.
            { label: OTHER_LABEL, description: "Type your own answer", preview: undefined },
          ];
          return (
            <div key={q.question} className="mb-3 last:mb-0">
              {q.header && (
                <span className="mb-1 inline-block rounded bg-canvas-bg px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-canvas-muted">
                  {q.header}
                </span>
              )}
              <p className="mb-2 text-[13px] font-medium text-canvas-fg">{q.question}</p>
              {q.multiSelect && (
                <p className="mb-2 text-[10px] text-canvas-muted">Pick one or more</p>
              )}
              <div className="space-y-1.5">
                {optionsWithOther.map((opt) => {
                  const isSelected = selected.has(opt.label);
                  return (
                    <div key={opt.label}>
                      <button
                        type="button"
                        onClick={() => !resolved && toggle(q.question, opt.label, q.multiSelect)}
                        disabled={!!resolved}
                        className={`flex w-full items-start gap-2 rounded-md border px-3 py-2 text-left transition-colors ${
                          isSelected
                            ? "border-accent bg-accent/10"
                            : "border-canvas-border bg-canvas-bg active:bg-canvas-surface-hover"
                        } ${resolved ? "opacity-60" : ""}`}
                      >
                        {q.multiSelect ? (
                          <div
                            className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border-2 ${
                              isSelected ? "border-accent bg-accent" : "border-gray-600"
                            }`}
                          >
                            {isSelected && <FiCheck size={9} className="text-white" />}
                          </div>
                        ) : (
                          <div
                            className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 ${
                              isSelected ? "border-accent bg-accent" : "border-gray-600"
                            }`}
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-[12px] font-medium text-canvas-fg">{opt.label}</p>
                          {opt.description && (
                            <p className="text-[11px] text-gray-500">{opt.description}</p>
                          )}
                          {opt.preview && (
                            <pre className="mt-1.5 max-h-40 overflow-auto rounded border border-canvas-border bg-canvas-bg px-2 py-1.5 font-mono text-[10px] leading-relaxed text-canvas-muted whitespace-pre">
                              {opt.preview}
                            </pre>
                          )}
                        </div>
                      </button>
                    </div>
                  );
                })}
              </div>
              {otherSelected && !resolved && (
                <textarea
                  value={customTexts[q.question] ?? ""}
                  onChange={(e) =>
                    setCustomTexts((prev) => ({ ...prev, [q.question]: e.target.value }))
                  }
                  placeholder="Type your answer…"
                  rows={2}
                  className="mt-1.5 w-full rounded-md border border-accent/50 bg-canvas-bg px-2.5 py-1.5 text-[12px] text-canvas-fg placeholder:text-canvas-muted/60 focus:border-accent focus:outline-none"
                />
              )}
            </div>
          );
        })}

        {!resolved && isComplete && (
          <button
            type="button"
            onClick={handleSubmit}
            className="mt-2 w-full rounded-xl bg-accent px-3 py-2.5 text-[13px] font-medium text-white active:opacity-80 transition-opacity duration-150"
          >
            Submit
          </button>
        )}

        {resolved && (
          <div className="mt-2 flex items-center gap-2 text-[11px] text-gray-500">
            <FiCheck size={12} />
            <span>Answered</span>
          </div>
        )}
      </div>
    </div>
  );
}
