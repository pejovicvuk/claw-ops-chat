"use client";

import { useEffect, useState } from "react";
import { FiTerminal, FiGithub, FiGitBranch, FiCloud, FiPackage } from "react-icons/fi";
import { SiLinear, SiJira, SiSlack, SiNotion, SiTrello } from "react-icons/si";
import { authFetch } from "@/lib/auth";
import { useUrlState } from "@/lib/use-url-state";
import { ConnectionRow, type ConnectionStatus } from "../connection-row";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

interface McpServerInfo {
  id: string;
  name: string;
  url: string | null;
  status: "connected" | "needs-auth" | "error";
}

/** IDs of MCP servers that belong to the Google Workspace group. */
const GOOGLE_IDS = new Set(["gmail", "google-drive", "google-calendar"]);

interface SimpleIntegrationStatus {
  /** GitHub: tokenSaved + registered; Bitbucket: saved. */
  connected: boolean;
}

/**
 * Derive an overall `ConnectionStatus` for a group of sub-services.
 * Returns "connected" only if ALL listed services are connected.
 */
function aggregateStatus(servers: McpServerInfo[] | null, ids: Set<string>): ConnectionStatus {
  if (!servers) return "unknown";
  const matching = servers.filter((s) => ids.has(s.id));
  if (matching.length === 0) return "disconnected";
  if (matching.every((s) => s.status === "connected")) return "connected";
  return "disconnected";
}

/** Status for a single MCP server (e.g., Microsoft 365). */
function singleStatus(servers: McpServerInfo[] | null, id: string): ConnectionStatus {
  if (!servers) return "unknown";
  const found = servers.find((s) => s.id === id);
  if (!found) return "disconnected";
  return found.status === "connected" ? "connected" : "disconnected";
}

