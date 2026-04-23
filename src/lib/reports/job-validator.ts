import cron from "node-cron";
import type { ReportJob } from "./types";
import { BUILTIN_TOOLS, HUMAN_REQUIRED_TOOLS, loadToolCatalog } from "./tool-catalog";

/**
 * Validate a ReportJob before persistence. Returns a flat list of errors —
 * one per problem field — so the editor UI can surface them inline.
 *
 * Rules enforced:
 *  - `id`/`slug`: lowercase alphanumeric + hyphen, 1-64 chars.
 *  - `schedule`: parseable by node-cron, not sub-minute, not `@`-prefixed.
 *  - `timezone`: non-empty (IANA names aren't cheaply validatable in Node
 *    without a lookup table; we defer to cron-parser at run time).
 *  - `maxTurns`, `maxDurationSec`: positive, within safety bounds.
 *  - `allowedTools`: every name either in BUILTIN_TOOLS or a known MCP wildcard.
 *  - `allowedBashPrefixes`: each ≤200 chars (prevents accidental DoS).
 *  - `allowedMcpServers`: each exists in ~/.claude.json.
 *  - Human-required tools (AskUserQuestion, ExitPlanMode) rejected — autonomous
 *    runs have nobody to answer.
 */

export interface ValidationError {
  field: string;
  message: string;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Minimum allowed interval between fires (seconds). Below this = DoS risk. */
const MIN_INTERVAL_SECONDS = 60;

export function validateJob(job: ReportJob): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!job.id || !SLUG_RE.test(job.id)) {
    errors.push({
      field: "id",
      message:
        "id must be 1-64 chars, lowercase alphanumeric + hyphen, starting with a letter/digit",
    });
  }
  if (job.slug !== job.id) {
    errors.push({ field: "slug", message: "slug must equal id" });
  }
  if (!job.name || !job.name.trim()) {
    errors.push({ field: "name", message: "name is required" });
  }

  const scheduleErr = validateCronExpression(job.schedule);
  if (scheduleErr) errors.push({ field: "schedule", message: scheduleErr });

  if (!job.timezone || !job.timezone.trim()) {
    errors.push({
      field: "timezone",
      message: "timezone is required (use an IANA name like 'UTC')",
    });
  }

  if (!Number.isFinite(job.maxTurns) || job.maxTurns < 1 || job.maxTurns > 500) {
    errors.push({ field: "maxTurns", message: "maxTurns must be between 1 and 500" });
  }
  if (
    !Number.isFinite(job.maxDurationSec) ||
    job.maxDurationSec < 30 ||
    job.maxDurationSec > 24 * 60 * 60
  ) {
    errors.push({
      field: "maxDurationSec",
      message: "maxDurationSec must be between 30 and 86400",
    });
  }

  if (!Array.isArray(job.allowedTools)) {
    errors.push({ field: "allowedTools", message: "allowedTools must be an array" });
  } else {
    const catalog = loadToolCatalog();
    const knownMcpPrefixes = new Set(catalog.mcpServers.map((s) => `mcp__${s.name}__`));
    const knownBuiltins = new Set(BUILTIN_TOOLS as readonly string[]);
    for (const tool of job.allowedTools) {
      if (HUMAN_REQUIRED_TOOLS.has(tool)) {
        errors.push({
          field: "allowedTools",
          message: `${tool} cannot be granted to a cron run (nobody is there to answer)`,
        });
        continue;
      }
      if (knownBuiltins.has(tool)) continue;
      // MCP wildcard like mcp__google-workspace-custom__*
      if (tool.endsWith("*") && tool.startsWith("mcp__")) {
        const prefix = tool.slice(0, -1);
        if ([...knownMcpPrefixes].some((known) => known === prefix)) continue;
        errors.push({
          field: "allowedTools",
          message: `Unknown MCP server in wildcard '${tool}'`,
        });
        continue;
      }
      errors.push({
        field: "allowedTools",
        message: `Unknown tool '${tool}' — must be a built-in or mcp__<server>__* wildcard`,
      });
    }
  }

  if (!Array.isArray(job.allowedBashPrefixes)) {
    errors.push({
      field: "allowedBashPrefixes",
      message: "allowedBashPrefixes must be an array",
    });
  } else {
    for (const prefix of job.allowedBashPrefixes) {
      if (typeof prefix !== "string" || prefix.length === 0) {
        errors.push({
          field: "allowedBashPrefixes",
          message: "each allowedBashPrefix must be a non-empty string",
        });
      } else if (prefix.length > 200) {
        errors.push({
          field: "allowedBashPrefixes",
          message: "allowedBashPrefix entries must be ≤200 characters",
        });
      }
    }
  }

  if (!Array.isArray(job.allowedMcpServers)) {
    errors.push({
      field: "allowedMcpServers",
      message: "allowedMcpServers must be an array",
    });
  } else {
    const catalog = loadToolCatalog();
    const knownNames = new Set(catalog.mcpServers.map((s) => s.name));
    for (const name of job.allowedMcpServers) {
      if (!knownNames.has(name)) {
        errors.push({
          field: "allowedMcpServers",
          message: `Unknown MCP server '${name}' — not present in ~/.claude.json`,
        });
      }
    }
  }

  if (!job.outputDir || !job.outputDir.startsWith("/root/reports")) {
    errors.push({
      field: "outputDir",
      message: "outputDir must stay inside /root/reports",
    });
  }
  if (!job.outputFilename || !job.outputFilename.endsWith(".md")) {
    errors.push({
      field: "outputFilename",
      message: "outputFilename must end in .md",
    });
  }

  return errors;
}

/** Validate a cron expression string. Returns null on success or an error message. */
export function validateCronExpression(expr: string): string | null {
  if (!expr || typeof expr !== "string" || !expr.trim()) {
    return "schedule is required";
  }
  if (expr.startsWith("@")) {
    return "Only standard 5-field cron expressions are supported (no @-aliases)";
  }
  if (!cron.validate(expr)) {
    return "Invalid cron expression";
  }
  // Reject sub-minute: the first field is minutes. "* * * * *" fires every
  // minute, which is the tightest allowed schedule.
  const fields = expr.trim().split(/\s+/);
  if (fields.length === 6) {
    return "6-field cron (with seconds) is not allowed — use 5 fields";
  }
  if (fields.length !== 5) {
    return `Cron expression must have 5 fields, got ${fields.length}`;
  }
  // node-cron validates structure; we've already banned 6-field.
  // MIN_INTERVAL_SECONDS is enforced implicitly by requiring 5 fields.
  return null;
}

/** Export for tests so the constant stays in sync. */
export const __INTERNAL = { MIN_INTERVAL_SECONDS, SLUG_RE };
