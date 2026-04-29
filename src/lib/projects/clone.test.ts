import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the credential loaders BEFORE importing the module under test.
vi.mock("../github-custom-config", () => ({
  loadCredentials: vi.fn(),
}));
vi.mock("../bitbucket-custom-config", () => ({
  loadCredentials: vi.fn(),
}));

const { loadCredentials: loadGithub } = await import("../github-custom-config");
const { loadCredentials: loadBitbucket } = await import("../bitbucket-custom-config");
const { buildCloneEnv, scrubCloneStderr, CloneAuthMissingError } = await import("./clone");

describe("buildCloneEnv", () => {
  beforeEach(() => {
    vi.mocked(loadGithub).mockReset();
    vi.mocked(loadBitbucket).mockReset();
  });

  it("github: includes the PAT in the insteadOf rewrite", async () => {
    vi.mocked(loadGithub).mockResolvedValue({ token: "ghp_xyz", login: "me" });
    const env = await buildCloneEnv("github");
    expect(env.GIT_CONFIG_COUNT).toBe("1");
    expect(env.GIT_CONFIG_KEY_0).toBe("url.https://x-access-token:ghp_xyz@github.com/.insteadOf");
    expect(env.GIT_CONFIG_VALUE_0).toBe("https://github.com/");
  });

  it("bitbucket: uses the bitbucket-api-token-auth user", async () => {
    vi.mocked(loadBitbucket).mockResolvedValue({
      email: "user@x.com",
      apiToken: "atatt_secret",
      workspace: "ws",
    });
    const env = await buildCloneEnv("bitbucket");
    expect(env.GIT_CONFIG_KEY_0).toBe(
      "url.https://x-bitbucket-api-token-auth:atatt_secret@bitbucket.org/.insteadOf",
    );
    expect(env.GIT_CONFIG_VALUE_0).toBe("https://bitbucket.org/");
  });

  it("github: throws CloneAuthMissingError when not configured", async () => {
    vi.mocked(loadGithub).mockResolvedValue(null);
    await expect(buildCloneEnv("github")).rejects.toBeInstanceOf(CloneAuthMissingError);
    await expect(buildCloneEnv("github")).rejects.toMatchObject({ kind: "github" });
  });

  it("bitbucket: throws CloneAuthMissingError when not configured", async () => {
    vi.mocked(loadBitbucket).mockResolvedValue(null);
    await expect(buildCloneEnv("bitbucket")).rejects.toBeInstanceOf(CloneAuthMissingError);
    await expect(buildCloneEnv("bitbucket")).rejects.toMatchObject({ kind: "bitbucket" });
  });
});

describe("scrubCloneStderr", () => {
  it("redacts a PAT embedded in an x-access-token URL", () => {
    const input =
      "fatal: unable to access 'https://x-access-token:ghp_secretkey@github.com/owner/repo.git/'";
    expect(scrubCloneStderr(input)).toContain("x-access-token:****@");
    expect(scrubCloneStderr(input)).not.toContain("ghp_secretkey");
  });

  it("redacts a token embedded in a bitbucket clone URL", () => {
    const input = "fatal: 'https://x-bitbucket-api-token-auth:atatt_secret@bitbucket.org/x/y.git'";
    expect(scrubCloneStderr(input)).toContain("x-bitbucket-api-token-auth:****@");
    expect(scrubCloneStderr(input)).not.toContain("atatt_secret");
  });

  it("only returns the first non-empty line", () => {
    expect(scrubCloneStderr("\nfirst line\nsecond line\n")).toBe("first line");
  });

  it("clamps long messages to 500 chars", () => {
    const long = "x".repeat(2000);
    expect(scrubCloneStderr(long).length).toBe(500);
  });

  it("returns empty string for empty input", () => {
    expect(scrubCloneStderr("")).toBe("");
  });
});
