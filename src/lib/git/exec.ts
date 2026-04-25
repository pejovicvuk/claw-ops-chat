import { spawn } from "child_process";

export interface ExecGitOptions {
  /** Already-validated absolute path from `safePath()`. */
  cwd: string;
  /** Default 5_000. */
  timeoutMs?: number;
  /** Default 8 MB. */
  maxBuffer?: number;
  /** Extra env vars merged into the child process. */
  env?: Record<string, string>;
}

export interface ExecGitResult {
  /** Raw bytes; porcelain v2 -z output contains literal NULs we slice on. */
  stdout: Buffer;
  stderr: string;
  code: number;
}

export class GitExecError extends Error {
  constructor(
    public code: number | "timeout" | "spawn" | "buffer",
    public stderr: string,
    public stdout: string,
  ) {
    super(`git exited ${code}: ${stderr.trim() || stdout.trim() || "(no output)"}`);
    this.name = "GitExecError";
  }
}

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_BUFFER = 8 * 1024 * 1024;
const KILL_GRACE_MS = 250;

/**
 * Invoke `git` with the given args inside `cwd`, returning stdout as a raw
 * Buffer so callers can slice on byte boundaries (porcelain v2 -z output
 * contains literal NUL separators between fields/records).
 *
 * Mirrors the spawn pattern in `bitbucket-mcp.ts` but adds: a hard timeout
 * with SIGTERM-then-SIGKILL grace, a stdout buffer cap, and the env tweaks
 * needed to keep `git` from hanging on credential prompts or contending
 * with a concurrent terminal `git status`.
 */
export function execGit(args: string[], opts: ExecGitOptions): Promise<ExecGitResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBuffer = opts.maxBuffer ?? DEFAULT_MAX_BUFFER;

  return new Promise<ExecGitResult>((resolve, reject) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | null = null;

    const proc = spawn("git", args, {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        GIT_OPTIONAL_LOCKS: "0",
        GIT_TERMINAL_PROMPT: "0",
        LC_ALL: "C",
        ...(opts.env ?? {}),
      },
    });

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      clearTimeout(timeoutHandle);
      fn();
    };

    const timeoutHandle = setTimeout(() => {
      proc.kill("SIGTERM");
      killTimer = setTimeout(() => proc.kill("SIGKILL"), KILL_GRACE_MS);
      settle(() =>
        reject(
          new GitExecError(
            "timeout",
            Buffer.concat(stderrChunks).toString("utf-8"),
            Buffer.concat(stdoutChunks).toString("utf-8"),
          ),
        ),
      );
    }, timeoutMs);

    proc.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxBuffer) {
        proc.kill("SIGTERM");
        killTimer = setTimeout(() => proc.kill("SIGKILL"), KILL_GRACE_MS);
        settle(() =>
          reject(new GitExecError("buffer", `stdout exceeded maxBuffer (${maxBuffer} bytes)`, "")),
        );
        return;
      }
      stdoutChunks.push(chunk);
    });

    proc.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    proc.on("error", (err) => {
      settle(() => reject(new GitExecError("spawn", err.message, "")));
    });

    proc.on("close", (code) => {
      settle(() =>
        resolve({
          stdout: Buffer.concat(stdoutChunks),
          stderr: Buffer.concat(stderrChunks).toString("utf-8"),
          code: code ?? -1,
        }),
      );
    });
  });
}
