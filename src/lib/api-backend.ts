/**
 * Spring backend auth endpoint functions.
 * Ported from claw-ops-fe — only the auth-related subset.
 */

import { apiFetch, buildApiUrl } from "./apiClient";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type UserRole = "ADMIN" | "DEVOPS" | "EMPLOYEE" | "USER";

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  role: UserRole;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/* ------------------------------------------------------------------ */
/*  Auth endpoints                                                     */
/* ------------------------------------------------------------------ */

export async function loginApi(email: string, password: string): Promise<TokenResponse> {
  const res = await apiFetch("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    throw new ApiError(
      res.status,
      res.status === 401 || res.status === 403
        ? "Invalid email or password."
        : "Login failed. Please try again.",
    );
  }
  return res.json() as Promise<TokenResponse>;
}

export async function meApi(): Promise<AuthUser> {
  const res = await apiFetch("/api/v1/auth/me");
  if (!res.ok) throw new ApiError(res.status, "Failed to fetch user profile.");
  return res.json() as Promise<AuthUser>;
}

export async function refreshTokenApi(refreshToken: string): Promise<TokenResponse> {
  const res = await fetch(buildApiUrl("/api/v1/auth/refresh"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) throw new ApiError(res.status, "Session expired. Please sign in again.");
  return res.json() as Promise<TokenResponse>;
}

export async function logoutApi(refreshToken: string): Promise<void> {
  try {
    await apiFetch("/api/v1/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
  } catch {
    // ignore
  }
}
