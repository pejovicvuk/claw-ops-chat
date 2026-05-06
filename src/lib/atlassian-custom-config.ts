import { existsSync, readFileSync } from "fs";
import { mkdir, readFile, writeFile, chmod, unlink } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import {
  registerMcpServer as registerServer,
  unregisterMcpServer as unregisterServer,
  isMcpServerRegistered as isServerRegistered,
} from "./mcp-register";

/**
 * Unified Atlassian credential store. Replaces the separate
 * bitbucket-custom-config + jira-custom-config modules so a single
 * Settings → Connections → Atlassian page can manage both halves.
 *
 * Atlassian's scoped API tokens (created at id.atlassian.com) are
 * per-app — Jira/Confluence scopes can't be combined with Bitbucket
 * scopes on one token — so we still store *two* tokens, but key them
 * off the same Atlassian email and a single on-disk file:
 *
 *   ~/.claude/custom-atlassian/credentials.json (mode 0600)
 *
 * Either half can be present, absent, or both. The Bitbucket half also
 * controls registration of the in-repo `bitbucket` MCP server in
 * ~/.claude.json (same wrapper as before, just plugged into the new
 * config). The Jira half is consumed by server.ts via env-var injection
 * at SDK query time — no MCP server is registered.
 */

export const BITBUCKET_MCP_SERVER_ID = "bitbucket";

const CREDENTIALS_DIR = join(homedir(), ".claude", "custom-atlassian");
const CREDENTIALS_FILE = join(CREDENTIALS_DIR, "credentials.json");

const LEGACY_JIRA_FILE = join(homedir(), ".claude", "custom-jira", "credentials.json");
const LEGACY_BITBUCKET_FILE = join(homedir(), ".claude", "custom-bitbucket", "credentials.json");

const BITBUCKET_MCP_SCRIPT = process.env.BITBUCKET_MCP_SCRIPT ?? "/app/bitbucket-mcp.js";

function resolveBitbucketCliPath(): string {
  if (process.env.BITBUCKET_CLI) return process.env.BITBUCKET_CLI;
  const dockerPath = "/opt/skills/bitbucket/bitbucket-cli.sh";
  if (existsSync(dockerPath)) return dockerPath;
  const localPath = join(process.cwd(), "skills/bitbucket/bitbucket-cli.sh");
  if (existsSync(localPath)) return localPath;
  return dockerPath;
}
const BITBUCKET_CLI_PATH = resolveBitbucketCliPath();

export interface JiraHalf {
  /** Bare host without scheme, e.g. "mycompany.atlassian.net". */
  siteUrl: string;
  apiToken: string;
  /** Display name from the validation probe — UI only. */
  displayName?: string | null;
}

export interface BitbucketHalf {
  apiToken: string;
  workspace: string;
  /** Display name from the validation probe — UI only. */
  displayName?: string | null;
}

export interface AtlassianCredentials {
  /** Atlassian account email — same email on both halves. */
  email: string;
  jira: JiraHalf | null;
  bitbucket: BitbucketHalf | null;
}

/** Normalise a domain to the bare host. Accepts full URLs or hostnames. */
export function normaliseSiteUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  try {
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return new URL(withScheme).host;
  } catch {
    return trimmed;
  }
}

function isValidShape(parsed: unknown): parsed is AtlassianCredentials {
  if (!parsed || typeof parsed !== "object") return false;
  const c = parsed as Partial<AtlassianCredentials>;
  if (typeof c.email !== "string" || !c.email) return false;
  if (c.jira !== null && c.jira !== undefined) {
    const j = c.jira;
    if (typeof j !== "object" || !j) return false;
    if (typeof j.siteUrl !== "string" || !j.siteUrl) return false;
    if (typeof j.apiToken !== "string" || !j.apiToken) return false;
  }
  if (c.bitbucket !== null && c.bitbucket !== undefined) {
    const b = c.bitbucket;
    if (typeof b !== "object" || !b) return false;
    if (typeof b.apiToken !== "string" || !b.apiToken) return false;
    if (typeof b.workspace !== "string" || !b.workspace) return false;
  }
  return true;
}

export async function saveCredentials(creds: AtlassianCredentials): Promise<void> {
  await mkdir(CREDENTIALS_DIR, { recursive: true });
  const normalised: AtlassianCredentials = {
    email: creds.email,
    jira: creds.jira ? { ...creds.jira, siteUrl: normaliseSiteUrl(creds.jira.siteUrl) } : null,
    bitbucket: creds.bitbucket ? { ...creds.bitbucket } : null,
  };
  await writeFile(CREDENTIALS_FILE, JSON.stringify(normalised, null, 2), "utf-8");
  try {
    await chmod(CREDENTIALS_FILE, 0o600);
  } catch {
    /* non-POSIX */
  }
}

