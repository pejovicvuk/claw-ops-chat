"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { loginApi, refreshTokenApi, ApiError, type AuthUser } from "@/lib/api-backend";
import { setAuth, getStoredAuth, updateStoredRefreshToken } from "@/lib/auth";
import { setAccessToken } from "@/lib/apiClient";

const emptySubscribe = () => () => {};

/**
 * Establish a local session cookie by calling the chat backend's
 * /api/auth/session endpoint with the Spring access token.
 * Returns the user object on success, throws on failure.
 */
async function establishSession(accessToken: string) {
  const base = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";
  const res = await fetch(`${base}/api/auth/session`, {
    method: "POST",
    credentials: "same-origin",
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 403) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(403, body.error || "This email is not authorized.");
  }
  if (!res.ok) {
    throw new ApiError(res.status, "Failed to establish session.");
  }

  return (await res.json()) as { user: AuthUser };
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  // Initialize loading=true when a stored refresh token exists (avoids flash of login form).
  const hasStoredToken = useSyncExternalStore(
    emptySubscribe,
    () => !!getStoredAuth()?.refreshToken,
    () => false,
  );
  const [loading, setLoading] = useState(hasStoredToken);

  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );

  // Auto-login: if a stored refresh token exists, silently restore the session.
  useEffect(() => {
    if (!mounted || !hasStoredToken) return;

    let cancelled = false;
    const stored = getStoredAuth();
    if (!stored?.refreshToken) return;

    refreshTokenApi(stored.refreshToken)
      .then(async ({ accessToken, refreshToken }) => {
        if (cancelled) return;
        setAccessToken(accessToken);
        updateStoredRefreshToken(refreshToken);
        await establishSession(accessToken);
        router.replace("/");
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [mounted, hasStoredToken, router]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setError("");
      const trimmedEmail = email.trim();
      if (!trimmedEmail || !password) {
        setError("Please enter your email and password.");
        return;
      }

      setLoading(true);
      try {
        // 1. Login against Spring backend
        const { accessToken, refreshToken } = await loginApi(trimmedEmail, password);
        setAccessToken(accessToken);

        // 2. Establish local session (validates email against ALLOWED_EMAIL)
        const { user } = await establishSession(accessToken);

        // 3. Persist auth state
        setAuth(user, refreshToken);
        router.replace("/");
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Login failed. Please try again.");
        setLoading(false);
      }
    },
    [email, password, router],
  );

  if (!mounted || loading) return null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas-bg p-4">
      <form onSubmit={handleSubmit} noValidate className="w-full max-w-sm space-y-4">
        <h1 className="text-center text-xl font-semibold text-canvas-fg">Claw Chat</h1>
        <p className="text-center text-sm text-canvas-muted">Sign in to continue</p>

        <div>
          <label
            htmlFor="login-email"
            className="mb-1.5 block text-xs font-medium text-canvas-muted"
          >
            Email
          </label>
          <input
            id="login-email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (error) setError("");
            }}
            autoFocus
            className="w-full rounded-lg border border-canvas-border bg-canvas-bg px-4 py-3 text-canvas-fg placeholder:text-canvas-muted focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label
            htmlFor="login-password"
            className="mb-1.5 block text-xs font-medium text-canvas-muted"
          >
            Password
          </label>
          <input
            id="login-password"
            type="password"
            required
            autoComplete="current-password"
            placeholder="Enter your password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (error) setError("");
            }}
            className="w-full rounded-lg border border-canvas-border bg-canvas-bg px-4 py-3 text-canvas-fg placeholder:text-canvas-muted focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {error && <p className="text-center text-sm text-red-500">{error}</p>}
        <button
          type="submit"
          disabled={!email.trim() || !password || loading}
          className="w-full rounded-lg bg-[#1f6feb] px-4 py-3 font-medium text-white disabled:opacity-50"
        >
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </div>
  );
}
