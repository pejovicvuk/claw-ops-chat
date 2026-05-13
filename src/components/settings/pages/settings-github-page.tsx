"use client";

import { useCallback, useEffect, useState } from "react";
import {
  FiCheck,
  FiAlertTriangle,
  FiExternalLink,
  FiGithub,
  FiKey,
  FiLoader,
  FiLogOut,
} from "react-icons/fi";
import { authFetch } from "@/lib/auth";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

interface Status {
  tokenSaved: boolean;
  registered: boolean;
  login: string | null;
}

type Mode = "loading" | "setup" | "connected";

/**
 * GitHub integration settings page. Auth is a single paste-a-PAT form —
 * no OAuth redirect needed. On save we probe api.github.com/user to
 * validate the token, store it at ~/.claude/custom-github/credentials.json,
 * and register the official MCP server in ~/.claude.json under "github".
 */
export function SettingsGithubPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [mode, setMode] = useState<Mode>("loading");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [justSavedLogin, setJustSavedLogin] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await authFetch(`${BASE}/api/github-custom/status`);
      if (!res.ok) throw new Error("status");
      const data = (await res.json()) as Status;
      setStatus(data);
      setMode(data.tokenSaved && data.registered ? "connected" : "setup");
    } catch {
      setStatus({ tokenSaved: false, registered: false, login: null });
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
      const res = await authFetch(`${BASE}/api/github-custom/credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Save failed (${res.status})`);
      }
      const data = (await res.json()) as { login?: string | null };
      setJustSavedLogin(data.login ?? null);
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
      await authFetch(`${BASE}/api/github-custom/credentials`, { method: "DELETE" });
    } catch {
      /* best-effort */
    }
    setJustSavedLogin(null);
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
    const login = justSavedLogin ?? status.login;
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-4">
          <div className="mb-1 flex items-center gap-2">
            <FiCheck size={14} className="text-green-500" />
            <span className="text-[13px] font-medium text-canvas-fg">GitHub connected</span>
          </div>
          <p className="text-[12px] text-canvas-muted">
            {login ? (
              <>
                Signed in as <span className="font-mono text-canvas-fg">@{login}</span>.
              </>
            ) : (
              "Token saved and MCP server registered."
            )}{" "}
            Claude can now list repos, read issues, and open PRs via the github tool.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setMode("setup");
              setJustSavedLogin(null);
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
          <FiGithub size={14} className="text-canvas-fg" />
          <span className="text-[13px] font-medium text-canvas-fg">
            Paste a personal access token
          </span>
        </div>
        <p className="mb-3 text-[11px] leading-relaxed text-canvas-muted">
          Generate a token at{" "}
          <a
            href="https://github.com/settings/tokens"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-accent hover:underline"
          >
            github.com/settings/tokens <FiExternalLink size={10} />
          </a>
          . Recommended scopes for coding agents:{" "}
          <code className="rounded bg-canvas-bg px-1 py-0.5">repo</code>{" "}
          <code className="rounded bg-canvas-bg px-1 py-0.5">read:user</code>{" "}
          <code className="rounded bg-canvas-bg px-1 py-0.5">read:org</code>{" "}
          <code className="rounded bg-canvas-bg px-1 py-0.5">workflow</code>. Fine-grained tokens
          work too — give them read+write on the repos you want Claude to touch.
        </p>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[11px] text-canvas-muted" htmlFor="gh-token">
              Personal access token
            </label>
            <div className="flex items-center gap-2">
              <input
                id="gh-token"
                type={showToken ? "text" : "password"}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="ghp_... or github_pat_..."
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
        Token is stored locally in a root-owned file inside the container (
        <code>~/.claude/custom-github/credentials.json</code>, mode 0600) and passed as{" "}
        <code>GITHUB_PERSONAL_ACCESS_TOKEN</code> to the{" "}
        <code>@modelcontextprotocol/server-github</code> MCP server on every chat query. Nothing is
        sent off this server other than the validation probe to <code>api.github.com/user</code>.
      </p>
    </div>
  );
}
