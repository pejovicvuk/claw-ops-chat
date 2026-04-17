"use client";

import { useEffect, useState } from "react";
import { FiTerminal, FiGithub, FiGitBranch, FiMail, FiInbox } from "react-icons/fi";
import { authFetch } from "@/lib/auth";
import { ConnectionRow, type ConnectionStatus } from "../connection-row";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

/**
 * Connections page — lists available integrations and their status.
 * Future work: each row navigates to its own sub-page for login/logout/config.
 */
export function SettingsConnectionsPage() {
  const [claudeStatus, setClaudeStatus] = useState<ConnectionStatus>("unknown");

  // Fetch Claude Code availability from the existing health endpoint.
  useEffect(() => {
    let cancelled = false;
    authFetch(`${BASE}/api/health`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        setClaudeStatus(data?.claude?.available ? "connected" : "disconnected");
      })
      .catch(() => {
        if (!cancelled) setClaudeStatus("disconnected");
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
