import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Redirect HOME so the helper's `~/.claude/...` paths land in a temp dir.
// microsoft-custom-config.ts resolves the credential / claude.json paths
// at import time via `os.homedir()`, so HOME must be set before we
// dynamically import the module.
const tmpHome = mkdtempSync(join(tmpdir(), "microsoft-custom-config-"));
process.env.HOME = tmpHome;
const credentialsFile = join(tmpHome, ".claude", "custom-microsoft", "credentials.json");
const claudeJson = join(tmpHome, ".claude.json");

const mod = await import("./microsoft-custom-config");
const {
  loadCredentials,
  saveCredentials,
  refreshAccessTokenIfNeeded,
  registerMcpServer,
  MCP_SERVER_ID,
} = mod;

beforeEach(() => {
  if (existsSync(credentialsFile)) rmSync(credentialsFile);
  if (existsSync(claudeJson)) rmSync(claudeJson);
  mkdirSync(join(tmpHome, ".claude", "custom-microsoft"), { recursive: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  rmSync(tmpHome, { recursive: true, force: true });
});

describe("loadCredentials", () => {
  it("strips a legacy clientSecret field from older saves", async () => {
    writeFileSync(
      credentialsFile,
      JSON.stringify({
        clientId: "client-id",
        tenantId: "common",
        clientSecret: "legacy-secret-do-not-send",
        accessToken: "tok",
        refreshToken: "rt",
        expiresAt: 1234567890,
      }),
    );
    const loaded = await loadCredentials();
    expect(loaded).not.toBeNull();
    expect(loaded).not.toHaveProperty("clientSecret");
    expect(loaded?.clientId).toBe("client-id");
    expect(loaded?.accessToken).toBe("tok");
    expect(loaded?.refreshToken).toBe("rt");
  });

  it("returns null when the file is missing", async () => {
    expect(await loadCredentials()).toBeNull();
  });

  it("returns null when clientId or tenantId is absent", async () => {
    writeFileSync(credentialsFile, JSON.stringify({ clientId: "id" }));
    expect(await loadCredentials()).toBeNull();
  });
});

describe("saveCredentials → loadCredentials round-trip", () => {
  it("drops the legacy clientSecret on the next save (load → save → load)", async () => {
    writeFileSync(
      credentialsFile,
      JSON.stringify({
        clientId: "client-id",
        tenantId: "common",
        clientSecret: "legacy-secret",
        accessToken: "tok",
      }),
    );
    const loaded = await loadCredentials();
    expect(loaded).not.toBeNull();
    if (!loaded) return;
    await saveCredentials(loaded);

    const onDisk = JSON.parse(readFileSync(credentialsFile, "utf-8")) as Record<string, unknown>;
    expect(onDisk).not.toHaveProperty("clientSecret");
    expect(onDisk.clientId).toBe("client-id");
    expect(onDisk.accessToken).toBe("tok");
  });
});

describe("registerMcpServer", () => {
  it("never writes MS365_MCP_CLIENT_SECRET into the env block", async () => {
    await registerMcpServer({
      clientId: "client-id",
      tenantId: "common",
      accessToken: "tok",
    });
    const data = JSON.parse(readFileSync(claudeJson, "utf-8")) as {
      mcpServers: Record<string, { env: Record<string, string> }>;
    };
    const env = data.mcpServers[MCP_SERVER_ID].env;
    expect(env.MS365_MCP_CLIENT_ID).toBe("client-id");
    expect(env.MS365_MCP_TENANT_ID).toBe("common");
    expect(env.MS365_MCP_OAUTH_TOKEN).toBe("tok");
    expect(env).not.toHaveProperty("MS365_MCP_CLIENT_SECRET");
  });
});

describe("refreshAccessTokenIfNeeded", () => {
  it("does not include client_secret in the refresh request body", async () => {
    // Save a credential whose access token is already expired so the
    // refresh path is exercised. Include a legacy clientSecret on disk
    // to prove the wire payload still omits it.
    writeFileSync(
      credentialsFile,
      JSON.stringify({
        clientId: "client-id",
        tenantId: "common",
        clientSecret: "legacy-secret",
        accessToken: "old-tok",
        refreshToken: "rt",
        expiresAt: Date.now() - 60_000,
      }),
    );

    let captured: { url: string; body: string } | null = null;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : "";
      const body = init?.body as URLSearchParams | undefined;
      captured = { url, body: body?.toString() ?? "" };
      return new Response(
        JSON.stringify({
          access_token: "new-tok",
          refresh_token: "new-rt",
          expires_in: 3600,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    await refreshAccessTokenIfNeeded();

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(captured).not.toBeNull();
    expect(captured!.url).toContain("login.microsoftonline.com");
    expect(captured!.body).toContain("grant_type=refresh_token");
    expect(captured!.body).toContain("client_id=client-id");
    expect(captured!.body).toContain("refresh_token=rt");
    expect(captured!.body).not.toContain("client_secret");
    expect(captured!.body).not.toContain("legacy-secret");

    // The fresh token is persisted, the legacy clientSecret is not.
    const onDisk = JSON.parse(readFileSync(credentialsFile, "utf-8")) as Record<string, unknown>;
    expect(onDisk.accessToken).toBe("new-tok");
    expect(onDisk.refreshToken).toBe("new-rt");
    expect(onDisk).not.toHaveProperty("clientSecret");
  });

  it("throws a helpful error when no refresh token is available", async () => {
    writeFileSync(
      credentialsFile,
      JSON.stringify({
        clientId: "client-id",
        tenantId: "common",
        accessToken: "old-tok",
        expiresAt: Date.now() - 60_000,
      }),
    );
    await expect(refreshAccessTokenIfNeeded()).rejects.toThrow(/refresh token/i);
  });
});
