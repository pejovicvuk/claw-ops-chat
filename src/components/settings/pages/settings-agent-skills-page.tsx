"use client";

import { MarkdownFileEditor } from "../markdown-file-editor";

const TEMPLATE = `---
name: my-skill
description: One-line description of when Claude should use this skill
---

# My skill

Step-by-step instructions Claude can follow when this skill is invoked.
`;

export function SettingsAgentSkillsPage() {
  return (
    <div className="space-y-4">
      <MarkdownFileEditor
        singular="Skill"
        plural="Skills"
        endpoint="skills"
        emptyHelp="Skills are reusable task recipes Claude can invoke by name. Each skill lives in its own folder with a SKILL.md file containing frontmatter + instructions."
        newTemplate={TEMPLATE}
      />
      <p className="px-1 text-[10px] leading-relaxed text-canvas-muted">
        Saved to{" "}
        <code className="rounded bg-canvas-surface px-1 py-0.5">
          $CLAUDE_CWD/.claude/skills/&lt;name&gt;/SKILL.md
        </code>
        . Loaded by the Claude Agent SDK on the next turn.
      </p>
    </div>
  );
}
