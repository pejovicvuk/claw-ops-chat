"use client";

import { useCallback, useEffect, useState } from "react";
import {
  FiCheck,
  FiAlertTriangle,
  FiExternalLink,
  FiKey,
  FiLoader,
  FiLogOut,
  FiInfo,
} from "react-icons/fi";
import { SiNotion } from "react-icons/si";
import { authFetch } from "@/lib/auth";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

interface Status {
  tokenSaved: boolean;
  registered: boolean;
  workspaceName: string | null;
  botName: string | null;
}

type Mode = "loading" | "setup" | "connected";

/**
 * Notion integration settings page. Auth is a single paste-a-token form
 * where the token is an Internal Integration secret (from
 * notion.so/my-integrations). We probe api.notion.com/v1/users/me to
 * validate, store at ~/.claude/custom-notion/credentials.json, and
 * register the official @notionhq/notion-mcp-server in ~/.claude.json
 * under "notion".
 */
export function SettingsNotionPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [mode, setMode] = useState<Mode>("loading");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState<{
    workspaceName: string | null;
    botName: string | null;
  } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await authFetch(`${BASE}/api/notion-custom/status`);
      if (!res.ok) throw new Error("status");
      const data = (await res.json()) as Status;
      setStatus(data);
      setMode(data.tokenSaved && data.registered ? "connected" : "setup");
    } catch {
      setStatus({ tokenSaved: false, registered: false, workspaceName: null, botName: null });
      setMode("setup");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(async () => {
    if (!token.trim() || saving) return;
    setSaving(true);
    setErr(null);
    try {
      const res = await authFetch(`${BASE}/api/notion-custom/credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Save failed (${res.status})`);
      }
      const data = (await res.json()) as {
        workspaceName?: string | null;
        botName?: string | null;
      };
      setJustSaved({
        workspaceName: data.workspaceName ?? null,
        botName: data.botName ?? null,
      });
      setToken("");
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save token");
    } finally {
      setSaving(false);
    }
  }, [token, saving, refresh]);

  const disconnect = useCallback(async () => {
    try {
      await authFetch(`${BASE}/api/notion-custom/credentials`, { method: "DELETE" });
    } catch {
      /* best-effort */
    }
    setJustSaved(null);
    setToken("");
    await refresh();
  }, [refresh]);

  if (mode === "loading" || !status) {
    return (
      <div className="flex items-center justify-center py-8 text-canvas-muted">
        <FiLoader size={14} className="animate-spin" />
      </div>
    );
  }

  if (mode === "connected") {
    const workspaceName = justSaved?.workspaceName ?? status.workspaceName;
    const botName = justSaved?.botName ?? status.botName;
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-4">
          <div className="mb-1 flex items-center gap-2">
            <FiCheck size={14} className="text-green-500" />
            <span className="text-[13px] font-medium text-canvas-fg">Notion connected</span>
          </div>
          <p className="text-[12px] text-canvas-muted">
            {workspaceName ? (
              <>
                Workspace: <span className="font-mono text-canvas-fg">{workspaceName}</span>
                {botName && (
                  <>
                    {" "}
                    — integration <span className="font-mono text-canvas-fg">{botName}</span>
                  </>
                )}
                .
              </>
            ) : (
              "Token saved and MCP server registered."
            )}{" "}
            Claude can search, read, and update pages the integration has been shared with.
          </p>
        </div>

        <div className="flex items-start gap-2 rounded-xl border border-canvas-border bg-canvas-surface p-3">
          <FiInfo size={14} className="mt-0.5 shrink-0 text-canvas-muted" />
          <p className="text-[11px] leading-relaxed text-canvas-muted">
            Notion integrations only see pages and databases that have been explicitly shared with
            them. Open a page, click ••• → Connections, and add this integration — otherwise Claude
            will see an empty workspace.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setMode("setup");
              setJustSaved(null);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-canvas-border px-3 py-2 text-[12px] font-medium text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
          >
            <FiKey size={11} />
            Replace token
          </button>
          <button
            type="button"
            onClick={disconnect}
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/10 px-3 py-2 text-[12px] font-medium text-red-500 transition-colors hover:bg-red-500/15"
          >
            <FiLogOut size={11} />
            Disconnect
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-canvas-border bg-canvas-surface p-4">
        <div className="mb-2 flex items-center gap-2">
          <SiNotion size={14} className="text-canvas-fg" />
          <span className="text-[13px] font-medium text-canvas-fg">
            Paste a Notion integration token
          </span>
        </div>
        <p className="mb-3 text-[11px] leading-relaxed text-canvas-muted">
          Create an internal integration at{" "}
          <a
            href="https://www.notion.so/my-integrations"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-accent hover:underline"
          >
            notion.so/my-integrations <FiExternalLink size={10} />
          </a>
          , then share the pages you want Claude to access with that integration (open a page → •••
          → Connections → add your integration). Read capability is the minimum; grant update/insert
          if you want Claude to edit.
        </p>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[11px] text-canvas-muted" htmlFor="notion-token">
              Internal integration secret
            </label>
            <div className="flex items-center gap-2">
              <input
                id="notion-token"
                type={showToken ? "text" : "password"}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="secret_... or ntn_..."
                className="flex-1 rounded-lg border border-canvas-border bg-canvas-bg px-3 py-2 font-mono text-[12px] text-canvas-fg placeholder:text-canvas-muted/60 focus:border-accent focus:outline-none"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={() => setShowToken((v) => !v)}
                className="rounded-lg border border-canvas-border px-2 py-2 text-[11px] text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
              >
                {showToken ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          {err && (
            <p className="flex items-center gap-1 text-[11px] text-red-500">
              <FiAlertTriangle size={10} />
              {err}
            </p>
          )}

          <button
            type="button"
            onClick={save}
            disabled={!token.trim() || saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[12px] font-medium text-white transition-colors hover:opacity-90 disabled:opacity-40"
          >
            {saving ? (
              <>
                <FiLoader size={11} className="animate-spin" />
                Validating…
              </>
            ) : (
              <>
                <FiCheck size={11} />
                Save & connect
              </>
            )}
          </button>
        </div>
      </div>

      <p className="text-[10px] text-canvas-muted">
        Token stored at <code>~/.claude/custom-notion/credentials.json</code> (mode 0600) and passed
        to the official <code>@notionhq/notion-mcp-server</code> via the
        <code> OPENAPI_MCP_HEADERS</code> env var (the contract that server expects). Only the
        validation probe to <code>api.notion.com/v1/users/me</code> leaves this server.
      </p>
    </div>
  );
}
