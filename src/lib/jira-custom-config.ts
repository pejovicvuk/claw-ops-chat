import { existsSync, readFileSync } from "fs";
import { mkdir, readFile, writeFile, chmod, unlink } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

/**
 * Stores Jira Cloud credentials. Mirrors the Bitbucket pattern: no MCP
 * server is registered; instead server.ts injects JIRA_URL / JIRA_EMAIL /
 * JIRA_API_TOKEN env vars into the Claude Agent SDK subprocess on every
 * query, and any Jira-aware skill or MCP the user drops into the
 * container can read them.
 *
 * Credentials file: ~/.claude/custom-jira/credentials.json (mode 0600)
 */

const CREDENTIALS_DIR = join(homedir(), ".claude", "custom-jira");
const CREDENTIALS_FILE = join(CREDENTIALS_DIR, "credentials.json");

export interface JiraCredentials {
  /** Bare host without scheme, e.g. "mycompany.atlassian.net". */
  domain: string;
  email: string;
  apiToken: string;
  /** Display name from the validation probe — UI only. */
  displayName?: string | null;
}

/** Normalise a domain to the bare host. Accepts full URLs or hostnames. */
export function normaliseDomain(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  try {
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return new URL(withScheme).host;
  } catch {
    return trimmed;
  }
}

export async function saveCredentials(creds: JiraCredentials): Promise<void> {
  await mkdir(CREDENTIALS_DIR, { recursive: true });
  await writeFile(
    CREDENTIALS_FILE,
    JSON.stringify({ ...creds, domain: normaliseDomain(creds.domain) }, null, 2),
    "utf-8",
  );
  try {
    await chmod(CREDENTIALS_FILE, 0o600);
  } catch {
    /* non-POSIX */
  }
}

export async function loadCredentials(): Promise<JiraCredentials | null> {
  if (!existsSync(CREDENTIALS_FILE)) return null;
  try {
    const raw = await readFile(CREDENTIALS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as JiraCredentials;
    if (!parsed.domain || !parsed.email || !parsed.apiToken) return null;
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
export function loadCredentialsSync(): JiraCredentials | null {
  if (!existsSync(CREDENTIALS_FILE)) return null;
  try {
    const raw = readFileSync(CREDENTIALS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as JiraCredentials;
    if (!parsed.domain || !parsed.email || !parsed.apiToken) return null;
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
