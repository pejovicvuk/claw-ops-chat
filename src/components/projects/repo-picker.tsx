"use client";

import { useMemo, useRef, useState } from "react";
import { FiRefreshCw, FiSearch } from "react-icons/fi";
import { formatRelativeTime } from "@/lib/format-time";
import type { RepoSummary } from "@/lib/repos-api";
import { useRepos } from "@/lib/use-repos";
import type { RepoKind } from "@/lib/projects/validation";

interface RepoPickerProps {
  kind: RepoKind;
  /** Called with the canonical clone URL when a row is clicked. */
  onPick: (cloneUrl: string) => void;
  /**
   * Clone URL currently in flight (e.g. when this picker triggered an
   * import that hasn't returned yet). Disables every other row + flips
   * the matching row's label to "Cloning…".
   */
  importingUrl: string | null;
}

/**
 * Search + scrollable list of the user's connected repos. Click-to-import:
 * the row's `cloneUrl` is handed straight to the existing `cloneRepo`
 * pipeline — no separate confirmation step.
 */
export function RepoPicker({ kind, onPick, importingUrl }: RepoPickerProps) {
  const { repos, loading, error, truncated, refresh } = useRepos(kind);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter((r) => {
      if (r.fullName.toLowerCase().includes(q)) return true;
      if (r.name.toLowerCase().includes(q)) return true;
      if (r.description && r.description.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [query, repos]);

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <div className="relative flex-1">
          <FiSearch
            size={12}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-canvas-muted"
          />
          <input
            ref={inputRef}
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search your ${kind === "github" ? "GitHub" : "Bitbucket"} repos`}
            className="w-full rounded-lg border border-canvas-border bg-canvas-bg py-1.5 pl-7 pr-3 text-[12px] text-canvas-fg outline-none focus:border-canvas-fg"
          />
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="btn-press flex h-7 w-7 items-center justify-center rounded-md text-canvas-muted hover:bg-canvas-bg hover:text-canvas-fg disabled:opacity-60"
          aria-label="Refresh"
          title="Refresh"
        >
          <FiRefreshCw size={12} className={loading ? "animate-spin" : undefined} />
        </button>
      </div>

      <div className="mt-2 max-h-[260px] overflow-y-auto rounded-lg border border-canvas-border bg-canvas-bg">
        {loading && repos.length === 0 ? (
          <Skeleton />
        ) : error ? (
          <ErrorState message={error} onRetry={refresh} />
        ) : repos.length === 0 ? (
          <Empty>No repositories found.</Empty>
        ) : filtered.length === 0 ? (
          <Empty>No matches for &ldquo;{query.trim()}&rdquo;.</Empty>
        ) : (
          <ul className="divide-y divide-canvas-border">
            {filtered.map((repo) => (
              <Row
                key={repo.cloneUrl}
                repo={repo}
                disabled={importingUrl !== null && importingUrl !== repo.cloneUrl}
                importing={importingUrl === repo.cloneUrl}
                onClick={() => onPick(repo.cloneUrl)}
              />
            ))}
          </ul>
        )}
      </div>

      {truncated && (
        <p className="mt-1.5 text-[11px] text-canvas-muted">
          Showing 100 most recent — paste a URL below to import older repos.
        </p>
      )}
    </div>
  );
}

function Row({
  repo,
  disabled,
  importing,
  onClick,
}: {
  repo: RepoSummary;
  disabled: boolean;
  importing: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || importing}
        title={repo.description ?? undefined}
        className="row-hover focus-ring flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-canvas-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="line-clamp-1 text-[13px] font-medium text-canvas-fg">{repo.name}</span>
            {repo.private && (
              <span className="rounded-full bg-canvas-surface-hover px-1.5 py-0.5 text-[9px] font-medium text-canvas-muted">
                private
              </span>
            )}
          </span>
          <span className="mt-0.5 line-clamp-1 text-[11px] text-canvas-muted">
            {repo.fullName}
            {repo.pushedAt > 0 && ` · pushed ${formatRelativeTime(repo.pushedAt)}`}
          </span>
        </span>
        <span className="shrink-0 text-[11px] font-medium text-canvas-muted">
          {importing ? "Cloning…" : "Import →"}
        </span>
      </button>
    </li>
  );
}

function Skeleton() {
  return (
    <ul className="divide-y divide-canvas-border">
      {Array.from({ length: 5 }).map((_, i) => (
        <li key={i} className="px-3 py-2.5">
          <div
            className="h-3 w-1/2 rounded bg-canvas-surface-hover/70 animate-pulse"
            style={{ animationDelay: `${i * 80}ms` }}
          />
          <div
            className="mt-1.5 h-2.5 w-1/3 rounded bg-canvas-surface-hover/40 animate-pulse"
            style={{ animationDelay: `${i * 80}ms` }}
          />
        </li>
      ))}
    </ul>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="px-3 py-6 text-center">
      <p className="text-[12px] text-red-500">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="btn-press mt-2 rounded-md px-2 py-1 text-[11px] text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
      >
        Try again
      </button>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-3 py-6 text-center text-[12px] text-canvas-muted">{children}</div>;
}
