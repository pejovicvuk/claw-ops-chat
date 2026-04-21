import { existsSync, readFileSync } from "fs";
import { mkdir, readFile, writeFile, chmod, unlink } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

/**
 * Stores Trello API credentials (key + token pair — that's what Trello's
 * REST API uses, no OAuth in this flow). Mirrors the Bitbucket / Jira
 * pattern: no MCP server registered here because there's no canonical
 * Trello MCP package on npm; instead server.ts injects TRELLO_API_KEY /
 * TRELLO_TOKEN env vars into the Claude Agent SDK subprocess on every
 * query, and any Trello-aware skill or MCP the user drops in can read
 * them.
 *
 * Credentials file: ~/.claude/custom-trello/credentials.json (mode 0600)
 */

const CREDENTIALS_DIR = join(homedir(), ".claude", "custom-trello");
const CREDENTIALS_FILE = join(CREDENTIALS_DIR, "credentials.json");

export interface TrelloCredentials {
  apiKey: string;
  apiToken: string;
  /** Display fields captured from the validation probe — UI only. */
  username?: string | null;
  fullName?: string | null;
}

export async function saveCredentials(creds: TrelloCredentials): Promise<void> {
  await mkdir(CREDENTIALS_DIR, { recursive: true });
  await writeFile(CREDENTIALS_FILE, JSON.stringify(creds, null, 2), "utf-8");
  try {
    await chmod(CREDENTIALS_FILE, 0o600);
  } catch {
    /* non-POSIX */
  }
}

export async function loadCredentials(): Promise<TrelloCredentials | null> {
  if (!existsSync(CREDENTIALS_FILE)) return null;
  try {
    const raw = await readFile(CREDENTIALS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as TrelloCredentials;
    if (!parsed.apiKey || !parsed.apiToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Sync variant used inside the query hot-path in server.ts. Re-read on
 * every query so rotated tokens / disconnects take effect without a
 * container restart.
 */
export function loadCredentialsSync(): TrelloCredentials | null {
  if (!existsSync(CREDENTIALS_FILE)) return null;
  try {
    const raw = readFileSync(CREDENTIALS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as TrelloCredentials;
    if (!parsed.apiKey || !parsed.apiToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function deleteCredentials(): Promise<void> {
  if (existsSync(CREDENTIALS_FILE)) {
    await unlink(CREDENTIALS_FILE).catch(() => {});
  }
}
