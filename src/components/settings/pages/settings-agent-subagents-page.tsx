"use client";

import { MarkdownFileEditor } from "../markdown-file-editor";

const TEMPLATE = `---
name: my-agent
description: When Claude should delegate to this subagent
tools:
  - Read
  - Grep
  - Glob
---

# My subagent

Instructions the subagent follows when invoked via the Task tool.
`;

export function SettingsAgentSubagentsPage() {
  return (
    <div className="space-y-4">
      <MarkdownFileEditor
        singular="Subagent"
        plural="Subagents"
        endpoint="subagents"
        emptyHelp="Subagents are specialized helpers Claude can delegate to via the Task tool. Each has its own system prompt and tool allowlist."
        newTemplate={TEMPLATE}
      />
      <p className="px-1 text-[10px] leading-relaxed text-canvas-muted">
        Saved to{" "}
        <code className="rounded bg-canvas-surface px-1 py-0.5">$CLAUDE_CWD/.claude/agents/</code>.
        Loaded by the Claude Agent SDK on the next turn.
      </p>
    </div>
  );
}
