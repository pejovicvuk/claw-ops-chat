"use client";

/**
 * Client-side authentication state.
 *
 * Stores the authenticated user and JWT refresh token in localStorage.
 * Access token is kept in memory only (see apiClient.ts).
 */

import type { AuthUser } from "./api-backend";
import { refreshTokenApi } from "./api-backend";
import { setAccessToken } from "./apiClient";

const STORAGE_KEY = "claw-chat-auth:v1";
const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

export interface StoredAuth {
  user: AuthUser;
  refreshToken: string;
}

/** Persist the authenticated user and refresh token in localStorage. */
export function setAuth(user: AuthUser, refreshToken: string): void {
  if (typeof window === "undefined") return;
  const stored: StoredAuth = { user, refreshToken };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
}

/** Update only the refresh token in the stored auth record (after token rotation). */
export function updateStoredRefreshToken(refreshToken: string): void {
  if (typeof window === "undefined") return;
  const stored = getStoredAuth();
  if (!stored) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...stored, refreshToken }));
}

/** Read the full stored auth record, or null if not logged in. */
export function getStoredAuth(): StoredAuth | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredAuth;
  } catch {
    return null;
  }
}

/** Read the stored user, or null if not logged in. */
export function getUser(): AuthUser | null {
  return getStoredAuth()?.user ?? null;
}

/** Clear auth state from localStorage (logout). */
export function clearAuth(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
  sessionStorage.removeItem("claw-chat-token:v1");
}

/** Boolean convenience — is the user currently authenticated (has a refresh token)? */
export function isAuthenticated(): boolean {
  return !!getStoredAuth()?.refreshToken;
}

/* ------------------------------------------------------------------ */
/*  Silent session-cookie recovery                                     */
/* ------------------------------------------------------------------ */

let _inFlightRefresh: Promise<boolean> | null = null;

/**
 * Refresh the local `claw-session` cookie by exchanging the stored Spring
 * refresh token for a fresh access token and posting it to
 * `POST /chat/api/auth/session`. Concurrent callers share one in-flight
 * refresh to avoid token churn.
 */
async function refreshSessionCookie(): Promise<boolean> {
  if (_inFlightRefresh) return _inFlightRefresh;

  const stored = getStoredAuth();
  if (!stored?.refreshToken) return false;

  _inFlightRefresh = (async () => {
    try {
      const tokens = await refreshTokenApi(stored.refreshToken);
      setAccessToken(tokens.accessToken);
      updateStoredRefreshToken(tokens.refreshToken);

      const res = await fetch(`${BASE}/api/auth/session`, {
        method: "POST",
        credentials: "same-origin",
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      _inFlightRefresh = null;
    }
  })();

  return _inFlightRefresh;
}

/**
 * Authenticated fetch for local chat API routes.
 * Relies on the httpOnly session cookie (sent automatically by the browser).
 *
 * If the request 401s, we try once to silently refresh the cookie by
 * trading the stored Spring refresh token for a fresh access token and
 * re-posting to `/chat/api/auth/session`. On success, the original request
 * is retried exactly once. On failure, the original 401 is returned.
 */
export async function authFetch(path: string, init?: RequestInit): Promise<Response> {
  const doFetch = () => fetch(path, { ...init, credentials: "same-origin" });

  const first = await doFetch();
  if (first.status !== 401) return first;

  // Avoid infinite loops when the session endpoint itself is the one 401'ing.
  if (path.includes("/api/auth/session")) return first;

  const refreshed = await refreshSessionCookie();
  if (!refreshed) return first;

  // init may have a single-use ReadableStream body; for our file callers we
  // only ever use FormData / JSON / undefined, all safely re-sent by fetch.
  return doFetch();
}
