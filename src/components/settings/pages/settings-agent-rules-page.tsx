"use client";

import { MarkdownFileEditor } from "../markdown-file-editor";

const TEMPLATE = `# Rule

Write guidance for Claude here. Each rule is concatenated into the system
prompt on every turn, so keep it short and actionable.
`;

export function SettingsAgentRulesPage() {
  return (
    <div className="space-y-4">
      <MarkdownFileEditor
        singular="Rule"
        plural="Rules"
        endpoint="rules"
        emptyHelp="Rules are short markdown notes that Claude sees on every turn. Use them for tone, formatting preferences, or things Claude should never do."
        newTemplate={TEMPLATE}
      />
      <p className="px-1 text-[10px] leading-relaxed text-canvas-muted">
        Saved to{" "}
        <code className="rounded bg-canvas-surface px-1 py-0.5">$CLAUDE_CWD/.claude/rules/</code>.
        Appended to the system prompt on the next turn — no restart needed.
      </p>
    </div>
  );
}
