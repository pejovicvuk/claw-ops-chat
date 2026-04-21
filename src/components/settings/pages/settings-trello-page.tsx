"use client";

import { useCallback, useEffect, useState } from "react";
import {
  FiCheck,
  FiAlertTriangle,
  FiExternalLink,
  FiKey,
  FiLoader,
  FiLogOut,
} from "react-icons/fi";
import { SiTrello } from "react-icons/si";
import { authFetch } from "@/lib/auth";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

interface Status {
  saved: boolean;
  username: string | null;
  fullName: string | null;
}

type Mode = "loading" | "setup" | "connected";

/**
 * Trello integration settings page. Auth is an API key + API token pair
 * (both from trello.com/power-ups/admin → your power-up → API key).
 * Validates with `api.trello.com/1/members/me` using the pair as query
 * params (Trello's REST API quirk — not headers). No MCP server is
 * registered; server.ts injects TRELLO_API_KEY / TRELLO_TOKEN env vars
 * on every query so a skill / MCP can consume them.
 */
export function SettingsTrelloPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [mode, setMode] = useState<Mode>("loading");
  const [apiKey, setApiKey] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await authFetch(`${BASE}/api/trello-custom/status`);
      if (!res.ok) throw new Error("status");
      const data = (await res.json()) as Status;
      setStatus(data);
      setMode(data.saved ? "connected" : "setup");
    } catch {
      setStatus({ saved: false, username: null, fullName: null });
      setMode("setup");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(async () => {
    if (!apiKey.trim() || !apiToken.trim() || saving) return;
    setSaving(true);
    setErr(null);
    try {
      const res = await authFetch(`${BASE}/api/trello-custom/credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim(), apiToken: apiToken.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Save failed (${res.status})`);
      }
      setApiKey("");
      setApiToken("");
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save credentials");
    } finally {
      setSaving(false);
    }
  }, [apiKey, apiToken, saving, refresh]);

  const disconnect = useCallback(async () => {
    try {
      await authFetch(`${BASE}/api/trello-custom/credentials`, { method: "DELETE" });
    } catch {
      /* best-effort */
    }
    setApiKey("");
    setApiToken("");
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
    const display = status.fullName || status.username;
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-4">
          <div className="mb-1 flex items-center gap-2">
            <FiCheck size={14} className="text-green-500" />
            <span className="text-[13px] font-medium text-canvas-fg">Trello connected</span>
          </div>
          <p className="text-[12px] text-canvas-muted">
            {display ? (
              <>
                Signed in as{" "}
                <span className="font-mono text-canvas-fg">
                  {display}
                  {status.username && status.fullName ? ` (@${status.username})` : ""}
                </span>
                .
              </>
            ) : (
              "Credentials validated."
            )}{" "}
            Claude sees your boards via the{" "}
            <code className="rounded bg-canvas-bg px-1 py-0.5">TRELLO_API_KEY</code> /{" "}
            <code className="rounded bg-canvas-bg px-1 py-0.5">TRELLO_TOKEN</code> env vars
            injected on every query.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setMode("setup")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-canvas-border px-3 py-2 text-[12px] font-medium text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
          >
            <FiKey size={11} />
            Replace credentials
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
          <SiTrello size={14} className="text-canvas-fg" />
          <span className="text-[13px] font-medium text-canvas-fg">
            Connect a Trello account
          </span>
        </div>
        <p className="mb-3 text-[11px] leading-relaxed text-canvas-muted">
          Trello API auth is a two-step key + token handshake. Create a Power-Up (just a
          credential holder, no code) at{" "}
          <a
            href="https://trello.com/power-ups/admin"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-accent hover:underline"
          >
            trello.com/power-ups/admin <FiExternalLink size={10} />
          </a>
          , copy the <em>API key</em> it shows, then click the{" "}
          <em className="font-medium">Token</em> link right next to the key to authorize and copy
          the <em>API token</em>.
        </p>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[11px] text-canvas-muted" htmlFor="trello-key">
              API key
            </label>
            <div className="flex items-center gap-2">
              <input
                id="trello-key"
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="32 hex chars"
                className="flex-1 rounded-lg border border-canvas-border bg-canvas-bg px-3 py-2 font-mono text-[12px] text-canvas-fg placeholder:text-canvas-muted/60 focus:border-accent focus:outline-none"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="rounded-lg border border-canvas-border px-2 py-2 text-[11px] text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
              >
                {showKey ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[11px] text-canvas-muted" htmlFor="trello-token">
              API token
            </label>
            <div className="flex items-center gap-2">
              <input
                id="trello-token"
                type={showToken ? "text" : "password"}
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                placeholder="64+ hex chars"
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
            disabled={!apiKey.trim() || !apiToken.trim() || saving}
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
        Credentials stored at <code>~/.claude/custom-trello/credentials.json</code> (mode 0600)
        and injected as <code>TRELLO_API_KEY</code> and <code>TRELLO_TOKEN</code> into the
        Claude Agent SDK subprocess on every query. No MCP server is registered by default —
        drop your preferred Trello MCP or skill into <code>~/.claude.json</code> /{" "}
        <code>/opt/skills/</code> and it&apos;ll pick up the env vars automatically.
      </p>
    </div>
  );
}
