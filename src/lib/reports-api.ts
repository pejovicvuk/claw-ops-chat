import type { ReportJob, ReportRun, ReportsIndexEntry } from "./reports/types";

/**
 * Thin browser-side fetch helpers for the Reports API.
 *
 * All routes are scoped under /chat/api/reports per the app's basePath.
 * Every call sends cookies implicitly (`credentials: "include"` isn't
 * required for same-origin requests, but being explicit helps if we ever
 * move the backend behind a different origin).
 */

const BASE = "/chat/api/reports";

export interface JobRunCounts {
  total: number;
  success: number;
  error: number;
  running: number;
  lastRunAt: number | null;
}

export interface JobWithMeta extends ReportJob {
  nextRuns: string[];
  running: boolean;
  runCounts: JobRunCounts;
}

export interface RunsFeed {
  runs: ReportsIndexEntry[];
  unreadCount: number;
}

export interface ToolCatalogResponse {
  builtins: string[];
  mcpServers: Array<{ name: string; tools: string[] }>;
  defaults: string[];
}

export interface CronPreviewResponse {
  valid: boolean;
  error?: string;
  human?: string;
  nextRuns?: string[];
}

export interface ReportContentResponse {
  run: ReportRun | null;
  indexEntry: ReportsIndexEntry;
  content: string | null;
  truncated: boolean;
  sizeBytes: number;
}

export interface RunLogEvent {
  type: string;
  at: number;
  [key: string]: unknown;
}

export interface RunLogResponse {
  run: ReportRun | null;
  status: ReportRun["status"] | null;
  events: RunLogEvent[];
  total: number;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${path} ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

export async function fetchJobs(): Promise<{ jobs: JobWithMeta[] }> {
  return request("/jobs");
}

export async function fetchJob(slug: string): Promise<{ job: ReportJob; markdown: string }> {
  return request(`/jobs/${encodeURIComponent(slug)}`);
}

export async function createJob(markdown: string): Promise<{ job: ReportJob }> {
  return request("/jobs", { method: "POST", body: JSON.stringify({ markdown }) });
}

export async function updateJob(slug: string, markdown: string): Promise<{ job: ReportJob }> {
  return request(`/jobs/${encodeURIComponent(slug)}`, {
    method: "PUT",
    body: JSON.stringify({ markdown }),
  });
}

export async function deleteJob(slug: string, archive = true): Promise<{ ok: boolean }> {
  const qs = archive ? "" : "?archive=0";
  return request(`/jobs/${encodeURIComponent(slug)}${qs}`, { method: "DELETE" });
}

export async function runJobNow(slug: string): Promise<{ ok: boolean }> {
  return request(`/jobs/${encodeURIComponent(slug)}/run`, { method: "POST" });
}

export async function fetchJobRuns(slug: string): Promise<{ runs: ReportRun[] }> {
  return request(`/jobs/${encodeURIComponent(slug)}/runs`);
}

export async function fetchRuns(unreadOnly = false): Promise<RunsFeed> {
  return request(`/runs${unreadOnly ? "?unreadOnly=1" : ""}`);
}

export async function fetchReportContent(runId: string): Promise<ReportContentResponse> {
  return request(`/runs/${encodeURIComponent(runId)}`);
}

export async function fetchRunLog(runId: string, since = 0): Promise<RunLogResponse> {
  const qs = since > 0 ? `?since=${since}` : "";
  return request(`/runs/${encodeURIComponent(runId)}/log${qs}`);
}

export async function deleteRun(runId: string): Promise<{ ok: boolean }> {
  return request(`/runs/${encodeURIComponent(runId)}`, { method: "DELETE" });
}

export async function markRead(runId: string, read = true): Promise<{ ok: boolean }> {
  return request(`/runs/${encodeURIComponent(runId)}/read`, {
    method: "POST",
    body: JSON.stringify({ read }),
  });
}

export async function stopRun(runId: string): Promise<{ ok: boolean }> {
  return request(`/runs/${encodeURIComponent(runId)}/stop`, { method: "POST" });
}

export async function fetchToolCatalog(): Promise<ToolCatalogResponse> {
  return request("/catalog");
}

export async function fetchCronPreview(
  expr: string,
  timezone: string,
): Promise<CronPreviewResponse> {
  const qs = new URLSearchParams({ expr, timezone });
  return request(`/cron-preview?${qs.toString()}`);
}

export async function validateJobMarkdown(markdown: string) {
  return request<{
    valid: boolean;
    errors?: Array<{ field: string; message: string }>;
    job?: ReportJob;
  }>("/validate", { method: "POST", body: JSON.stringify({ markdown }) });
}
