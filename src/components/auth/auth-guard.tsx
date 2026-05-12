"use client";

import { useEffect, useSyncExternalStore, useState } from "react";
import { useRouter } from "next/navigation";
import { isAuthenticated, getStoredAuth, clearAuth, updateStoredRefreshToken } from "@/lib/auth";
import { getAccessToken, setAccessToken, clearAccessToken } from "@/lib/apiClient";
import { refreshTokenApi } from "@/lib/api-backend";
import { AppSkeleton } from "@/components/app-skeleton";

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

  // Initialize ready=true if we already have an access token in memory (avoids flash).
  const hasToken = useSyncExternalStore(
    emptySubscribe,
    () => isAuthenticated() && !!getAccessToken(),
    () => false,
  );
  const [ready, setReady] = useState(hasToken);

  useEffect(() => {
    if (!mounted || ready) return;

    if (!isAuthenticated()) {
      router.replace("/login");
      return;
    }

    // Token already in memory — handled by initial state above.
    // If we reach here, we need to refresh.
    const stored = getStoredAuth();
    if (!stored?.refreshToken) {
      router.replace("/login");
      return;
    }

    let cancelled = false;
    refreshTokenApi(stored.refreshToken)
      .then(async ({ accessToken, refreshToken }) => {
        if (cancelled) return;
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
        if (cancelled) return;
        clearAuth();
        clearAccessToken();
        router.replace("/login");
      });

    return () => {
      cancelled = true;
    };
  }, [mounted, ready, router]);

  if (!mounted) return null;
  // While the refresh round-trip is in flight, show a shimmer of the app shell
  // instead of a blank screen. Users with stored auth see "app is loading"
  // rather than nothing.
  if (!ready) {
    if (!isAuthenticated()) return null; // redirect queued by effect
    return <AppSkeleton />;
  }

  // Wrap the chat tree in a same-origin fade-in so the skeleton → ready
  // transition reads as a soft handoff instead of a hard cut. Key off `ready`
  // so the animation only plays on the rising edge — subsequent re-renders
  // don't re-trigger it.
  return (
    <div key="auth-ready" className="animate-subpage-in">
      {children}
    </div>
  );
}
