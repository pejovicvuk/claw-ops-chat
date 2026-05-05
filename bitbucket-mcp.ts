/**
 * Stdio MCP server that exposes the read-only skills/bitbucket/bitbucket-cli.sh
 * as a set of `bitbucket_*` tools. Registered in ~/.claude.json by
 * bitbucket-custom-config.ts so the Claude Agent SDK spawns it on demand —
 * same shape as the GitHub MCP integration, just with an in-repo wrapper
 * around a bash script instead of an external npm server.
 *
 * Reads ATLASSIAN_EMAIL / BITBUCKET_API_TOKEN / BITBUCKET_WORKSPACE from its
 * own process env (the values come from the MCP registration, not the chat
 * server). BITBUCKET_CLI points at the bash script; defaults to the path
 * docker-compose mounts at runtime.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { spawn } from "child_process";
import { z } from "zod";

const CLI_PATH = process.env.BITBUCKET_CLI ?? "/opt/skills/bitbucket/bitbucket-cli.sh";

interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}

interface CliFailure {
  message: string;
  exitCode: number;
}

function runCli(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const proc = spawn("bash", [CLI_PATH, ...args], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    proc.stdout.on("data", (c: Buffer) => stdoutChunks.push(c));
    proc.stderr.on("data", (c: Buffer) => stderrChunks.push(c));
    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
      if (code === 0) {
        resolve(stdout);
        return;
      }
      const stderr = Buffer.concat(stderrChunks).toString("utf-8");
      const failure: CliFailure = {
        exitCode: typeof code === "number" ? code : 1,
        message:
          stderr.trim() || stdout.trim() || `bitbucket-cli.sh exited with code ${code ?? "?"}`,
      };
      reject(failure);
    });
  });
}

const SCOPE_HINT =
  "Bitbucket returned 403 — your API token is missing required scopes. Re-create it at " +
  "https://id.atlassian.com/manage-profile/security/api-tokens with at minimum " +
  "read:user:bitbucket, read:workspace:bitbucket, read:repository:bitbucket, " +
  "read:pullrequest:bitbucket. App passwords stop working 2026-06-09.";

const AUTH_HINT =
  "Bitbucket returned 401 — credentials rejected. Confirm the token is current and " +
  "that the username is your Atlassian account email (not your Bitbucket username).";

async function runTool(args: string[]): Promise<ToolResult> {
  try {
    const out = await runCli(args);
    return { content: [{ type: "text", text: out.length > 0 ? out : "(empty)" }] };
  } catch (err) {
    if (typeof err === "object" && err !== null && "exitCode" in err) {
      const failure = err as CliFailure;
      let text = failure.message;
      if (failure.exitCode === 3) text = `${SCOPE_HINT}\n\nUpstream detail: ${failure.message}`;
      else if (failure.exitCode === 2) text = `${AUTH_HINT}\n\nUpstream detail: ${failure.message}`;
      return { content: [{ type: "text", text }], isError: true };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: message }], isError: true };
  }
}

const server = new McpServer(
  { name: "bitbucket", version: "1.0.0" },
  {
    instructions:
      "Read-only Bitbucket Cloud: browse repos, inspect pull requests, diffs, branches, commits, and file contents. Backed by skills/bitbucket/bitbucket-cli.sh. Never mutates state.",
  },
);

const PR_STATE = z.enum(["OPEN", "MERGED", "DECLINED"]).optional();

server.registerTool(
  "bitbucket_repos",
  {
    description: "List repositories in the configured Bitbucket workspace (max 50).",
    inputSchema: {},
  },
  async () => runTool(["repos"]),
);

server.registerTool(
  "bitbucket_prs",
  {
    description: "List pull requests in a repository. Default state is OPEN.",
    inputSchema: {
      repo: z.string().describe("Repo slug, e.g. 'my-service'."),
      state: PR_STATE.describe("OPEN (default), MERGED, or DECLINED."),
    },
  },
  async ({ repo, state }) => runTool(state ? ["prs", repo, state] : ["prs", repo]),
);

server.registerTool(
  "bitbucket_pr",
  {
    description: "Get details for a single pull request.",
    inputSchema: {
      repo: z.string(),
      id: z.number().int().describe("PR number, e.g. 42."),
    },
  },
  async ({ repo, id }) => runTool(["pr", repo, String(id)]),
);

server.registerTool(
  "bitbucket_diffstat",
  {
    description:
      "Summary of files changed in a PR (paths, added/removed line counts). Read this before pulling a full diff.",
    inputSchema: {
      repo: z.string(),
      id: z.number().int(),
    },
  },
  async ({ repo, id }) => runTool(["diffstat", repo, String(id)]),
);

server.registerTool(
  "bitbucket_diff",
  {
    description: "Raw unified diff for a PR. Large PRs can be long — prefer diffstat first.",
    inputSchema: {
      repo: z.string(),
      id: z.number().int(),
    },
  },
  async ({ repo, id }) => runTool(["diff", repo, String(id)]),
);

server.registerTool(
  "bitbucket_comments",
  {
    description: "Comments on a pull request (includes inline file/line comments).",
    inputSchema: {
      repo: z.string(),
      id: z.number().int(),
    },
  },
  async ({ repo, id }) => runTool(["comments", repo, String(id)]),
);

server.registerTool(
  "bitbucket_pr_commits",
  {
    description: "Commits that make up a pull request.",
    inputSchema: {
      repo: z.string(),
      id: z.number().int(),
    },
  },
  async ({ repo, id }) => runTool(["pr-commits", repo, String(id)]),
);

server.registerTool(
  "bitbucket_branches",
  {
    description: "Branches in a repository. Optional query filters by name.",
    inputSchema: {
      repo: z.string(),
      query: z.string().optional().describe("Substring filter, e.g. 'feature'."),
    },
  },
  async ({ repo, query }) => runTool(query ? ["branches", repo, query] : ["branches", repo]),
);

server.registerTool(
  "bitbucket_commits",
  {
    description: "Recent commits on a branch (last 10).",
    inputSchema: {
      repo: z.string(),
      branch: z.string(),
    },
  },
  async ({ repo, branch }) => runTool(["commits", repo, branch]),
);

server.registerTool(
  "bitbucket_file",
  {
    description:
      "Raw file contents. Branch defaults to 'main' — always pass the branch explicitly if the user mentions one.",
    inputSchema: {
      repo: z.string(),
      path: z.string().describe("File path inside the repo, e.g. 'src/main.py'."),
      branch: z.string().optional(),
    },
  },
  async ({ repo, path, branch }) =>
    runTool(branch ? ["file", repo, path, branch] : ["file", repo, path]),
);

server.registerTool(
  "bitbucket_ls",
  {
    description:
      "List directory contents. Pass empty string for path to list the root on a non-default branch.",
    inputSchema: {
      repo: z.string(),
      path: z.string().default("").describe("Directory path, or '' for repo root."),
      branch: z.string().optional(),
    },
  },
  async ({ repo, path, branch }) => {
    const args = ["ls", repo, path];
    if (branch) args.push(branch);
    return runTool(args);
  },
);

server.registerTool(
  "bitbucket_tree",
  {
    description:
      "Recursive directory listing, one line per entry ('d'/'f' prefix). Preferred over repeated ls calls.",
    inputSchema: {
      repo: z.string(),
      path: z.string().default(""),
      branch: z.string().optional(),
    },
  },
  async ({ repo, path, branch }) => {
    const args = ["tree", repo, path];
    if (branch) args.push(branch);
    return runTool(args);
  },
);

server.registerTool(
  "bitbucket_search",
  {
    description:
      "Search code across the workspace, optionally scoped to one repo. Useful for finding symbols before reading files.",
    inputSchema: {
      query: z.string().describe("Search string, can be a phrase."),
      repo: z.string().optional().describe("Limit to a single repo slug."),
    },
  },
  async ({ query, repo }) => runTool(repo ? ["search", query, repo] : ["search", query]),
);

server.registerTool(
  "bitbucket_compare",
  {
    description: "Unified diff between two branches (no PR required).",
    inputSchema: {
      repo: z.string(),
      source: z.string(),
      destination: z.string(),
    },
  },
  async ({ repo, source, destination }) => runTool(["compare", repo, source, destination]),
);

server.registerTool(
  "bitbucket_build_status",
  {
    description: "CI / build statuses reported for a commit.",
    inputSchema: {
      repo: z.string(),
      commit: z.string().describe("Full or short commit hash."),
    },
  },
  async ({ repo, commit }) => runTool(["build-status", repo, commit]),
);

server.registerTool(
  "bitbucket_pr_status",
  {
    description: "Approval, review, and CI status for a pull request.",
    inputSchema: {
      repo: z.string(),
      id: z.number().int(),
    },
  },
  async ({ repo, id }) => runTool(["pr-status", repo, String(id)]),
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.stack || err.message : String(err);
  process.stderr.write(`bitbucket-mcp failed to start: ${msg}\n`);
  process.exit(1);
});
