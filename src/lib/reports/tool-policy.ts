import { HUMAN_REQUIRED_TOOLS, isToolAllowed } from "./tool-catalog";

/**
 * Tool-use policy factory. The server's canUseTool callback is now one
 * function whose logic branches on policy kind:
 *
 *   - "interactive": today's behaviour. Delegates to a caller-supplied
 *     handler so we don't duplicate the ~100-line interactive logic here.
 *   - "cron": autonomous allowlist. Used by the reports runner. Never
 *     blocks waiting for a human; denies unknown tools; counts turns.
 */

export type ToolPolicy =
  | { kind: "interactive" }
  | {
      kind: "cron";
      allowed: string[];
      allowedBashPrefixes: string[];
      /** Mutated by this module — caller wraps in an object so the branch can decrement. */
      turnBudget: { remaining: number };
      /** Tools the agent tried but was denied; appended for later run-log reporting. */
      denials: string[];
    };

export interface CronDecision {
  behavior: "allow" | "deny";
  message?: string;
  updatedInput?: Record<string, unknown>;
}

/**
 * Pure decision function for cron policies. Separated from the server's
 * canUseTool so it's trivial to unit-test without mocking the SDK.
 */
export function decideCronTool(
  policy: Extract<ToolPolicy, { kind: "cron" }>,
  toolName: string,
  input: Record<string, unknown>,
): CronDecision {
  if (HUMAN_REQUIRED_TOOLS.has(toolName)) {
    policy.denials.push(toolName);
    return {
      behavior: "deny",
      message: `${toolName} is disabled in autonomous runs — no human is watching`,
    };
  }

  if (policy.turnBudget.remaining <= 0) {
    policy.denials.push(toolName);
    return { behavior: "deny", message: "Max turns reached for this run" };
  }

  if (toolName === "Bash") {
    const cmd = typeof input.command === "string" ? input.command : "";
    if (!cmd) {
      policy.denials.push("Bash(empty)");
      return { behavior: "deny", message: "Empty Bash command" };
    }
    const allowedByPrefix = policy.allowedBashPrefixes.some((p) => cmd.startsWith(p));
    if (!allowedByPrefix) {
      policy.denials.push(`Bash(${cmd.slice(0, 50)})`);
      return {
        behavior: "deny",
        message: "Bash command is not in the job's allowedBashPrefixes",
      };
    }
  }

  if (!isToolAllowed(toolName, policy.allowed)) {
    policy.denials.push(toolName);
    return {
      behavior: "deny",
      message: `Tool ${toolName} is not in this run's allowedTools`,
    };
  }

  policy.turnBudget.remaining -= 1;
  return { behavior: "allow", updatedInput: input };
}
