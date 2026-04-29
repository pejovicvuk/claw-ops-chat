"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Snapshot of the GitHub / Bitbucket integration status for the import-
 * item tray. Both sides are fetched once at mount; the tray uses these
 * to disable buttons + show a "Connect first" hint.
 */

export interface IntegrationStatus {
  github: { connected: boolean; login: string | null };
  bitbucket: { connected: boolean; displayName: string | null };
  loading: boolean;
}

interface GithubStatus {
  tokenSaved: boolean;
  registered: boolean;
  login: string | null;
}

interface BitbucketStatus {
  saved: boolean;
  registered: boolean;
  displayName: string | null;
}

async function fetchGithub(): Promise<GithubStatus> {
  try {
    const res = await fetch("/chat/api/github-custom/status");
    if (!res.ok) return { tokenSaved: false, registered: false, login: null };
    const body = (await res.json()) as Partial<GithubStatus>;
    return {
      tokenSaved: Boolean(body.tokenSaved),
      registered: Boolean(body.registered),
      login: typeof body.login === "string" ? body.login : null,
    };
  } catch {
    return { tokenSaved: false, registered: false, login: null };
  }
}

async function fetchBitbucket(): Promise<BitbucketStatus> {
  try {
    const res = await fetch("/chat/api/bitbucket-custom/status");
    if (!res.ok) return { saved: false, registered: false, displayName: null };
    const body = (await res.json()) as Partial<BitbucketStatus>;
    return {
      saved: Boolean(body.saved),
      registered: Boolean(body.registered),
      displayName: typeof body.displayName === "string" ? body.displayName : null,
    };
  } catch {
    return { saved: false, registered: false, displayName: null };
  }
}

export function useIntegrationStatus(): IntegrationStatus & { refresh: () => Promise<void> } {
  const [status, setStatus] = useState<IntegrationStatus>({
    github: { connected: false, login: null },
    bitbucket: { connected: false, displayName: null },
    loading: true,
  });

  const refresh = useCallback(async () => {
    const [gh, bb] = await Promise.all([fetchGithub(), fetchBitbucket()]);
    setStatus({
      github: { connected: gh.tokenSaved && gh.registered, login: gh.login },
      bitbucket: { connected: bb.saved && bb.registered, displayName: bb.displayName },
      loading: false,
    });
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot fetch on mount, no external system to subscribe to
    refresh();
  }, [refresh]);

  return { ...status, refresh };
}
