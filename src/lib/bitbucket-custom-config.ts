import { existsSync, readFileSync } from "fs";
import { mkdir, readFile, writeFile, chmod, unlink } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

/**
 * Stores Bitbucket Cloud credentials so the existing read-only skill at
 * /opt/skills/bitbucket/bitbucket-cli.sh can authenticate. Unlike GitHub
 * or Google, no MCP server — the skill is a plain bash wrapper invoked
 * directly by Claude. Credentials are injected as env vars when the chat
 * app spawns the Claude Agent SDK subprocess (see server.ts).
 *
 * Credentials file: ~/.claude/custom-bitbucket/credentials.json (mode 0600)
 */

const CREDENTIALS_DIR = join(homedir(), ".claude", "custom-bitbucket");
const CREDENTIALS_FILE = join(CREDENTIALS_DIR, "credentials.json");

export interface BitbucketCredentials {
  email: string;
  apiToken: string;
  workspace: string;
  /** Display name from the validation probe — purely for UI. */
  displayName?: string | null;
}

/** Save credentials to disk (mode 0600). */
export async function saveCredentials(creds: BitbucketCredentials): Promise<void> {
  await mkdir(CREDENTIALS_DIR, { recursive: true });
  await writeFile(CREDENTIALS_FILE, JSON.stringify(creds, null, 2), "utf-8");
  try {
    await chmod(CREDENTIALS_FILE, 0o600);
  } catch {
    /* ignore */
  }
}

/** Async load, used by API routes. */
export async function loadCredentials(): Promise<BitbucketCredentials | null> {
  if (!existsSync(CREDENTIALS_FILE)) return null;
  try {
    const raw = await readFile(CREDENTIALS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as BitbucketCredentials;
    if (!parsed.email || !parsed.apiToken || !parsed.workspace) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Sync variant used inside the query hot-path in server.ts. We re-read the
 * file on every query so rotated tokens take effect without a container
 * restart, and so disconnecting instantly stops env injection.
 */
export function loadCredentialsSync(): BitbucketCredentials | null {
  if (!existsSync(CREDENTIALS_FILE)) return null;
  try {
    const raw = readFileSync(CREDENTIALS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as BitbucketCredentials;
    if (!parsed.email || !parsed.apiToken || !parsed.workspace) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Delete stored credentials. */
export async function deleteCredentials(): Promise<void> {
  if (existsSync(CREDENTIALS_FILE)) {
    await unlink(CREDENTIALS_FILE).catch(() => {});
  }
}
