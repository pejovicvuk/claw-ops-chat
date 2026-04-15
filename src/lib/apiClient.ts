/**
 * Spring backend API client with JWT Bearer token support.
 *
 * NEXT_PUBLIC_API_ORIGIN must be scheme + host ONLY — no trailing path:
 *   e.g. https://viksi.ai   NOT https://viksi.ai/api
 *
 * Auth flow:
 *  - Access token lives in memory (_accessToken). Set via setAccessToken().
 *  - On every request the Bearer header is added automatically.
 *  - If a 401 is returned, tryRefreshToken() exchanges the stored refresh
 *    token for a new pair, then the request is retried once.
 */

import { getStoredAuth, updateStoredRefreshToken } from "./auth";

declare global {
  interface Window {
    __CLAWCHAT_API_ORIGIN__?: string;
  }
}

function resolveApiOrigin(): string {
  if (typeof window !== "undefined" && window.__CLAWCHAT_API_ORIGIN__) {
    return window.__CLAWCHAT_API_ORIGIN__.replace(/\/+$/, "");
  }
  const envKey = "NEXT_PUBLIC_API_ORIGIN";
  const serverVal = typeof process !== "undefined" ? process.env[envKey] : undefined;
  return (serverVal ?? "http://localhost:8080").replace(/\/+$/, "");
}

export function getApiOrigin(): string {
  return resolveApiOrigin();
}

export function buildApiUrl(path: string): string {
  const origin = getApiOrigin();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${origin}${normalizedPath}`;
}

/* ------------------------------------------------------------------ */
/*  In-memory access token                                             */
/* ------------------------------------------------------------------ */

let _accessToken: string | null = null;

export function setAccessToken(token: string): void {
  _accessToken = token;
}

export function clearAccessToken(): void {
  _accessToken = null;
}

export function getAccessToken(): string | null {
  return _accessToken;
}

/* ------------------------------------------------------------------ */
/*  Transparent token refresh                                          */
/* ------------------------------------------------------------------ */

async function tryRefreshToken(): Promise<boolean> {
  const stored = getStoredAuth();
  if (!stored?.refreshToken) return false;
  try {
    const res = await fetch(buildApiUrl("/api/v1/auth/refresh"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: stored.refreshToken }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as {
      accessToken: string;
      refreshToken: string;
    };
    _accessToken = data.accessToken;
    updateStoredRefreshToken(data.refreshToken);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/*  apiFetch — for Spring backend calls only                           */
/* ------------------------------------------------------------------ */

export async function apiFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const makeRequest = (token: string | null) =>
    fetch(buildApiUrl(path), {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

  let res = await makeRequest(_accessToken);

  if (res.status === 401) {
    const refreshed = await tryRefreshToken();
    if (refreshed) {
      res = await makeRequest(_accessToken);
    }
  }

  return res;
}
