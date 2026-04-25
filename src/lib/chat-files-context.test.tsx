// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { ChatFilesProvider, useChatFiles, useReportChatFile } from "./chat-files-context";
import type { ReactNode } from "react";

function withProvider({ children }: { children: ReactNode }) {
  return <ChatFilesProvider>{children}</ChatFilesProvider>;
}

describe("ChatFilesProvider + useChatFiles", () => {
  it("starts with an empty path list", () => {
    const { result } = renderHook(() => useChatFiles(), { wrapper: withProvider });
    expect(result.current.paths).toEqual([]);
  });

  it("returns reported paths in stable sorted order", () => {
    const { result } = renderHook(() => useChatFiles(), { wrapper: withProvider });

    act(() => {
      result.current.reportPath("/root/c.ts");
      result.current.reportPath("/root/a.ts");
      result.current.reportPath("/root/b.ts");
    });

    expect(result.current.paths).toEqual(["/root/a.ts", "/root/b.ts", "/root/c.ts"]);
  });

  it("dedupes repeat reports of the same path", () => {
    const { result } = renderHook(() => useChatFiles(), { wrapper: withProvider });
    const firstSnapshot = result.current.paths;

    act(() => {
      result.current.reportPath("/root/a.ts");
    });
    const afterFirstAdd = result.current.paths;

    act(() => {
      result.current.reportPath("/root/a.ts"); // duplicate
    });

    expect(result.current.paths).toEqual(["/root/a.ts"]);
    // Same array reference because nothing changed.
    expect(result.current.paths).toBe(afterFirstAdd);
    // Original empty snapshot is the initial render's empty array.
    expect(firstSnapshot).toEqual([]);
  });

  it("ignores empty/falsy reports", () => {
    const { result } = renderHook(() => useChatFiles(), { wrapper: withProvider });

    act(() => {
      result.current.reportPath("");
      result.current.reportPath("/root/a.ts");
    });

    expect(result.current.paths).toEqual(["/root/a.ts"]);
  });

  it("returns an empty list and a no-op reporter outside a provider", () => {
    const { result } = renderHook(() => useChatFiles());
    expect(result.current.paths).toEqual([]);
    // Should not throw.
    act(() => {
      result.current.reportPath("/root/a.ts");
    });
    expect(result.current.paths).toEqual([]);
  });

  // Per-chat reset is handled by the standard React `key` prop on the
  // provider in `chat-view.tsx` — when sessionId changes the whole
  // subtree remounts, so the underlying ref + state are recreated.
  // That's a React framework guarantee, not project logic, so it isn't
  // re-tested here.
});

describe("useReportChatFile", () => {
  // The hook reports during a useEffect, so the surrounding hook's
  // returned paths reflect that effect after one render cycle.
  function useReportThenRead(path: string | null): readonly string[] {
    useReportChatFile(path);
    return useChatFiles().paths;
  }

  it("registers the path on mount", () => {
    const { result } = renderHook(() => useReportThenRead("/root/x.ts"), {
      wrapper: withProvider,
    });
    expect(result.current).toEqual(["/root/x.ts"]);
  });

  it("re-registers when the path prop changes", () => {
    const { result, rerender } = renderHook(
      ({ path }: { path: string | null }) => useReportThenRead(path),
      { wrapper: withProvider, initialProps: { path: "/root/x.ts" as string | null } },
    );
    expect(result.current).toEqual(["/root/x.ts"]);

    act(() => {
      rerender({ path: "/root/y.ts" });
    });
    expect(result.current).toEqual(["/root/x.ts", "/root/y.ts"]);
  });

  it("ignores null path", () => {
    const { result } = renderHook(() => useReportThenRead(null), {
      wrapper: withProvider,
    });
    expect(result.current).toEqual([]);
  });
});
