import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Redirect HOME so `~/.claude/...` paths land in a per-run temp dir.
// atlassian-custom-config.ts resolves paths at import time via
// os.homedir(), so HOME must be set before the dynamic import.
const tmpHome = mkdtempSync(join(tmpdir(), "atlassian-custom-config-"));
process.env.HOME = tmpHome;

const unifiedFile = join(tmpHome, ".claude", "custom-atlassian", "credentials.json");
const legacyJiraFile = join(tmpHome, ".claude", "custom-jira", "credentials.json");
const legacyBitbucketFile = join(tmpHome, ".claude", "custom-bitbucket", "credentials.json");
const claudeJsonFile = join(tmpHome, ".claude.json");

const mod = await import("./atlassian-custom-config");
const {
  saveCredentials,
  loadCredentials,
  loadCredentialsSync,
  deleteCredentials,
  registerBitbucketMcp,
  unregisterBitbucketMcp,
  isBitbucketMcpRegistered,
  migrateLegacyCredentials,
  deleteLegacyCredentials,
  normaliseSiteUrl,
} = mod;

beforeEach(() => {
  for (const f of [unifiedFile, legacyJiraFile, legacyBitbucketFile, claudeJsonFile]) {
    if (existsSync(f)) rmSync(f);
  }
  for (const d of ["custom-atlassian", "custom-jira", "custom-bitbucket"]) {
    mkdirSync(join(tmpHome, ".claude", d), { recursive: true });
  }
});

afterAll(() => {
  rmSync(tmpHome, { recursive: true, force: true });
});

describe("normaliseSiteUrl", () => {
  it("strips scheme and trailing slash", () => {
    expect(normaliseSiteUrl("https://acme.atlassian.net/")).toBe("acme.atlassian.net");
    expect(normaliseSiteUrl("acme.atlassian.net")).toBe("acme.atlassian.net");
    expect(normaliseSiteUrl("  acme.atlassian.net  ")).toBe("acme.atlassian.net");
  });

  it("returns empty string for empty input", () => {
    expect(normaliseSiteUrl("")).toBe("");
    expect(normaliseSiteUrl("   ")).toBe("");
  });
});

describe("save/load round-trip", () => {
  it("persists both halves and survives a load", async () => {
    await saveCredentials({
      email: "user@example.com",
      jira: { siteUrl: "acme.atlassian.net", apiToken: "j-token", displayName: "Jira User" },
      bitbucket: { apiToken: "b-token", workspace: "acme", displayName: "BB User" },
    });
    const loaded = await loadCredentials();
    expect(loaded).not.toBeNull();
    expect(loaded!.email).toBe("user@example.com");
    expect(loaded!.jira?.siteUrl).toBe("acme.atlassian.net");
    expect(loaded!.bitbucket?.workspace).toBe("acme");
  });

  it("loadCredentialsSync mirrors async load", async () => {
    await saveCredentials({
      email: "user@example.com",
      jira: null,
      bitbucket: { apiToken: "b", workspace: "ws" },
    });
    const sync = loadCredentialsSync();
    expect(sync?.email).toBe("user@example.com");
    expect(sync?.jira).toBeNull();
    expect(sync?.bitbucket?.apiToken).toBe("b");
  });

  it("normalises Jira siteUrl on save", async () => {
    await saveCredentials({
      email: "user@example.com",
      jira: { siteUrl: "https://acme.atlassian.net/", apiToken: "j" },
      bitbucket: null,
    });
    const raw = JSON.parse(readFileSync(unifiedFile, "utf-8"));
    expect(raw.jira.siteUrl).toBe("acme.atlassian.net");
  });

  it("returns null when no file exists", async () => {
    expect(await loadCredentials()).toBeNull();
    expect(loadCredentialsSync()).toBeNull();
  });

  it("returns null on a malformed JSON file", async () => {
    mkdirSync(join(tmpHome, ".claude", "custom-atlassian"), { recursive: true });
    writeFileSync(unifiedFile, "{not json");
    expect(await loadCredentials()).toBeNull();
  });

  it("returns null when required fields missing", async () => {
    writeFileSync(unifiedFile, JSON.stringify({ jira: null, bitbucket: null }));
    expect(await loadCredentials()).toBeNull();
  });
});

describe("deleteCredentials", () => {
  it("removes the file", async () => {
    await saveCredentials({
      email: "u@x.com",
      jira: null,
      bitbucket: { apiToken: "b", workspace: "w" },
    });
    expect(existsSync(unifiedFile)).toBe(true);
    await deleteCredentials();
    expect(existsSync(unifiedFile)).toBe(false);
  });

  it("is a no-op when the file is absent", async () => {
    await expect(deleteCredentials()).resolves.toBeUndefined();
  });
});

