"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const child_process_1 = require("child_process");
const zod_1 = require("zod");
const CLI_PATH = process.env.BITBUCKET_CLI ?? "/opt/skills/bitbucket/bitbucket-cli.sh";
function runCli(args) {
    return new Promise((resolve, reject) => {
        const stdoutChunks = [];
        const stderrChunks = [];
        const proc = (0, child_process_1.spawn)("bash", [CLI_PATH, ...args], {
            env: process.env,
            stdio: ["ignore", "pipe", "pipe"],
        });
        proc.stdout.on("data", (c) => stdoutChunks.push(c));
        proc.stderr.on("data", (c) => stderrChunks.push(c));
        proc.on("error", (err) => reject(err));
        proc.on("close", (code) => {
            const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
            if (code === 0) {
                resolve(stdout);
                return;
            }
            const stderr = Buffer.concat(stderrChunks).toString("utf-8");
            reject(new Error(stderr.trim() || stdout.trim() || `bitbucket-cli.sh exited with code ${code}`));
        });
    });
}
async function runTool(args) {
    try {
        const out = await runCli(args);
        return { content: [{ type: "text", text: out.length > 0 ? out : "(empty)" }] };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: message }], isError: true };
    }
}
const server = new mcp_js_1.McpServer({ name: "bitbucket", version: "1.0.0" }, {
    instructions: "Read-only Bitbucket Cloud: browse repos, inspect pull requests, diffs, branches, commits, and file contents. Backed by skills/bitbucket/bitbucket-cli.sh. Never mutates state.",
});
const PR_STATE = zod_1.z.enum(["OPEN", "MERGED", "DECLINED"]).optional();
server.registerTool("bitbucket_repos", {
    description: "List repositories in the configured Bitbucket workspace (max 50).",
    inputSchema: {},
}, async () => runTool(["repos"]));
server.registerTool("bitbucket_prs", {
    description: "List pull requests in a repository. Default state is OPEN.",
    inputSchema: {
        repo: zod_1.z.string().describe("Repo slug, e.g. 'my-service'."),
        state: PR_STATE.describe("OPEN (default), MERGED, or DECLINED."),
    },
}, async ({ repo, state }) => runTool(state ? ["prs", repo, state] : ["prs", repo]));
server.registerTool("bitbucket_pr", {
    description: "Get details for a single pull request.",
    inputSchema: {
        repo: zod_1.z.string(),
        id: zod_1.z.number().int().describe("PR number, e.g. 42."),
    },
}, async ({ repo, id }) => runTool(["pr", repo, String(id)]));
server.registerTool("bitbucket_diffstat", {
    description: "Summary of files changed in a PR (paths, added/removed line counts). Read this before pulling a full diff.",
    inputSchema: {
        repo: zod_1.z.string(),
        id: zod_1.z.number().int(),
    },
}, async ({ repo, id }) => runTool(["diffstat", repo, String(id)]));
server.registerTool("bitbucket_diff", {
    description: "Raw unified diff for a PR. Large PRs can be long — prefer diffstat first.",
    inputSchema: {
        repo: zod_1.z.string(),
        id: zod_1.z.number().int(),
    },
}, async ({ repo, id }) => runTool(["diff", repo, String(id)]));
server.registerTool("bitbucket_comments", {
    description: "Comments on a pull request (includes inline file/line comments).",
    inputSchema: {
        repo: zod_1.z.string(),
        id: zod_1.z.number().int(),
    },
}, async ({ repo, id }) => runTool(["comments", repo, String(id)]));
server.registerTool("bitbucket_pr_commits", {
    description: "Commits that make up a pull request.",
    inputSchema: {
        repo: zod_1.z.string(),
        id: zod_1.z.number().int(),
    },
}, async ({ repo, id }) => runTool(["pr-commits", repo, String(id)]));
server.registerTool("bitbucket_branches", {
    description: "Branches in a repository. Optional query filters by name.",
    inputSchema: {
        repo: zod_1.z.string(),
        query: zod_1.z.string().optional().describe("Substring filter, e.g. 'feature'."),
    },
}, async ({ repo, query }) => runTool(query ? ["branches", repo, query] : ["branches", repo]));
server.registerTool("bitbucket_commits", {
    description: "Recent commits on a branch (last 10).",
    inputSchema: {
        repo: zod_1.z.string(),
        branch: zod_1.z.string(),
    },
}, async ({ repo, branch }) => runTool(["commits", repo, branch]));
server.registerTool("bitbucket_file", {
    description: "Raw file contents. Branch defaults to 'main' — always pass the branch explicitly if the user mentions one.",
    inputSchema: {
        repo: zod_1.z.string(),
        path: zod_1.z.string().describe("File path inside the repo, e.g. 'src/main.py'."),
        branch: zod_1.z.string().optional(),
    },
}, async ({ repo, path, branch }) => runTool(branch ? ["file", repo, path, branch] : ["file", repo, path]));
server.registerTool("bitbucket_ls", {
    description: "List directory contents. Pass empty string for path to list the root on a non-default branch.",
    inputSchema: {
        repo: zod_1.z.string(),
        path: zod_1.z.string().default("").describe("Directory path, or '' for repo root."),
        branch: zod_1.z.string().optional(),
    },
}, async ({ repo, path, branch }) => {
    const args = ["ls", repo, path];
    if (branch)
        args.push(branch);
    return runTool(args);
});
server.registerTool("bitbucket_tree", {
    description: "Recursive directory listing, one line per entry ('d'/'f' prefix). Preferred over repeated ls calls.",
    inputSchema: {
        repo: zod_1.z.string(),
        path: zod_1.z.string().default(""),
        branch: zod_1.z.string().optional(),
    },
}, async ({ repo, path, branch }) => {
    const args = ["tree", repo, path];
    if (branch)
        args.push(branch);
    return runTool(args);
});
server.registerTool("bitbucket_search", {
    description: "Search code across the workspace, optionally scoped to one repo. Useful for finding symbols before reading files.",
    inputSchema: {
        query: zod_1.z.string().describe("Search string, can be a phrase."),
        repo: zod_1.z.string().optional().describe("Limit to a single repo slug."),
    },
}, async ({ query, repo }) => runTool(repo ? ["search", query, repo] : ["search", query]));
server.registerTool("bitbucket_compare", {
    description: "Unified diff between two branches (no PR required).",
    inputSchema: {
        repo: zod_1.z.string(),
        source: zod_1.z.string(),
        destination: zod_1.z.string(),
    },
}, async ({ repo, source, destination }) => runTool(["compare", repo, source, destination]));
server.registerTool("bitbucket_build_status", {
    description: "CI / build statuses reported for a commit.",
    inputSchema: {
        repo: zod_1.z.string(),
        commit: zod_1.z.string().describe("Full or short commit hash."),
    },
}, async ({ repo, commit }) => runTool(["build-status", repo, commit]));
server.registerTool("bitbucket_pr_status", {
    description: "Approval, review, and CI status for a pull request.",
    inputSchema: {
        repo: zod_1.z.string(),
        id: zod_1.z.number().int(),
    },
}, async ({ repo, id }) => runTool(["pr-status", repo, String(id)]));
async function main() {
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
}
main().catch((err) => {
    const msg = err instanceof Error ? err.stack || err.message : String(err);
    process.stderr.write(`bitbucket-mcp failed to start: ${msg}\n`);
    process.exit(1);
});
