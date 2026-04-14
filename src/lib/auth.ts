"use client";

const TOKEN_KEY = "claw-chat-token:v1";

/**
 * Get the auth token from sessionStorage.
 * Note: The primary auth mechanism is the httpOnly cookie set by /api/auth/verify.
 * This is only used for the WebSocket connection URL as a fallback.
 */
export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}

/**
 * Authenticated fetch. The httpOnly cookie is sent automatically by the browser.
 * The Authorization header is kept as a fallback for compatibility.
 */
export async function authFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init?.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(path, { ...init, headers, credentials: "same-origin" });
}
