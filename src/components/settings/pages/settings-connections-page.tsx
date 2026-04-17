"use client";

import { useEffect, useState } from "react";
import { FiTerminal, FiGithub, FiGitBranch, FiCloud, FiPackage } from "react-icons/fi";
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
  const [mcpServers, setMcpServers] = useState<McpServerInfo[] | null>(null);
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

  const googleStatus = aggregateStatus(mcpServers, GOOGLE_IDS);
  const microsoftStatus = singleStatus(mcpServers, "microsoft-365");

  return (
    <div className="space-y-2">
      <p className="mb-3 text-[11px] text-canvas-muted">
        Connect your accounts and tools so Claude can work with your data. Click any connection to
        manage its settings.
      </p>

      <ConnectionRow
        icon={<FiTerminal size={16} className="text-accent" />}
        name="Claude Code"
        description="Local CLI for AI-powered development"
        status={claudeStatus}
        onClick={() => setParam("settings", "connections/claude")}
      />

      <ConnectionRow
        icon={<FiGithub size={16} />}
        name="GitHub"
        description="Access repositories, issues, and pull requests"
        status="coming-soon"
      />

      <ConnectionRow
        icon={<FiGitBranch size={16} />}
        name="Bitbucket"
        description="Access repositories and pull requests"
        status="coming-soon"
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
    </div>
  );
}
