// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const getGitDiffMock = vi.fn();

vi.mock("@/lib/git-api", () => ({
  getGitDiff: (...args: unknown[]) => getGitDiffMock(...args),
}));

import { useGitDiff } from "./use-git-diff";

describe("useGitDiff", () => {
  beforeEach(() => {
    getGitDiffMock.mockReset();
  });

  it("loads a diff for a tracked file", async () => {
    getGitDiffMock.mockResolvedValueOnce({
      isRepo: true,
      tracked: true,
      diff: "@@ -1 +1 @@\n-old\n+new\n",
    });
    const { result } = renderHook(() => useGitDiff("~/a.txt", "working"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.diff).toContain("+new");
    expect(result.current.tracked).toBe(true);
    expect(result.current.isRepo).toBe(true);
    expect(result.current.error).toBeNull();
    expect(getGitDiffMock).toHaveBeenCalledWith("~/a.txt", "working");
  });

  it("re-fetches when `against` changes", async () => {
    getGitDiffMock
      .mockResolvedValueOnce({ isRepo: true, tracked: true, diff: "working" })
      .mockResolvedValueOnce({ isRepo: true, tracked: true, diff: "head" });
    const { result, rerender } = renderHook(
      ({ a }: { a: "working" | "head" | "staged" }) => useGitDiff("~/a.txt", a),
      { initialProps: { a: "working" } },
    );
    await waitFor(() => expect(result.current.diff).toBe("working"));

    rerender({ a: "head" });
    await waitFor(() => expect(result.current.diff).toBe("head"));
    expect(getGitDiffMock).toHaveBeenCalledTimes(2);
  });

  it("clears state when path becomes empty", async () => {
    getGitDiffMock.mockResolvedValueOnce({ isRepo: true, tracked: true, diff: "x" });
    const { result, rerender } = renderHook(({ p }: { p: string }) => useGitDiff(p, "working"), {
      initialProps: { p: "~/a.txt" },
    });
    await waitFor(() => expect(result.current.diff).toBe("x"));

    rerender({ p: "" });
    await waitFor(() => {
      expect(result.current.diff).toBe("");
      expect(result.current.tracked).toBe(false);
      expect(result.current.isRepo).toBe(false);
    });
  });

  it("propagates the API's recoverable error string", async () => {
    getGitDiffMock.mockResolvedValueOnce({
      isRepo: true,
      tracked: true,
      diff: "",
      error: "diff too large",
    });
    const { result } = renderHook(() => useGitDiff("~/big.bin", "working"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("diff too large");
  });

  it("reload() refetches the same path", async () => {
    getGitDiffMock
      .mockResolvedValueOnce({ isRepo: true, tracked: true, diff: "v1" })
      .mockResolvedValueOnce({ isRepo: true, tracked: true, diff: "v2" });
    const { result } = renderHook(() => useGitDiff("~/a.txt", "working"));
    await waitFor(() => expect(result.current.diff).toBe("v1"));

    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.diff).toBe("v2");
  });
});