export function SettingsConnectionsPage() {
  const [claudeStatus, setClaudeStatus] = useState<ConnectionStatus>("unknown");
  const [cliAvailable, setCliAvailable] = useState<boolean | null>(null);
  const [mcpServers, setMcpServers] = useState<McpServerInfo[] | null>(null);
  const [githubStatus, setGithubStatus] = useState<ConnectionStatus>("unknown");
  const [bitbucketStatus, setBitbucketStatus] = useState<ConnectionStatus>("unknown");
  const [linearStatus, setLinearStatus] = useState<ConnectionStatus>("unknown");
  const [jiraStatus, setJiraStatus] = useState<ConnectionStatus>("unknown");
  const [notionStatus, setNotionStatus] = useState<ConnectionStatus>("unknown");
  const [trelloStatus, setTrelloStatus] = useState<ConnectionStatus>("unknown");
  const { setParam } = useUrlState();

  // Claude Code auth status.
  useEffect(() => {
    let cancelled = false;
    authFetch(`${BASE}/api/claude-auth/status`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((auth) => {
        if (cancelled) return;
        setClaudeStatus(auth?.connected ? "connected" : "disconnected");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // CLI presence — swap the row description to nudge toward install when missing.
  useEffect(() => {
    let cancelled = false;
    authFetch(`${BASE}/api/setup/status`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((info: { available?: boolean } | null) => {
        if (cancelled) return;
        setCliAvailable(info?.available ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // MCP connector status (Google Workspace + Microsoft 365).
  useEffect(() => {
    let cancelled = false;
    authFetch(`${BASE}/api/mcp-status`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((data) => {
        if (cancelled) return;
        setMcpServers(Array.isArray(data?.servers) ? data.servers : []);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // GitHub + Bitbucket are simple token-based integrations — one status probe each.
  useEffect(() => {
    let cancelled = false;
    authFetch(`${BASE}/api/github-custom/status`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((data: { tokenSaved?: boolean; registered?: boolean } | null) => {
        if (cancelled) return;
        setGithubStatus(data?.tokenSaved && data?.registered ? "connected" : "disconnected");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    authFetch(`${BASE}/api/bitbucket-custom/status`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((data: SimpleIntegrationStatus | { saved?: boolean } | null) => {
        if (cancelled) return;
        const saved = (data as { saved?: boolean } | null)?.saved ?? false;
        setBitbucketStatus(saved ? "connected" : "disconnected");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    authFetch(`${BASE}/api/linear-custom/status`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((data: { tokenSaved?: boolean; registered?: boolean } | null) => {
        if (cancelled) return;
        setLinearStatus(data?.tokenSaved && data?.registered ? "connected" : "disconnected");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    authFetch(`${BASE}/api/jira-custom/status`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((data: { saved?: boolean } | null) => {
        if (cancelled) return;
        setJiraStatus(data?.saved ? "connected" : "disconnected");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    authFetch(`${BASE}/api/notion-custom/status`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((data: { tokenSaved?: boolean; registered?: boolean } | null) => {
        if (cancelled) return;
        setNotionStatus(data?.tokenSaved && data?.registered ? "connected" : "disconnected");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    authFetch(`${BASE}/api/trello-custom/status`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((data: { saved?: boolean } | null) => {
        if (cancelled) return;
        setTrelloStatus(data?.saved ? "connected" : "disconnected");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const googleStatus = aggregateStatus(mcpServers, GOOGLE_IDS);
  const microsoftStatus = singleStatus(mcpServers, "microsoft-365");
  const slackStatus = singleStatus(mcpServers, "slack");

  return (
    <div className="space-y-2">
      <p className="mb-3 text-[11px] text-canvas-muted">
        Connect your accounts and tools so Claude can work with your data. Click any connection to
        manage its settings.
      </p>

      <ConnectionRow
        icon={<FiTerminal size={16} className="text-accent" />}
        name="Claude Code"
        description={
          cliAvailable === false
            ? "Install required — click to set up"
            : "Local CLI for AI-powered development"
        }
        status={claudeStatus}
        onClick={() => setParam("settings", "connections/claude")}
      />

      <ConnectionRow
        icon={<FiGithub size={16} />}
        name="GitHub"
        description="Access repositories, issues, and pull requests"
        status={githubStatus}
        onClick={() => setParam("settings", "connections/github")}
      />

      <ConnectionRow
        icon={<FiGitBranch size={16} />}
        name="Bitbucket"
        description="Access repositories and pull requests (read-only)"
        status={bitbucketStatus}
        onClick={() => setParam("settings", "connections/bitbucket")}
      />

      <ConnectionRow
        icon={<FiCloud size={16} className="text-red-500" />}
        name="Google Workspace"
        description="Gmail, Drive, and Calendar"
        status={googleStatus}
        onClick={() => setParam("settings", "connections/google")}
      />

      <ConnectionRow
        icon={<FiPackage size={16} className="text-blue-500" />}
        name="Microsoft 365"
        description="Outlook, OneDrive, SharePoint, and Teams"
        status={microsoftStatus}
        onClick={() => setParam("settings", "connections/microsoft")}
      />

      <ConnectionRow
        icon={<SiSlack size={16} className="text-purple-500" />}
        name="Slack"
        description="Channels, DMs, and mentions"
        status={slackStatus}
        onClick={() => setParam("settings", "connections/slack")}
      />

      <ConnectionRow
        icon={<SiLinear size={16} />}
        name="Linear"
        description="Search, read, and create issues"
        status={linearStatus}
        onClick={() => setParam("settings", "connections/linear")}
      />

      <ConnectionRow
        icon={<SiJira size={16} className="text-blue-500" />}
        name="Jira"
        description="Access issues, sprints, and boards"
        status={jiraStatus}
        onClick={() => setParam("settings", "connections/jira")}
      />

      <ConnectionRow
        icon={<SiNotion size={16} />}
        name="Notion"
        description="Search and update pages and databases"
        status={notionStatus}
        onClick={() => setParam("settings", "connections/notion")}
      />

      <ConnectionRow
        icon={<SiTrello size={16} className="text-blue-500" />}
        name="Trello"
        description="Boards, lists, and cards"
        status={trelloStatus}
        onClick={() => setParam("settings", "connections/trello")}
      />
    </div>
  );
}
