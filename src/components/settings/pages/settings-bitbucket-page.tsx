"use client";

import { useCallback, useEffect, useState } from "react";
import {
  FiCheck,
  FiAlertTriangle,
  FiExternalLink,
  FiGitBranch,
  FiKey,
  FiLoader,
  FiLogOut,
} from "react-icons/fi";
import { authFetch } from "@/lib/auth";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

interface Status {
  saved: boolean;
  email: string | null;
  workspace: string | null;
  displayName: string | null;
}

type Mode = "loading" | "setup" | "connected";

/**
 * Bitbucket integration settings page. No OAuth — user pastes email +
 * API token + workspace slug, we validate with basic-auth against
 * api.bitbucket.org/2.0/user, store at
 * ~/.claude/custom-bitbucket/credentials.json, and server.ts injects
 * the three env vars into the Claude Agent SDK child process so the
 * read-only bash skill at /opt/skills/bitbucket/ picks them up.
 */
export function SettingsBitbucketPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [mode, setMode] = useState<Mode>("loading");
  const [email, setEmail] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await authFetch(`${BASE}/api/bitbucket-custom/status`);
      if (!res.ok) throw new Error("status");
      const data = (await res.json()) as Status;
      setStatus(data);
      setMode(data.saved ? "connected" : "setup");
      if (data.email) setEmail(data.email);
      if (data.workspace) setWorkspace(data.workspace);
    } catch {
      setStatus({ saved: false, email: null, workspace: null, displayName: null });
      setMode("setup");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(async () => {
    if (!email.trim() || !apiToken.trim() || !workspace.trim() || saving) return;
    setSaving(true);
    setErr(null);
    try {
      const res = await authFetch(`${BASE}/api/bitbucket-custom/credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          apiToken: apiToken.trim(),
          workspace: workspace.trim(),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Save failed (${res.status})`);
      }
      setApiToken("");
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save credentials");
    } finally {
      setSaving(false);
    }
  }, [email, apiToken, workspace, saving, refresh]);

  const disconnect = useCallback(async () => {
    try {
      await authFetch(`${BASE}/api/bitbucket-custom/credentials`, { method: "DELETE" });
    } catch {
      /* best-effort */
    }
    setEmail("");
    setApiToken("");
    setWorkspace("");
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
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-4">
          <div className="mb-1 flex items-center gap-2">
            <FiCheck size={14} className="text-green-500" />
            <span className="text-[13px] font-medium text-canvas-fg">Bitbucket connected</span>
          </div>
          <p className="text-[12px] text-canvas-muted">
            {status.displayName ? `Signed in as ${status.displayName}.` : "Token validated."}{" "}
            Workspace: <code className="rounded bg-canvas-bg px-1 py-0.5">{status.workspace}</code>.
            Claude can now read repos, branches, and PRs via the{" "}
            <code className="rounded bg-canvas-bg px-1 py-0.5">bitbucket</code> skill.
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
          <FiGitBranch size={14} className="text-canvas-fg" />
          <span className="text-[13px] font-medium text-canvas-fg">
            Connect a Bitbucket Cloud account
          </span>
        </div>
        <p className="mb-3 text-[11px] leading-relaxed text-canvas-muted">
          Create an API token at{" "}
          <a
            href="https://bitbucket.org/account/settings/app-passwords/"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-accent hover:underline"
          >
            bitbucket.org → App passwords <FiExternalLink size={10} />
          </a>{" "}
          with scopes <code className="rounded bg-canvas-bg px-1 py-0.5">Repositories: Read</code>{" "}
          and <code className="rounded bg-canvas-bg px-1 py-0.5">Pull requests: Read</code>. The
          skill is read-only — no write scopes needed.
        </p>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[11px] text-canvas-muted" htmlFor="bb-email">
              Atlassian email
            </label>
            <input
              id="bb-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-lg border border-canvas-border bg-canvas-bg px-3 py-2 text-[12px] text-canvas-fg placeholder:text-canvas-muted/60 focus:border-accent focus:outline-none"
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] text-canvas-muted" htmlFor="bb-token">
              API token
            </label>
            <div className="flex items-center gap-2">
              <input
                id="bb-token"
                type={showToken ? "text" : "password"}
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                placeholder="ATBB..."
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

          <div>
            <label className="mb-1 block text-[11px] text-canvas-muted" htmlFor="bb-workspace">
              Workspace slug
            </label>
            <input
              id="bb-workspace"
              type="text"
              value={workspace}
              onChange={(e) => setWorkspace(e.target.value)}
              placeholder="my-team"
              className="w-full rounded-lg border border-canvas-border bg-canvas-bg px-3 py-2 text-[12px] text-canvas-fg placeholder:text-canvas-muted/60 focus:border-accent focus:outline-none"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="mt-1 text-[10px] text-canvas-muted">
              The last segment of your Bitbucket URL:{" "}
              <code className="rounded bg-canvas-bg px-1 py-0.5">
                bitbucket.org/&lt;workspace&gt;
              </code>
              .
            </p>
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
            disabled={!email.trim() || !apiToken.trim() || !workspace.trim() || saving}
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
        Credentials are stored locally in the container at{" "}
        <code>~/.claude/custom-bitbucket/credentials.json</code> (mode 0600) and injected as
        <code> ATLASSIAN_EMAIL</code>, <code>BITBUCKET_API_TOKEN</code>, and
        <code> BITBUCKET_WORKSPACE</code> into the Claude Agent SDK subprocess on every query —
        that&apos;s how the skill under <code>/opt/skills/bitbucket/</code> sees them.
      </p>
    </div>
  );
}
