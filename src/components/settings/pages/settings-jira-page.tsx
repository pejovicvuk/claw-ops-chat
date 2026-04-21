"use client";

import { useCallback, useEffect, useState } from "react";
import {
  FiCheck,
  FiAlertTriangle,
  FiExternalLink,
  FiKey,
  FiLoader,
  FiLogOut,
  FiCopy,
} from "react-icons/fi";
import { SiJira } from "react-icons/si";
import { authFetch } from "@/lib/auth";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

interface Status {
  saved: boolean;
  domain: string | null;
  email: string | null;
  displayName: string | null;
}

interface BitbucketStatus {
  saved?: boolean;
  email?: string | null;
}

type Mode = "loading" | "setup" | "connected";

/**
 * Jira integration settings page. Auth is email + API token + domain;
 * we validate with basic-auth against <domain>/rest/api/3/myself and
 * store at ~/.claude/custom-jira/credentials.json. server.ts injects
 * JIRA_URL / JIRA_EMAIL / JIRA_API_TOKEN env vars into the Claude Agent
 * SDK subprocess on every query so a Jira-aware skill or MCP can
 * consume them.
 *
 * Convenience: users who already connected Bitbucket can one-click
 * prefill email + token (same Atlassian account).
 */
export function SettingsJiraPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [mode, setMode] = useState<Mode>("loading");
  const [domain, setDomain] = useState("");
  const [email, setEmail] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [bbEmail, setBbEmail] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await authFetch(`${BASE}/api/jira-custom/status`);
      if (!res.ok) throw new Error("status");
      const data = (await res.json()) as Status;
      setStatus(data);
      setMode(data.saved ? "connected" : "setup");
      if (data.domain) setDomain(data.domain);
      if (data.email) setEmail(data.email);
    } catch {
      setStatus({ saved: false, domain: null, email: null, displayName: null });
      setMode("setup");
    }
  }, []);

  // Probe the Bitbucket page so we can offer one-click Atlassian reuse.
  const refreshBitbucket = useCallback(async () => {
    try {
      const res = await authFetch(`${BASE}/api/bitbucket-custom/status`);
      if (!res.ok) return;
      const data = (await res.json()) as BitbucketStatus;
      if (data.saved && data.email) setBbEmail(data.email);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refresh();
    void refreshBitbucket();
  }, [refresh, refreshBitbucket]);

  const reuseBitbucket = useCallback(() => {
    if (bbEmail) setEmail(bbEmail);
    // Token is secret — only the email is safe to prefill. Still tell
    // the user clearly that they need to re-paste the token.
    setErr(
      "Email prefilled from Bitbucket. Paste the same Atlassian API token above — we can't read it back from Bitbucket for security.",
    );
  }, [bbEmail]);

  const save = useCallback(async () => {
    if (!domain.trim() || !email.trim() || !apiToken.trim() || saving) return;
    setSaving(true);
    setErr(null);
    try {
      const res = await authFetch(`${BASE}/api/jira-custom/credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: domain.trim(),
          email: email.trim(),
          apiToken: apiToken.trim(),
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
  }, [domain, email, apiToken, saving, refresh]);

  const disconnect = useCallback(async () => {
    try {
      await authFetch(`${BASE}/api/jira-custom/credentials`, { method: "DELETE" });
    } catch {
      /* best-effort */
    }
    setDomain("");
    setEmail("");
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
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-4">
          <div className="mb-1 flex items-center gap-2">
            <FiCheck size={14} className="text-green-500" />
            <span className="text-[13px] font-medium text-canvas-fg">Jira connected</span>
          </div>
          <p className="text-[12px] text-canvas-muted">
            {status.displayName ? `Signed in as ${status.displayName}.` : "Token validated."}{" "}
            Domain:{" "}
            <code className="rounded bg-canvas-bg px-1 py-0.5">{status.domain}</code>. Claude sees
            issues via the JIRA_* env vars injected on every query.
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
          <SiJira size={14} className="text-canvas-fg" />
          <span className="text-[13px] font-medium text-canvas-fg">
            Connect a Jira Cloud account
          </span>
        </div>
        <p className="mb-3 text-[11px] leading-relaxed text-canvas-muted">
          Create an API token at{" "}
          <a
            href="https://id.atlassian.com/manage-profile/security/api-tokens"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-accent hover:underline"
          >
            id.atlassian.com → API tokens <FiExternalLink size={10} />
          </a>
          . The same token works for Bitbucket if you&apos;re on one Atlassian account — add both
          here and both stay in sync.
        </p>

        {bbEmail && (
          <div className="mb-3 flex items-center justify-between rounded-lg border border-canvas-border bg-canvas-bg px-3 py-2">
            <div className="min-w-0">
              <p className="text-[11px] text-canvas-muted">
                Bitbucket is already connected as{" "}
                <span className="font-mono text-canvas-fg">{bbEmail}</span>.
              </p>
            </div>
            <button
              type="button"
              onClick={reuseBitbucket}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-canvas-border px-2 py-1 text-[11px] text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
            >
              <FiCopy size={10} />
              Use same email
            </button>
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[11px] text-canvas-muted" htmlFor="jira-domain">
              Jira domain
            </label>
            <input
              id="jira-domain"
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="mycompany.atlassian.net"
              className="w-full rounded-lg border border-canvas-border bg-canvas-bg px-3 py-2 font-mono text-[12px] text-canvas-fg placeholder:text-canvas-muted/60 focus:border-accent focus:outline-none"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="mt-1 text-[10px] text-canvas-muted">
              Cloud only — must be <code>*.atlassian.net</code>.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-[11px] text-canvas-muted" htmlFor="jira-email">
              Atlassian email
            </label>
            <input
              id="jira-email"
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
            <label className="mb-1 block text-[11px] text-canvas-muted" htmlFor="jira-token">
              API token
            </label>
            <div className="flex items-center gap-2">
              <input
                id="jira-token"
                type={showToken ? "text" : "password"}
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                placeholder="ATATT..."
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
            <p className="flex items-start gap-1 text-[11px] text-red-500">
              <FiAlertTriangle size={10} className="mt-0.5 shrink-0" />
              <span>{err}</span>
            </p>
          )}

          <button
            type="button"
            onClick={save}
            disabled={!domain.trim() || !email.trim() || !apiToken.trim() || saving}
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
        Credentials stored at <code>~/.claude/custom-jira/credentials.json</code> (mode 0600) and
        injected as <code>JIRA_URL</code>, <code>JIRA_EMAIL</code>, <code>JIRA_API_TOKEN</code>{" "}
        into the Claude Agent SDK subprocess on every query. Nothing is sent off this server other
        than the validation probe to your Atlassian domain.
      </p>
    </div>
  );
}
