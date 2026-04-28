"use client";

import { authFetch } from "@/lib/auth";
import { FileApiError } from "@/lib/api";
import type {
  DiffAgainst,
  GitBranchesResponse,
  GitCommitDiffResponse,
  GitDiffResponse,
  GitLogResponse,
  GitStatusResponse,
} from "@/lib/git/types";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

async function assertOk(res: Response, fallback: string): Promise<void> {
  if (res.ok) return;
  let body: { error?: string; code?: string } = {};
  try {
    body = await res.json();
  } catch {
    /* non-JSON error body — fall through to fallback message */
  }
  throw new FileApiError(res.status, body.error || `${fallback} (${res.status})`, body.code);
}

export async function getGitStatus(path: string): Promise<GitStatusResponse> {
  const res = await authFetch(`${BASE}/api/git/status?path=${encodeURIComponent(path)}`);
  await assertOk(res, "Failed to fetch git status");
  return res.json();
}

export async function getGitBranches(path: string): Promise<GitBranchesResponse> {
  const res = await authFetch(`${BASE}/api/git/branches?path=${encodeURIComponent(path)}`);
  await assertOk(res, "Failed to fetch git branches");
  return res.json();
}

export interface GitLogOptions {
  limit?: number;
  branch?: string;
}

export async function getGitLog(path: string, opts: GitLogOptions = {}): Promise<GitLogResponse> {
  const params = new URLSearchParams({ path });
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
  if (opts.branch) params.set("branch", opts.branch);
  const res = await authFetch(`${BASE}/api/git/log?${params.toString()}`);
  await assertOk(res, "Failed to fetch git log");
  return res.json();
}

export async function getGitDiff(
  path: string,
  against: DiffAgainst = "working",
): Promise<GitDiffResponse> {
  const params = new URLSearchParams({ path, against });
  const res = await authFetch(`${BASE}/api/git/diff?${params.toString()}`);
  await assertOk(res, "Failed to fetch git diff");
  return res.json();
}

export async function getGitCommitDiff(
  path: string,
  sha: string,
): Promise<GitCommitDiffResponse> {
  const params = new URLSearchParams({ path, sha });
  const res = await authFetch(`${BASE}/api/git/commit-diff?${params.toString()}`);
  await assertOk(res, "Failed to fetch commit diff");
  return res.json();
}
