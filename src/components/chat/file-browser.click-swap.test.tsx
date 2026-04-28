// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, act } from "@testing-library/react";

const useIsMobileMock = vi.fn();

vi.mock("@/lib/use-is-mobile", () => ({
  useIsMobile: () => useIsMobileMock(),
}));

vi.mock("@/lib/use-file-listings", () => ({
  useFileListings: () => ({
    entries: [
      { name: "a.txt", path: "~/a.txt", directory: false, size: 10, mtime: 0 },
      { name: "subdir", path: "~/subdir", directory: true, size: 0, mtime: 0 },
    ],
    loading: false,
    error: null,
    reload: () => {},
  }),
}));

vi.mock("@/lib/use-git-status", () => ({
  useGitStatus: () => ({
    isRepo: false,
    files: [],
    branch: null,
    ahead: 0,
    behind: 0,
    loading: false,
    error: null,
    reload: () => {},
  }),
}));

vi.mock("@/lib/use-toast", () => ({
  useToast: () => ({ toast: { error: () => {}, success: () => {}, info: () => {} } }),
}));

vi.mock("@/lib/use-download", () => ({
  useDownload: () => ({ download: () => {}, abort: () => {}, progress: null }),
}));

vi.mock("@/lib/file-cache", () => ({
  invalidateDir: () => {},
}));

vi.mock("@/lib/use-workspace-index", () => ({
  invalidateWorkspaceIndex: () => {},
}));

import { FileBrowser } from "./file-browser";

describe("FileBrowser desktop click swap", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    useIsMobileMock.mockReset();
  });

  it("desktop single-click defers and then opens the file", () => {
    useIsMobileMock.mockReturnValue(false);
    const onFileClick = vi.fn();
    const onFileOpen = vi.fn();
    render(<FileBrowser onFileClick={onFileClick} onFileOpen={onFileOpen} />);

    const row = screen.getByTitle("~/a.txt");
    fireEvent.click(row);
    expect(onFileOpen).not.toHaveBeenCalled();
    expect(onFileClick).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(220);
    });

    expect(onFileOpen).toHaveBeenCalledTimes(1);
    expect(onFileClick).not.toHaveBeenCalled();
  });

  it("desktop double-click cancels the open and fires onFileClick", () => {
    useIsMobileMock.mockReturnValue(false);
    const onFileClick = vi.fn();
    const onFileOpen = vi.fn();
    render(<FileBrowser onFileClick={onFileClick} onFileOpen={onFileOpen} />);

    const row = screen.getByTitle("~/a.txt");
    fireEvent.click(row);
    fireEvent.doubleClick(row);

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(onFileOpen).not.toHaveBeenCalled();
    expect(onFileClick).toHaveBeenCalledWith("~/a.txt");
  });

  it("mobile single-click opens immediately without timer", () => {
    useIsMobileMock.mockReturnValue(true);
    const onFileClick = vi.fn();
    const onFileOpen = vi.fn();
    render(<FileBrowser onFileClick={onFileClick} onFileOpen={onFileOpen} />);

    const row = screen.getByTitle("~/a.txt");
    fireEvent.click(row);
    expect(onFileOpen).toHaveBeenCalledTimes(1);
    expect(onFileClick).not.toHaveBeenCalled();
  });

  it("directory click navigates synchronously (not deferred)", () => {
    useIsMobileMock.mockReturnValue(false);
    const onFileClick = vi.fn();
    const onFileOpen = vi.fn();
    render(<FileBrowser onFileClick={onFileClick} onFileOpen={onFileOpen} />);

    const row = screen.getByTitle("~/subdir");
    fireEvent.click(row);
    expect(onFileOpen).not.toHaveBeenCalled();
    expect(onFileClick).not.toHaveBeenCalled();
  });
});
