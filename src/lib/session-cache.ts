"use client";

import type { ChatSession } from "./types";

const CACHE_KEY = "claw-sessions:v1";
const CACHE_TTL = 15_000; // 15 seconds — entries younger than this are "fresh"

interface CachedSessions {
  sessions: ChatSession[];
  timestamp: number;
}

/** Get cached session list, or null if no cache exists. */
export function getCachedSessions(): ChatSession[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached: CachedSessions = JSON.parse(raw);
    return cached.sessions;
  } catch {
    return null;
  }
}

/** Check if cached session data is still fresh (within TTL). */
export function isSessionCacheFresh(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return false;
    const cached: CachedSessions = JSON.parse(raw);
    return Date.now() - cached.timestamp < CACHE_TTL;
  } catch {
    return false;
  }
}

/** Store session list in cache. */
export function setCachedSessions(sessions: ChatSession[]): void {
  if (typeof window === "undefined") return;
  try {
    const item: CachedSessions = { sessions, timestamp: Date.now() };
    localStorage.setItem(CACHE_KEY, JSON.stringify(item));
  } catch {
    // localStorage full or disabled — ignore
  }
}

/** Clear the session cache (call after mutations). */
export function invalidateSessions(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(CACHE_KEY);
}
