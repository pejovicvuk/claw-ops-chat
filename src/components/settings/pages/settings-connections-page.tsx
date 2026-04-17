"use client";

import { useEffect, useState } from "react";
import { FiTerminal, FiGithub, FiGitBranch, FiMail, FiInbox } from "react-icons/fi";
import { authFetch } from "@/lib/auth";
import { useUrlState } from "@/lib/use-url-state";
import { ConnectionRow, type ConnectionStatus } from "../connection-row";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

/**
 * Connections page — lists available integrations and their status.
 * Future work: each row navigates to its own sub-page for login/logout/config.
 */
export function SettingsConnectionsPage() {
  const [claudeStatus, setClaudeStatus] = useState<ConnectionStatus>("unknown");
  const { setParam } = useUrlState();

  // Fetch Claude Code availability — combines health check AND OAuth credential check.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      authFetch(`${BASE}/api/health`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      authFetch(`${BASE}/api/claude-auth/status`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ]).then(([health, auth]) => {
      if (cancelled) return;
      const binaryAvailable = !!health?.claude?.available;
      const authConnected = !!auth?.connected;
      // Show "connected" only if both CLI is installed AND user is logged in.
      setClaudeStatus(binaryAvailable && authConnected ? "connected" : "disconnected");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-2">
      <p className="mb-3 text-[11px] text-canvas-muted">
        Connect your accounts and tools so Claude can work with your data. Per-connection
        configuration opens in a separate page.
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
        icon={<FiMail size={16} />}
        name="Gmail"
        description="Read and send email via MCP"
        status="coming-soon"
      />

      <ConnectionRow
        icon={<FiInbox size={16} />}
        name="Outlook"
        description="Read and send email via MCP"
        status="coming-soon"
      />
    </div>
  );
}
