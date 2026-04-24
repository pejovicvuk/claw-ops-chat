"use client";

import { useCallback, useEffect, useState } from "react";
import { FiAlertTriangle, FiCheck, FiLoader, FiTrash2 } from "react-icons/fi";
import { authFetch } from "@/lib/auth";
import { SettingsSection } from "../settings-section";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

interface SystemPromptRecord {
  prompt: string;
  updatedAt: number | null;
}

/**
 * System-prompt editor. The whole textarea content is saved as the
 * `append` string the server hands the Claude Agent SDK. Loads the
 * current value on mount, lets the user save/delete, and surfaces
 * a green banner when a saved prompt is live.
 */
export function SettingsAgentSystemPromptPage() {
  const [prompt, setPrompt] = useState("");
  const [initial, setInitial] = useState("");
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(`${BASE}/api/agent-config/system-prompt`);
      if (!res.ok) throw new Error("status");
      const data = (await res.json()) as SystemPromptRecord;
      setPrompt(data.prompt);
      setInitial(data.prompt);
      setUpdatedAt(data.updatedAt);
    } catch {
      setPrompt("");
      setInitial("");
      setUpdatedAt(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setErr(null);
    try {
      const res = await authFetch(`${BASE}/api/agent-config/system-prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Save failed (${res.status})`);
      }
      setInitial(prompt);
      setSavedAt(Date.now());
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save prompt");
    } finally {
      setSaving(false);
    }
  }, [prompt, saving, refresh]);

  const clear = useCallback(async () => {
    setSaving(true);
    setErr(null);
    try {
      const res = await authFetch(`${BASE}/api/agent-config/system-prompt`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("delete failed");
      setPrompt("");
      setInitial("");
      setSavedAt(null);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to clear prompt");
    } finally {
      setSaving(false);
    }
  }, [refresh]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-canvas-muted">
        <FiLoader size={14} className="animate-spin" />
      </div>
    );
  }

  const dirty = prompt !== initial;
  const hasSaved = initial.trim().length > 0;

  return (
    <div className="space-y-4">
      {hasSaved && !dirty && savedAt === null && (
        <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-4">
          <div className="mb-1 flex items-center gap-2">
            <FiCheck size={14} className="text-green-500" />
            <span className="text-[13px] font-medium text-canvas-fg">System prompt active</span>
          </div>
          <p className="text-[12px] text-canvas-muted">
            These instructions are appended to Claude&apos;s default system prompt on every turn
            {updatedAt ? ` (last updated ${formatRelative(updatedAt)})` : ""}.
          </p>
        </div>
      )}

      {savedAt !== null && !dirty && (
        <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-4">
          <div className="flex items-center gap-2">
            <FiCheck size={14} className="text-green-500" />
            <span className="text-[13px] font-medium text-canvas-fg">Saved</span>
          </div>
        </div>
      )}

      <SettingsSection
        title="System prompt"
        description="Free-form instructions Claude sees at the start of every session"
      >
        <div className="space-y-3">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={PLACEHOLDER}
            className="min-h-[240px] w-full resize-y rounded-lg border border-canvas-border bg-canvas-bg px-3 py-2 font-mono text-[12px] leading-relaxed text-canvas-fg placeholder:text-canvas-muted/60 focus:border-accent focus:outline-none"
            rows={12}
            spellCheck={false}
          />

          {err && (
            <p className="flex items-center gap-1 text-[11px] text-red-500">
              <FiAlertTriangle size={10} />
              {err}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={!dirty || saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[12px] font-medium text-white transition-colors hover:opacity-90 disabled:opacity-40"
            >
              {saving ? (
                <>
                  <FiLoader size={11} className="animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <FiCheck size={11} />
                  Save
                </>
              )}
            </button>

            {hasSaved && (
              <button
                type="button"
                onClick={clear}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/10 px-3 py-2 text-[12px] font-medium text-red-500 transition-colors hover:bg-red-500/15 disabled:opacity-40"
              >
                <FiTrash2 size={11} />
                Clear
              </button>
            )}
          </div>
        </div>
      </SettingsSection>

      <p className="px-1 text-[10px] leading-relaxed text-canvas-muted">
        Saved to{" "}
        <code className="rounded bg-canvas-surface px-1 py-0.5">
          $CLAUDE_CWD/.claude/custom-system-prompt.md
        </code>
        . Applied on the next Claude turn — no restart needed.
      </p>
    </div>
  );
}

const PLACEHOLDER = `You are running on a Linux server that I control via my phone. You have:
- apt, git, docker, node, python available.
- Access to projects under /root/projects.
- Permission to install packages and run long-running commands.

When asked to do something risky, confirm first.`;

function formatRelative(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`;
  return `${Math.floor(diff / 86_400_000)} d ago`;
}
