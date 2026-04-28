// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

vi.mock("@/lib/audit/api-wrap", () => ({
  withAudit:
    <Ctx>(_opts: unknown, handler: (req: Request, ctx?: Ctx) => Promise<Response>) =>
    (req: Request, ctx?: Ctx) =>
      handler(req, ctx),
}));

const extractSessionMock = vi.fn();
vi.mock("@/lib/auth-server", () => ({
  extractSession: () => extractSessionMock(),
  unauthorized: () => Response.json({ error: "Unauthorized" }, { status: 401 }),
}));

// Stub the disk fallback — point it at our tmpdir so we control the
// returned PersistedSession[] without writing files.
const loadAllMock = vi.fn();
vi.mock("@/lib/session-persistence", () => ({
  loadAllSessions: () => loadAllMock(),
}));

interface MutableGlobal {
  __clawListSessionBranches?: () => unknown[];
}
const globalAny = globalThis as MutableGlobal;

async function callGet(): Promise<Response> {
  const { GET } = await import("./route");
  return GET(new Request("http://localhost/api/sessions/branches"), {});
}

let tmpdirPath: string;
beforeEach(() => {
  extractSessionMock.mockReset();
  loadAllMock.mockReset();
  delete globalAny.__clawListSessionBranches;
});

afterAll(async () => {
  if (tmpdirPath) await rm(tmpdirPath, { recursive: true, force: true });
});

describe("/api/sessions/branches GET", () => {
  it("rejects unauthenticated requests with 401", async () => {
    extractSessionMock.mockReturnValue(null);
    const res = await callGet();
    expect(res.status).toBe(401);
  });

  it("returns the live snapshot when the global hook is set", async () => {
    extractSessionMock.mockReturnValue({ email: "u@x.com" });
    globalAny.__clawListSessionBranches = () => [
      {
        sessionId: "abc",
        claudeSessionId: null,
        branchName: "main",
        sessionCwd: "/repo",
        status: "thinking",
        display: "Hello",
      },
    ];
    const res = await callGet();
    const body = await res.json();
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0]).toMatchObject({
      sessionId: "abc",
      branchName: "main",
      status: "thinking",
    });
  });

  it("falls back to disk and projects each PersistedSession", async () => {
    extractSessionMock.mockReturnValue({ email: "u@x.com" });
    loadAllMock.mockResolvedValueOnce([
      {
        id: "s1",
        status: "thinking",
        permissionMode: "default",
        effort: null,
        claudeSessionId: null,
        sessionCwd: "/r",
        branchName: "feat/x",
        eventHistory: [],
        sessionAllowedTools: [],
        accumulatedText: "",
        lastActivity: 0,
        lastUserMessage: "Hello there",
      },
    ]);
    const res = await callGet();
    const body = await res.json();
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0]).toMatchObject({
      sessionId: "s1",
      branchName: "feat/x",
      sessionCwd: "/r",
      status: "idle",
      display: "Hello there",
    });
  });

  it("disk fallback: handles old PersistedSessions without branchName", async () => {
    extractSessionMock.mockReturnValue({ email: "u@x.com" });
    loadAllMock.mockResolvedValueOnce([
      {
        id: "old",
        status: "idle",
        permissionMode: "default",
        effort: null,
        claudeSessionId: null,
        sessionCwd: null,
        eventHistory: [],
        sessionAllowedTools: [],
        accumulatedText: "",
        lastActivity: 0,
        lastUserMessage: "",
      },
    ]);
    // Make sure tmpdir exists for the afterAll cleanup even though
    // loadAllSessions is mocked.
    if (!tmpdirPath) tmpdirPath = await mkdtemp(join(tmpdir(), "claw-sb-"));
    await writeFile(join(tmpdirPath, ".keep"), "");
    const res = await callGet();
    const body = await res.json();
    expect(body.sessions[0]).toMatchObject({
      sessionId: "old",
      branchName: null,
      display: "Chat",
    });
  });
});
