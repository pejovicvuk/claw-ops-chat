"use client";

/**
 * Client-side authentication state.
 *
 * Stores the authenticated user and JWT refresh token in localStorage.
 * Access token is kept in memory only (see apiClient.ts).
 */

import type { AuthUser } from "./api-backend";

const STORAGE_KEY = "claw-chat-auth:v1";

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
  // Also clear legacy storage key
  sessionStorage.removeItem("claw-chat-token:v1");
}

/** Boolean convenience — is the user currently authenticated (has a refresh token)? */
export function isAuthenticated(): boolean {
  return !!getStoredAuth()?.refreshToken;
}

/**
 * Authenticated fetch for local chat API routes.
 * Relies on the httpOnly session cookie (sent automatically by the browser).
 * No Bearer header needed — the signed cookie handles auth.
 */
export async function authFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(path, { ...init, credentials: "same-origin" });
}
