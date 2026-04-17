"use client";

import { useEffect, useSyncExternalStore, useState } from "react";
import { useRouter } from "next/navigation";
import { isAuthenticated, getStoredAuth, clearAuth, updateStoredRefreshToken } from "@/lib/auth";
import { getAccessToken, setAccessToken, clearAccessToken } from "@/lib/apiClient";
import { refreshTokenApi } from "@/lib/api-backend";

const emptySubscribe = () => () => {};

interface AuthGuardProps {
  children: React.ReactNode;
}

/**
 * Client-side route protection wrapper.
 *
 * On mount:
 *  1. No stored session → redirect to /login.
 *  2. Access token in memory → render immediately.
 *  3. Access token lost (page reload) → silently restore via refresh token,
 *     re-establish the local session cookie, then render.
 *  4. Restore fails → clear stale auth, redirect to /login.
 */
export function AuthGuard({ children }: AuthGuardProps) {
  const router = useRouter();

  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );

  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!mounted) return;

    if (!isAuthenticated()) {
      router.replace("/login");
      return;
    }

    if (getAccessToken()) {
      setReady(true);
      return;
    }

    const stored = getStoredAuth();
    if (!stored?.refreshToken) {
      router.replace("/login");
      return;
    }

    refreshTokenApi(stored.refreshToken)
      .then(async ({ accessToken, refreshToken }) => {
        setAccessToken(accessToken);
        updateStoredRefreshToken(refreshToken);

        // Re-establish the local session cookie
        const base = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";
        await fetch(`${base}/api/auth/session`, {
          method: "POST",
          credentials: "same-origin",
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        setReady(true);
      })
      .catch(() => {
        clearAuth();
        clearAccessToken();
        router.replace("/login");
      });
  }, [mounted, router]);

  if (!mounted || !ready) return null;

  return <>{children}</>;
}
