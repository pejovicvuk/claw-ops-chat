import { execGit, GitExecError } from "../git/exec";
import { loadCredentials as loadGithubCredentials } from "../github-custom-config";
import { loadCredentials as loadAtlassianCredentials } from "../atlassian-custom-config";
import type { RepoKind } from "./validation";

/**
 * Single source of truth for cloning git repos into project items.
 *
 * Auth is injected via `GIT_CONFIG_*` env vars rather than baking the token
 * into the URL — git's URL parser handles `=` chars in PATs poorly, but
 * `GIT_CONFIG_VALUE_0` accepts any string. The `insteadOf` rewrite makes
 * the token a per-process detail that never lands in `.git/config` on disk.
 *
 * Clone shape:
 *   git clone --depth 1 --single-branch --no-tags <url> .
 *
 * `--depth 1 --single-branch` keeps the working tree small (fast for the
 * usual case of "just want to read this code"); we can deepen later via a
 * separate explicit fetch when per-item features need full history.
 */

/** Hard cap on a single clone. Clones above this are likely the wrong repo. */
const CLONE_TIMEOUT_MS = 60_000;
/** stdout cap — clone progress goes to stderr; main concern is not blowing memory on a runaway repo. */
const CLONE_MAX_STDOUT = 16 * 1024 * 1024;

export class CloneAuthMissingError extends Error {
  constructor(public kind: RepoKind) {
    super(`${kind} is not connected`);
    this.name = "CloneAuthMissingError";
  }
}

type CloneEnv = Record<string, string> & {
  GIT_CONFIG_COUNT: string;
  GIT_CONFIG_KEY_0: string;
  GIT_CONFIG_VALUE_0: string;
};

/**
 * Build the env vars that route an https github/bitbucket clone through
 * stored credentials. Exported for unit testing — the production caller
 * is `cloneRepo` below.
 */
export async function buildCloneEnv(kind: RepoKind): Promise<CloneEnv> {
  if (kind === "github") {
    const creds = await loadGithubCredentials();
    if (!creds) throw new CloneAuthMissingError("github");
    return {
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: `url.https://x-access-token:${creds.token}@github.com/.insteadOf`,
      GIT_CONFIG_VALUE_0: "https://github.com/",
    };
  }
  const creds = await loadAtlassianCredentials();
  if (!creds || !creds.bitbucket) throw new CloneAuthMissingError("bitbucket");
  return {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: `url.https://x-bitbucket-api-token-auth:${creds.bitbucket.apiToken}@bitbucket.org/.insteadOf`,
    GIT_CONFIG_VALUE_0: "https://bitbucket.org/",
  };
}

/**
 * Strip embedded credentials out of stderr lines before they leave the
 * server. Git is generally well-behaved here (it knows not to echo the
 * URL with credentials), but a defense-in-depth scrub costs nothing.
 */
export function scrubCloneStderr(stderr: string): string {
  if (!stderr) return "";
  const firstLine = stderr.split("\n").find((l) => l.trim().length > 0) ?? "";
  return firstLine
    .replace(/x-access-token:[^@\s]+@/g, "x-access-token:****@")
    .replace(/x-bitbucket-api-token-auth:[^@\s]+@/g, "x-bitbucket-api-token-auth:****@")
    .slice(0, 500);
}

export interface CloneArgs {
  /** Already-created empty directory we'll clone INTO (`.` as git target). */
  targetDir: string;
  kind: RepoKind;
  /** Canonical https URL from `validateRepoUrl`. Must end in `.git`. */
  repoUrl: string;
}

/**
 * Clone a repo into `targetDir`. Throws `CloneAuthMissingError` if the
 * matching integration isn't configured, or `GitExecError` on a non-zero
 * git exit / timeout.
 *
 * The caller is responsible for `rm -rf`'ing the directory on failure.
 */
export async function cloneRepo({ targetDir, kind, repoUrl }: CloneArgs): Promise<void> {
  const env = await buildCloneEnv(kind);
  const result = await execGit(
    ["clone", "--depth", "1", "--single-branch", "--no-tags", repoUrl, "."],
    {
      cwd: targetDir,
      timeoutMs: CLONE_TIMEOUT_MS,
      maxBuffer: CLONE_MAX_STDOUT,
      env,
    },
  );
  if (result.code !== 0) {
    throw new GitExecError(result.code, result.stderr, result.stdout.toString("utf-8"));
  }
}