describe("Bitbucket MCP registration", () => {
  it("registers an MCP entry only when bitbucket half is present", async () => {
    await registerBitbucketMcp({
      email: "u@x.com",
      jira: null,
      bitbucket: { apiToken: "b", workspace: "w" },
    });
    expect(await isBitbucketMcpRegistered()).toBe(true);
    const claudeJson = JSON.parse(readFileSync(claudeJsonFile, "utf-8"));
    expect(claudeJson.mcpServers.bitbucket.env.ATLASSIAN_EMAIL).toBe("u@x.com");
    expect(claudeJson.mcpServers.bitbucket.env.BITBUCKET_API_TOKEN).toBe("b");
    expect(claudeJson.mcpServers.bitbucket.env.BITBUCKET_WORKSPACE).toBe("w");
  });

  it("registerBitbucketMcp with no bitbucket half unregisters instead", async () => {
    await registerBitbucketMcp({
      email: "u@x.com",
      jira: null,
      bitbucket: { apiToken: "b", workspace: "w" },
    });
    expect(await isBitbucketMcpRegistered()).toBe(true);
    await registerBitbucketMcp({ email: "u@x.com", jira: null, bitbucket: null });
    expect(await isBitbucketMcpRegistered()).toBe(false);
  });

  it("unregisterBitbucketMcp removes the entry", async () => {
    await registerBitbucketMcp({
      email: "u@x.com",
      jira: null,
      bitbucket: { apiToken: "b", workspace: "w" },
    });
    await unregisterBitbucketMcp();
    expect(await isBitbucketMcpRegistered()).toBe(false);
  });
});

describe("migrateLegacyCredentials", () => {
  it("merges both legacy files into the unified config", async () => {
    writeFileSync(
      legacyJiraFile,
      JSON.stringify({
        domain: "acme.atlassian.net",
        email: "user@example.com",
        apiToken: "j-token",
        displayName: "Jira User",
      }),
    );
    writeFileSync(
      legacyBitbucketFile,
      JSON.stringify({
        email: "user@example.com",
        apiToken: "b-token",
        workspace: "acme",
        displayName: "BB User",
      }),
    );
    const migrated = await migrateLegacyCredentials();
    expect(migrated).not.toBeNull();
    expect(migrated!.email).toBe("user@example.com");
    expect(migrated!.jira?.apiToken).toBe("j-token");
    expect(migrated!.bitbucket?.apiToken).toBe("b-token");
    expect(existsSync(unifiedFile)).toBe(true);
    // Legacy files are intentionally left in place by the migration —
    // the credentials route is what cleans them up later.
    expect(existsSync(legacyJiraFile)).toBe(true);
  });

  it("migrates jira-only when bitbucket legacy file is missing", async () => {
    writeFileSync(
      legacyJiraFile,
      JSON.stringify({
        domain: "acme.atlassian.net",
        email: "user@example.com",
        apiToken: "j-token",
      }),
    );
    const migrated = await migrateLegacyCredentials();
    expect(migrated?.jira?.apiToken).toBe("j-token");
    expect(migrated?.bitbucket).toBeNull();
  });

  it("migrates bitbucket-only when jira legacy file is missing", async () => {
    writeFileSync(
      legacyBitbucketFile,
      JSON.stringify({ email: "user@example.com", apiToken: "b-token", workspace: "acme" }),
    );
    const migrated = await migrateLegacyCredentials();
    expect(migrated?.bitbucket?.apiToken).toBe("b-token");
    expect(migrated?.jira).toBeNull();
    // Bitbucket migration should also register the MCP.
    expect(await isBitbucketMcpRegistered()).toBe(true);
  });

  it("is a no-op when the unified file already exists", async () => {
    await saveCredentials({
      email: "existing@example.com",
      jira: { siteUrl: "x.atlassian.net", apiToken: "x" },
      bitbucket: null,
    });
    writeFileSync(
      legacyJiraFile,
      JSON.stringify({
        domain: "other.atlassian.net",
        email: "other@example.com",
        apiToken: "other",
      }),
    );
    const migrated = await migrateLegacyCredentials();
    expect(migrated).toBeNull();
    const after = await loadCredentials();
    expect(after?.email).toBe("existing@example.com");
  });

  it("returns null when there is nothing to migrate", async () => {
    expect(await migrateLegacyCredentials()).toBeNull();
  });

  it("ignores incomplete legacy files", async () => {
    writeFileSync(legacyJiraFile, JSON.stringify({ domain: "acme.atlassian.net" })); // missing email/token
    expect(await migrateLegacyCredentials()).toBeNull();
  });
});

describe("deleteLegacyCredentials", () => {
  it("removes both legacy files when present", async () => {
    writeFileSync(legacyJiraFile, "{}");
    writeFileSync(legacyBitbucketFile, "{}");
    await deleteLegacyCredentials();
    expect(existsSync(legacyJiraFile)).toBe(false);
    expect(existsSync(legacyBitbucketFile)).toBe(false);
  });

  it("is a no-op when neither file exists", async () => {
    await expect(deleteLegacyCredentials()).resolves.toBeUndefined();
  });
});
