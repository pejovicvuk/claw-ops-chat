"use client";

import type { FileEntry } from "./types";

const CACHE_PREFIX = "claw-files:";
const CACHE_TTL = 30_000; // 30 seconds — entries younger than this are "fresh"
const MAX_CACHED_PATHS = 50;

interface CachedDir {
  entries: FileEntry[];
  timestamp: number;
}

/**
 * Get cached directory listing. Returns entries if cache exists (regardless of
 * freshness — caller decides whether to revalidate). Returns null if no cache.
 */
export function getCachedDir(path: string): FileEntry[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + path);
    if (!raw) return null;
    const cached: CachedDir = JSON.parse(raw);
    return cached.entries;
  } catch {
    return null;
  }
}

/** Check if cached data is still fresh (within TTL). */
export function isCacheFresh(path: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + path);
    if (!raw) return false;
    const cached: CachedDir = JSON.parse(raw);
    return Date.now() - cached.timestamp < CACHE_TTL;
  } catch {
    return false;
  }
}

/** Store directory listing in cache, evicting oldest entries if over limit. */
export function setCachedDir(path: string, entries: FileEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    const item: CachedDir = { entries, timestamp: Date.now() };
    localStorage.setItem(CACHE_PREFIX + path, JSON.stringify(item));
    evictIfNeeded();
  } catch {
    // localStorage full or disabled — ignore
  }
}

/** Remove a specific path from cache (call after mutations like upload/delete). */
export function invalidateDir(path: string): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(CACHE_PREFIX + path);
}

/** Clear all file cache entries. */
export function invalidateAll(): void {
  if (typeof window === "undefined") return;
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(CACHE_PREFIX)) keys.push(key);
  }
  for (const key of keys) localStorage.removeItem(key);
}

/** Evict oldest entries when cache exceeds MAX_CACHED_PATHS. */
function evictIfNeeded(): void {
  const items: { key: string; timestamp: number }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(CACHE_PREFIX)) continue;
    try {
      const cached: CachedDir = JSON.parse(localStorage.getItem(key)!);
      items.push({ key, timestamp: cached.timestamp });
    } catch {
      localStorage.removeItem(key!);
    }
  }

  if (items.length <= MAX_CACHED_PATHS) return;

  // Sort oldest first, remove excess
  items.sort((a, b) => a.timestamp - b.timestamp);
  const toRemove = items.length - MAX_CACHED_PATHS;
  for (let i = 0; i < toRemove; i++) {
    localStorage.removeItem(items[i].key);
  }
}
