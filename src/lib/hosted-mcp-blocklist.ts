/**
 * Hard-blocks Anthropic's hosted Gmail / Drive / Calendar MCP connectors so
 * the chat agent never picks them up alongside the user's already-connected
 * `google-workspace-custom` (uvx workspace-mcp) server.
 *
 * The Claude Agent SDK auto-injects these "claude.ai <name>" connectors based
 * on the user's claude.ai subscription state. They surface in `claude mcp list`
 * even when they're not in `~/.claude.json`, and (until a separate Anthropic
 * OAuth handshake completes) every Gmail/Drive/Calendar tool from those
 * servers is stamped "Needs authentication". The model, seeing two same-named
 * MCP servers — one ✓ Connected, one ! Needs auth — sometimes picks the
 * wrong one and replies "Gmail requires you to authenticate first" instead
 * of calling our connected workspace-mcp tools. This blocklist removes them
 * from the model's context entirely so the ambiguity can't arise.
 *
 * Removed via the SDK Options.disallowedTools field (see server.ts queryOptions
 * assembly). Tools are removed from the model's context, never sent.
 *
 * The server-name prefix on Claude Code hosted MCPs is `claude_ai_<Service>`
 * — spaces in the original Claude.ai server name (e.g. "Google Drive") become
 * underscores in the tool prefix.
 */

const BLOCKED_HOSTED_SERVERS = [
  "claude_ai_Gmail",
  "claude_ai_Google_Calendar",
  "claude_ai_Google_Drive",
] as const;

/**
 * Auth-flow tool names exposed by the hosted connectors before OAuth completes.
 * Listed explicitly because the SDK doc for `disallowedTools` says "tool names"
 * (suggesting exact match); the server-prefix entries above cover the broader
 * post-auth tool surface if/when the SDK accepts the shorthand.
 */
const BLOCKED_AUTH_TOOLS_SUFFIXES = ["authenticate", "complete_authentication"] as const;

/**
 * Returns the list of tool-name patterns to feed into Options.disallowedTools.
 * Includes both the server-level prefix (e.g. `mcp__claude_ai_Gmail`) and the
 * explicit auth tool names (e.g. `mcp__claude_ai_Gmail__authenticate`) so the
 * block holds whether the SDK matches by prefix or by exact name.
 */
export function getDisallowedHostedGoogleMcpTools(): string[] {
  const out: string[] = [];
  for (const server of BLOCKED_HOSTED_SERVERS) {
    out.push(`mcp__${server}`);
    for (const suffix of BLOCKED_AUTH_TOOLS_SUFFIXES) {
      out.push(`mcp__${server}__${suffix}`);
    }
  }
  return out;
}

/** Exposed for tests / future callers that need the raw server list. */
export const HOSTED_CLAUDEAI_GOOGLE_MCP_SERVERS: readonly string[] = BLOCKED_HOSTED_SERVERS;