export async function loadCredentials(): Promise<AtlassianCredentials | null> {
  if (!existsSync(CREDENTIALS_FILE)) return null;
  try {
    const raw = await readFile(CREDENTIALS_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (!isValidShape(parsed)) return null;
    return {
      email: parsed.email,
      jira: parsed.jira ?? null,
      bitbucket: parsed.bitbucket ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Synchronous load for the chat-turn env hot path in server.ts. Re-read
 * on every query so rotated tokens / disconnects take effect without a
 * container restart.
 */
export function loadCredentialsSync(): AtlassianCredentials | null {
  if (!existsSync(CREDENTIALS_FILE)) return null;
  try {
    const raw = readFileSync(CREDENTIALS_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (!isValidShape(parsed)) return null;
    return {
      email: parsed.email,
      jira: parsed.jira ?? null,
      bitbucket: parsed.bitbucket ?? null,
    };
  } catch {
    return null;
  }
}

export async function deleteCredentials(): Promise<void> {
  if (existsSync(CREDENTIALS_FILE)) {
    await unlink(CREDENTIALS_FILE).catch(() => {});
  }
}

/** Register the bitbucket MCP server using the unified credentials. */
export async function registerBitbucketMcp(creds: AtlassianCredentials): Promise<void> {
  if (!creds.bitbucket) {
    await unregisterServer(BITBUCKET_MCP_SERVER_ID);
    return;
  }
  await registerServer(BITBUCKET_MCP_SERVER_ID, {
    type: "stdio",
    command: "node",
    args: [BITBUCKET_MCP_SCRIPT],
    env: {
      ATLASSIAN_EMAIL: creds.email,
      BITBUCKET_API_TOKEN: creds.bitbucket.apiToken,
      BITBUCKET_WORKSPACE: creds.bitbucket.workspace,
      BITBUCKET_CLI: BITBUCKET_CLI_PATH,
    },
  });
}

export async function unregisterBitbucketMcp(): Promise<void> {
  await unregisterServer(BITBUCKET_MCP_SERVER_ID);
}

export async function isBitbucketMcpRegistered(): Promise<boolean> {
  return isServerRegistered(BITBUCKET_MCP_SERVER_ID);
}

interface LegacyJira {
  domain?: string;
  email?: string;
  apiToken?: string;
  displayName?: string | null;
}

interface LegacyBitbucket {
  email?: string;
  apiToken?: string;
  workspace?: string;
  displayName?: string | null;
}

function readLegacyJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

/**
 * One-shot migration from the old per-product files to the unified
 * file. No-op if the unified file already exists. Leaves the legacy
 * files in place — they're cleaned up on the first successful save
 * through the unified API. Returns the migrated credentials, or null
 * if there was nothing to migrate.
 */
export async function migrateLegacyCredentials(): Promise<AtlassianCredentials | null> {
  if (existsSync(CREDENTIALS_FILE)) return null;

  const legacyJira = readLegacyJson<LegacyJira>(LEGACY_JIRA_FILE);
  const legacyBitbucket = readLegacyJson<LegacyBitbucket>(LEGACY_BITBUCKET_FILE);

  const jiraOk = !!legacyJira && !!legacyJira.domain && !!legacyJira.email && !!legacyJira.apiToken;
  const bbOk =
    !!legacyBitbucket &&
    !!legacyBitbucket.email &&
    !!legacyBitbucket.apiToken &&
    !!legacyBitbucket.workspace;

  if (!jiraOk && !bbOk) return null;

  const email = jiraOk ? legacyJira!.email! : legacyBitbucket!.email!;

  const merged: AtlassianCredentials = {
    email,
    jira: jiraOk
      ? {
          siteUrl: normaliseSiteUrl(legacyJira!.domain!),
          apiToken: legacyJira!.apiToken!,
          displayName: legacyJira!.displayName ?? null,
        }
      : null,
    bitbucket: bbOk
      ? {
          apiToken: legacyBitbucket!.apiToken!,
          workspace: legacyBitbucket!.workspace!,
          displayName: legacyBitbucket!.displayName ?? null,
        }
      : null,
  };

  await saveCredentials(merged);
  if (merged.bitbucket) {
    await registerBitbucketMcp(merged);
  }
  return merged;
}

/** Best-effort cleanup of the legacy per-product files after migration. */
export async function deleteLegacyCredentials(): Promise<void> {
  for (const path of [LEGACY_JIRA_FILE, LEGACY_BITBUCKET_FILE]) {
    if (existsSync(path)) {
      await unlink(path).catch(() => {});
    }
  }
}
