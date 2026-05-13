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
import { SiLinear } from "react-icons/si";
import { authFetch } from "@/lib/auth";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

interface Status {
  tokenSaved: boolean;
  registered: boolean;
  email: string | null;
  name: string | null;
}

type Mode = "loading" | "setup" | "connected";

/**
 * Linear integration settings page. Auth is a single paste-an-API-key
 * form. On save we probe `api.linear.app/graphql` with the viewer query
 * to validate the key, store it at ~/.claude/custom-linear/credentials.json,
 * and register a Linear MCP server in ~/.claude.json under "linear".
 */
export function SettingsLinearPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [mode, setMode] = useState<Mode>("loading");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState<{ email: string | null; name: string | null } | null>(
    null,
  );

  const refresh = useCallback(async () => {
    try {
      const res = await authFetch(`${BASE}/api/linear-custom/status`);
      if (!res.ok) throw new Error("status");
      const data = (await res.json()) as Status;
      setStatus(data);
      setMode(data.tokenSaved && data.registered ? "connected" : "setup");
    } catch {
      setStatus({ tokenSaved: false, registered: false, email: null, name: null });
      setMode("setup");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(async () => {
    if (!apiKey.trim() || saving) return;
    setSaving(true);
    setErr(null);
    try {
      const res = await authFetch(`${BASE}/api/linear-custom/credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Save failed (${res.status})`);
      }
      const data = (await res.json()) as { email?: string | null; name?: string | null };
      setJustSaved({ email: data.email ?? null, name: data.name ?? null });
      setApiKey("");
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save key");
    } finally {
      setSaving(false);
    }
  }, [apiKey, saving, refresh]);

  const disconnect = useCallback(async () => {
    try {
      await authFetch(`${BASE}/api/linear-custom/credentials`, { method: "DELETE" });
    } catch {
      /* best-effort */
    }
    setJustSaved(null);
    setApiKey("");
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
    const email = justSaved?.email ?? status.email;
    const name = justSaved?.name ?? status.name;
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-4">
          <div className="mb-1 flex items-center gap-2">
            <FiCheck size={14} className="text-green-500" />
            <span className="text-[13px] font-medium text-canvas-fg">Linear connected</span>
          </div>
          <p className="text-[12px] text-canvas-muted">
            {name || email ? (
              <>
                Signed in as <span className="font-mono text-canvas-fg">{name || email}</span>.
              </>
            ) : (
              "Key saved and MCP server registered."
            )}{" "}
            Claude can now search, read, and create Linear issues via the linear tool.
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
            Replace key
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
          <SiLinear size={14} className="text-canvas-fg" />
          <span className="text-[13px] font-medium text-canvas-fg">Paste a Linear API key</span>
        </div>
        <p className="mb-3 text-[11px] leading-relaxed text-canvas-muted">
          Generate a key at{" "}
          <a
            href="https://linear.app/settings/api"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-accent hover:underline"
          >
            linear.app/settings/api <FiExternalLink size={10} />
          </a>
          . Personal API keys have the scope of the user they belong to — Claude sees only issues
          you can see.
        </p>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[11px] text-canvas-muted" htmlFor="linear-key">
              Personal API key
            </label>
            <div className="flex items-center gap-2">
              <input
                id="linear-key"
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="lin_api_..."
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

          {err && (
            <p className="flex items-center gap-1 text-[11px] text-red-500">
              <FiAlertTriangle size={10} />
              {err}
            </p>
          )}

          <button
            type="button"
            onClick={save}
            disabled={!apiKey.trim() || saving}
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
        Key is stored locally in <code>~/.claude/custom-linear/credentials.json</code> (mode 0600)
        and passed as <code>LINEAR_API_KEY</code> to the <code>@tacticlaunch/mcp-linear</code> MCP
        server. Nothing is sent off this server other than the validation probe to{" "}
        <code>api.linear.app/graphql</code>.
      </p>
    </div>
  );
}
