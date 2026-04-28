// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const getGitCommitDiffMock = vi.fn();

vi.mock("@/lib/git-api", () => ({
  getGitCommitDiff: (...args: unknown[]) => getGitCommitDiffMock(...args),
}));

import { useCommitDiff } from "./use-commit-diff";

const STATS = { files: 1, insertions: 3, deletions: 1 };

describe("useCommitDiff", () => {
  beforeEach(() => {
    getGitCommitDiffMock.mockReset();
  });

  it("skips fetching when sha is null", async () => {
    const { result } = renderHook(() => useCommitDiff("/repo", null));
    expect(result.current.loading).toBe(false);
    expect(result.current.diff).toBe("");
    expect(getGitCommitDiffMock).not.toHaveBeenCalled();
  });

  it("loads diff + stats for a real sha", async () => {
    getGitCommitDiffMock.mockResolvedValueOnce({
      isRepo: true,
      found: true,
      isMerge: false,
      stats: STATS,
      diff: "@@ -1 +1 @@\n-x\n+y\n",
    });
    const { result } = renderHook(() => useCommitDiff("/repo", "abc123"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.diff).toContain("+y");
    expect(result.current.stats).toEqual(STATS);
    expect(result.current.found).toBe(true);
    expect(result.current.isMerge).toBe(false);
    expect(getGitCommitDiffMock).toHaveBeenCalledWith("/repo", "abc123");
  });

  it("uses the cache on a repeat fetch for the same sha", async () => {
    getGitCommitDiffMock.mockResolvedValueOnce({
      isRepo: true,
      found: true,
      isMerge: false,
      stats: STATS,
      diff: "first",
    });
    const { result, rerender, unmount } = renderHook(
      ({ sha }: { sha: string | null }) => useCommitDiff("/repo", sha),
      { initialProps: { sha: "deadbeef" as string | null } },
    );
    await waitFor(() => expect(result.current.diff).toBe("first"));
    expect(getGitCommitDiffMock).toHaveBeenCalledTimes(1);

    // Collapse and re-expand the same sha — the second mount should hit
    // the cache without firing another fetch.
    rerender({ sha: null });
    await waitFor(() => expect(result.current.diff).toBe(""));
    rerender({ sha: "deadbeef" });
    await waitFor(() => expect(result.current.diff).toBe("first"));
    expect(getGitCommitDiffMock).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("propagates the API's recoverable error string", async () => {
    getGitCommitDiffMock.mockResolvedValueOnce({
      isRepo: true,
      found: true,
      isMerge: false,
      stats: { files: 0, insertions: 0, deletions: 0 },
      diff: "",
      error: "diff too large",
    });
    const { result } = renderHook(() => useCommitDiff("/repo", "huge00"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("diff too large");
  });
});
