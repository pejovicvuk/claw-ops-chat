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
import { SiJira } from "react-icons/si";
import { authFetch } from "@/lib/auth";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

interface JiraStatus {
  connected: true;
  siteUrl: string;
  displayName: string | null;
}

interface BitbucketStatus {
  connected: true;
  workspace: string;
  displayName: string | null;
  registered: boolean;
}

interface UnifiedStatus {
  saved: boolean;
  email: string | null;
  jira: JiraStatus | null;
  bitbucket: BitbucketStatus | null;
}

type Mode = "loading" | "ready";

/**
 * Unified Atlassian settings page. Replaces the separate Bitbucket and
 * Jira sub-pages. One email field shared by both halves; each half has
 * its own connect / replace / disconnect controls and surfaces its own
 * scope-aware error.
 *
 * Atlassian's scoped API tokens are per-app (Jira/Confluence xor
 * Bitbucket), so we still take two tokens — what unified is the
 * email, the on-disk file, and the UI surface.
 */
export function SettingsAtlassianPage() {
  const [status, setStatus] = useState<UnifiedStatus | null>(null);
  const [mode, setMode] = useState<Mode>("loading");

  // Shared field.
  const [email, setEmail] = useState("");

  // Jira form state.
  const [jiraSiteUrl, setJiraSiteUrl] = useState("");
  const [jiraToken, setJiraToken] = useState("");
  const [jiraShowToken, setJiraShowToken] = useState(false);
  const [jiraEditing, setJiraEditing] = useState(false);
  const [jiraSaving, setJiraSaving] = useState(false);
  const [jiraErr, setJiraErr] = useState<string | null>(null);

  // Bitbucket form state.
  const [bbWorkspace, setBbWorkspace] = useState("");
  const [bbToken, setBbToken] = useState("");
  const [bbShowToken, setBbShowToken] = useState(false);
  const [bbEditing, setBbEditing] = useState(false);
  const [bbSaving, setBbSaving] = useState(false);
  const [bbErr, setBbErr] = useState<string | null>(null);
  const [bbScopeHint, setBbScopeHint] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await authFetch(`${BASE}/api/atlassian-custom/status`);
      if (!res.ok) throw new Error("status");
      const data = (await res.json()) as UnifiedStatus;
      setStatus(data);
      if (data.email) setEmail(data.email);
      if (data.jira) {
        setJiraSiteUrl(data.jira.siteUrl);
        setJiraEditing(false);
      } else {
        setJiraEditing(true);
      }
      if (data.bitbucket) {
        setBbWorkspace(data.bitbucket.workspace);
        setBbEditing(false);
      } else {
        setBbEditing(true);
      }
      setMode("ready");
    } catch {
      setStatus({ saved: false, email: null, jira: null, bitbucket: null });
      setJiraEditing(true);
      setBbEditing(true);
      setMode("ready");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveJira = useCallback(async () => {
    if (!email.trim() || !jiraSiteUrl.trim() || !jiraToken.trim() || jiraSaving) return;
    setJiraSaving(true);
    setJiraErr(null);
    try {
      const res = await authFetch(`${BASE}/api/atlassian-custom/credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          jira: { siteUrl: jiraSiteUrl.trim(), apiToken: jiraToken.trim() },
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Save failed (${res.status})`);
      }
      setJiraToken("");
      await refresh();
    } catch (e) {
      setJiraErr(e instanceof Error ? e.message : "Failed to save Jira credentials");
    } finally {
      setJiraSaving(false);
    }
  }, [email, jiraSiteUrl, jiraToken, jiraSaving, refresh]);

  const disconnectJira = useCallback(async () => {
    try {
      await authFetch(`${BASE}/api/atlassian-custom/credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() || status?.email || "x@x.x", removeJira: true }),
      });
    } catch {
      /* best-effort */
    }
    setJiraToken("");
    await refresh();
  }, [email, status?.email, refresh]);

  const saveBitbucket = useCallback(async () => {
    if (!email.trim() || !bbWorkspace.trim() || !bbToken.trim() || bbSaving) return;
    setBbSaving(true);
    setBbErr(null);
    setBbScopeHint(false);
    try {
      const res = await authFetch(`${BASE}/api/atlassian-custom/credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          bitbucket: { workspace: bbWorkspace.trim(), apiToken: bbToken.trim() },
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          missingScope?: boolean;
        };
        if (body.missingScope) setBbScopeHint(true);
        throw new Error(body.error || `Save failed (${res.status})`);
      }
      setBbToken("");
      await refresh();
    } catch (e) {
      setBbErr(e instanceof Error ? e.message : "Failed to save Bitbucket credentials");
    } finally {
      setBbSaving(false);
    }
  }, [email, bbWorkspace, bbToken, bbSaving, refresh]);

  const disconnectBitbucket = useCallback(async () => {
    try {
      await authFetch(`${BASE}/api/atlassian-custom/credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim() || status?.email || "x@x.x",
          removeBitbucket: true,
        }),
      });
    } catch {
      /* best-effort */
    }
    setBbToken("");
    await refresh();
  }, [email, status?.email, refresh]);

  if (mode === "loading" || !status) {
    return (
      <div className="flex items-center justify-center py-8 text-canvas-muted">
        <FiLoader size={14} className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-[11px] leading-relaxed text-canvas-muted">
        Connect your Atlassian account to give Claude access to Jira and Bitbucket. Atlassian&apos;s
        scoped API tokens are per-app — create one for each at{" "}
        <a
          href="https://id.atlassian.com/manage-profile/security/api-tokens"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-accent hover:underline"
        >
          id.atlassian.com → API tokens <FiExternalLink size={10} />
        </a>
        . Tokens stay on this server; only validation probes leave it.
      </p>

      {/* Shared email */}
      <div className="rounded-xl border border-canvas-border bg-canvas-surface p-4">
        <label className="mb-1 block text-[11px] text-canvas-muted" htmlFor="atlassian-email">
          Atlassian email
        </label>
        <input
          id="atlassian-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full rounded-lg border border-canvas-border bg-canvas-bg px-3 py-2 text-[12px] text-canvas-fg placeholder:text-canvas-muted/60 focus:border-accent focus:outline-none"
          autoComplete="off"
          spellCheck={false}
        />
        <p className="mt-1 text-[10px] text-canvas-muted">
          Used as the username for both Jira and Bitbucket basic-auth. Must be your Atlassian
          account email — not your Bitbucket username.
        </p>
      </div>

      {/* Jira section */}
      <section className="rounded-xl border border-canvas-border bg-canvas-surface p-4">
        <div className="mb-2 flex items-center gap-2">
          <SiJira size={14} className="text-canvas-fg" />
          <span className="text-[13px] font-medium text-canvas-fg">Jira</span>
        </div>

        {status.jira && !jiraEditing ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-3">
              <div className="mb-1 flex items-center gap-2">
                <FiCheck size={12} className="text-green-500" />
                <span className="text-[12px] font-medium text-canvas-fg">Connected</span>
              </div>
              <p className="text-[11px] text-canvas-muted">
                {status.jira.displayName
                  ? `Signed in as ${status.jira.displayName}.`
                  : "Token validated."}{" "}
                Site:{" "}
                <code className="rounded bg-canvas-bg px-1 py-0.5">{status.jira.siteUrl}</code>.
                Claude reads issues via the JIRA_* env vars injected on every query.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setJiraEditing(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-canvas-border px-3 py-2 text-[12px] font-medium text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
              >
                <FiKey size={11} />
                Replace token
              </button>
              <button
                type="button"
                onClick={disconnectJira}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/10 px-3 py-2 text-[12px] font-medium text-red-500 transition-colors hover:bg-red-500/15"
              >
                <FiLogOut size={11} />
                Disconnect Jira
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[11px] leading-relaxed text-canvas-muted">
              Create a token at{" "}
              <a
                href="https://id.atlassian.com/manage-profile/security/api-tokens"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-accent hover:underline"
              >
                id.atlassian.com → API tokens <FiExternalLink size={10} />
              </a>{" "}
              and pick <strong className="text-canvas-fg">Jira</strong> as the app, with at minimum{" "}
              <code className="rounded bg-canvas-bg px-1 py-0.5">read:jira-work</code> and{" "}
              <code className="rounded bg-canvas-bg px-1 py-0.5">read:jira-user</code>.
            </p>
            <div>
              <label className="mb-1 block text-[11px] text-canvas-muted" htmlFor="jira-site">
                Jira site
              </label>
              <input
                id="jira-site"
                type="text"
                value={jiraSiteUrl}
                onChange={(e) => setJiraSiteUrl(e.target.value)}
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
              <label className="mb-1 block text-[11px] text-canvas-muted" htmlFor="jira-token">
                Jira API token
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="jira-token"
                  type={jiraShowToken ? "text" : "password"}
                  value={jiraToken}
                  onChange={(e) => setJiraToken(e.target.value)}
                  placeholder="ATATT…"
                  className="flex-1 rounded-lg border border-canvas-border bg-canvas-bg px-3 py-2 font-mono text-[12px] text-canvas-fg placeholder:text-canvas-muted/60 focus:border-accent focus:outline-none"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  onClick={() => setJiraShowToken((v) => !v)}
                  className="rounded-lg border border-canvas-border px-2 py-2 text-[11px] text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
                >
                  {jiraShowToken ? "Hide" : "Show"}
                </button>
              </div>
            </div>
            {jiraErr && (
              <p className="flex items-start gap-1 text-[11px] text-red-500">
                <FiAlertTriangle size={10} className="mt-0.5 shrink-0" />
                <span>{jiraErr}</span>
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={saveJira}
                disabled={!email.trim() || !jiraSiteUrl.trim() || !jiraToken.trim() || jiraSaving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[12px] font-medium text-white transition-colors hover:opacity-90 disabled:opacity-40"
              >
                {jiraSaving ? (
                  <>
                    <FiLoader size={11} className="animate-spin" />
                    Validating…
                  </>
                ) : (
                  <>
                    <FiCheck size={11} />
                    Save Jira
                  </>
                )}
              </button>
              {status.jira && (
                <button
                  type="button"
                  onClick={() => {
                    setJiraEditing(false);
                    setJiraToken("");
                    setJiraErr(null);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-canvas-border px-3 py-2 text-[12px] font-medium text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Bitbucket section */}
      <section className="rounded-xl border border-canvas-border bg-canvas-surface p-4">
        <div className="mb-2 flex items-center gap-2">
          <FiGitBranch size={14} className="text-canvas-fg" />
          <span className="text-[13px] font-medium text-canvas-fg">Bitbucket</span>
        </div>

        {status.bitbucket && !bbEditing ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-3">
              <div className="mb-1 flex items-center gap-2">
                <FiCheck size={12} className="text-green-500" />
                <span className="text-[12px] font-medium text-canvas-fg">Connected</span>
              </div>
              <p className="text-[11px] text-canvas-muted">
                {status.bitbucket.displayName
                  ? `Signed in as ${status.bitbucket.displayName}.`
                  : "Token validated."}{" "}
                Workspace:{" "}
                <code className="rounded bg-canvas-bg px-1 py-0.5">
                  {status.bitbucket.workspace}
                </code>
                . Claude reads repos, branches, and PRs via the{" "}
                <code className="rounded bg-canvas-bg px-1 py-0.5">bitbucket</code> MCP server.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setBbEditing(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-canvas-border px-3 py-2 text-[12px] font-medium text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
              >
                <FiKey size={11} />
                Replace token
              </button>
              <button
                type="button"
                onClick={disconnectBitbucket}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/10 px-3 py-2 text-[12px] font-medium text-red-500 transition-colors hover:bg-red-500/15"
              >
                <FiLogOut size={11} />
                Disconnect Bitbucket
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[11px] leading-relaxed text-canvas-muted">
              Create a <strong className="text-canvas-fg">separate</strong> token at{" "}
              <a
                href="https://id.atlassian.com/manage-profile/security/api-tokens"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-accent hover:underline"
              >
                id.atlassian.com → API tokens <FiExternalLink size={10} />
              </a>
              , pick <strong className="text-canvas-fg">Bitbucket</strong> as the app, and tick at
              least these scopes:{" "}
              <code className="rounded bg-canvas-bg px-1 py-0.5">read:user:bitbucket</code>,{" "}
              <code className="rounded bg-canvas-bg px-1 py-0.5">read:workspace:bitbucket</code>,{" "}
              <code className="rounded bg-canvas-bg px-1 py-0.5">read:repository:bitbucket</code>,{" "}
              <code className="rounded bg-canvas-bg px-1 py-0.5">read:pullrequest:bitbucket</code>.
              Bitbucket app passwords stop working{" "}
              <strong className="text-canvas-fg">2026-06-09</strong>; tokens are required.
            </p>
            <div>
              <label className="mb-1 block text-[11px] text-canvas-muted" htmlFor="bb-workspace">
                Workspace slug
              </label>
              <input
                id="bb-workspace"
                type="text"
                value={bbWorkspace}
                onChange={(e) => setBbWorkspace(e.target.value)}
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
            <div>
              <label className="mb-1 block text-[11px] text-canvas-muted" htmlFor="bb-token">
                Bitbucket API token
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="bb-token"
                  type={bbShowToken ? "text" : "password"}
                  value={bbToken}
                  onChange={(e) => setBbToken(e.target.value)}
                  placeholder="ATCTT…"
                  className="flex-1 rounded-lg border border-canvas-border bg-canvas-bg px-3 py-2 font-mono text-[12px] text-canvas-fg placeholder:text-canvas-muted/60 focus:border-accent focus:outline-none"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  onClick={() => setBbShowToken((v) => !v)}
                  className="rounded-lg border border-canvas-border px-2 py-2 text-[11px] text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
                >
                  {bbShowToken ? "Hide" : "Show"}
                </button>
              </div>
            </div>
            {bbErr && (
              <div className="space-y-1.5">
                <p className="flex items-start gap-1 text-[11px] text-red-500">
                  <FiAlertTriangle size={10} className="mt-0.5 shrink-0" />
                  <span>{bbErr}</span>
                </p>
                {bbScopeHint && (
                  <a
                    href="https://id.atlassian.com/manage-profile/security/api-tokens"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline"
                  >
                    Re-create the token with the right scopes <FiExternalLink size={10} />
                  </a>
                )}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={saveBitbucket}
                disabled={!email.trim() || !bbWorkspace.trim() || !bbToken.trim() || bbSaving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[12px] font-medium text-white transition-colors hover:opacity-90 disabled:opacity-40"
              >
                {bbSaving ? (
                  <>
                    <FiLoader size={11} className="animate-spin" />
                    Validating…
                  </>
                ) : (
                  <>
                    <FiCheck size={11} />
                    Save Bitbucket
                  </>
                )}
              </button>
              {status.bitbucket && (
                <button
                  type="button"
                  onClick={() => {
                    setBbEditing(false);
                    setBbToken("");
                    setBbErr(null);
                    setBbScopeHint(false);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-canvas-border px-3 py-2 text-[12px] font-medium text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      <p className="text-[10px] text-canvas-muted">
        Credentials are stored at <code>~/.claude/custom-atlassian/credentials.json</code> (mode
        0600). The Bitbucket half is also written into <code>~/.claude.json</code> as the env block
        of the <code>bitbucket</code> MCP server. Disconnecting one half leaves the other in place.
      </p>
    </div>
  );
}
