import { existsSync } from "fs";
import { join } from "path";

import { listRules, loadSystemPromptAppend, readRule } from "../agent-config";

import { ensureMemoryTree, globalMemoryDir } from "./paths";
import { writeMemoryFile } from "./store";

/**
 * One-shot migration of legacy "Agent behavior" content into the global
 * memory tree. Both stores are appended into the system prompt every
 * turn, so the model behaviour is unchanged — this just consolidates
 * the storage and the UI surface.
 *
 *   <CLAUDE_CWD>/.claude/custom-system-prompt.md
 *     → /root/.memory/global/instructions.md
 *
 *   <CLAUDE_CWD>/.claude/rules/<name>.md
 *     → /root/.memory/global/rules/<name>.md
 *
 * Idempotent: only copies when the destination doesn't already exist.
 * Never deletes the originals — a downgrade keeps working, and the
 * legacy `/api/agent-config/*` routes can read them through one
 * deprecation window. Each call returns counts so the caller can log
 * a one-line summary at boot.
 */

export interface MigrationSummary {
  instructionsCopied: boolean;
  rulesCopied: number;
  rulesSkipped: number;
  errors: string[];
}

const INSTRUCTIONS_DEST = "instructions.md";

export async function migrateAgentConfigToMemory(): Promise<MigrationSummary> {
  const summary: MigrationSummary = {
    instructionsCopied: false,
    rulesCopied: 0,
    rulesSkipped: 0,
    errors: [],
  };

  await ensureMemoryTree();
  const dest = globalMemoryDir();

  // System prompt → instructions.md
  try {
    if (!existsSync(join(dest, INSTRUCTIONS_DEST))) {
      const { prompt } = await loadSystemPromptAppend();
      if (prompt.trim().length > 0) {
        await writeMemoryFile(dest, INSTRUCTIONS_DEST, prompt);
        summary.instructionsCopied = true;
      }
    }
  } catch (err) {
    summary.errors.push(`instructions: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Rules → rules/<name>.md
  try {
    const rules = await listRules();
    for (const rule of rules) {
      const relPath = `rules/${rule.name}.md`;
      if (existsSync(join(dest, relPath))) {
        summary.rulesSkipped += 1;
        continue;
      }
      try {
        const { content } = await readRule(rule.name);
        await writeMemoryFile(dest, relPath, content);
        summary.rulesCopied += 1;
      } catch (err) {
        summary.errors.push(
          `rule ${rule.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  } catch (err) {
    summary.errors.push(`rules listing: ${err instanceof Error ? err.message : String(err)}`);
  }

  return summary;
}
