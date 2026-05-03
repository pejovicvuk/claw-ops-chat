/**
 * Phase 5a (#131): pure helpers for navigation-history state derived
 * from CDP `Page.getNavigationHistory`. Extracted from `handler.ts`
 * so the dedup-on-change behavior is easy to unit-test without
 * spinning up a real Chromium tab.
 *
 * Wire shape (sent to client):
 *   { type: "history_state", canGoBack: boolean, canGoForward: boolean }
 */

export interface NavigationHistory {
  currentIndex: number;
  entries: { id: number; url: string }[];
}

export interface HistoryButtonState {
  canGoBack: boolean;
  canGoForward: boolean;
}

export function computeHistoryState(hist: NavigationHistory): HistoryButtonState {
  return {
    canGoBack: hist.currentIndex > 0,
    canGoForward: hist.currentIndex < hist.entries.length - 1,
  };
}

/**
 * Dedup helper: holds the last-emitted state and decides whether the
 * caller should send a new frame. Reuse one instance per WS connection
 * — the dedup is per-stream, not per-process.
 */
export class HistoryStateDeduper {
  private lastCanGoBack: boolean | null = null;
  private lastCanGoForward: boolean | null = null;

  /**
   * Returns the next state to send, or `null` if it's identical to
   * the last-sent state and the frame should be skipped.
   */
  shouldEmit(state: HistoryButtonState): HistoryButtonState | null {
    if (state.canGoBack === this.lastCanGoBack && state.canGoForward === this.lastCanGoForward) {
      return null;
    }
    this.lastCanGoBack = state.canGoBack;
    this.lastCanGoForward = state.canGoForward;
    return state;
  }
}
