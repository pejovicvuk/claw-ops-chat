// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useExitAnimation } from "./use-exit-animation";

afterEach(() => {
  vi.useRealTimers();
});

describe("useExitAnimation", () => {
  it("starts unmounted when open=false", () => {
    const { result } = renderHook(() => useExitAnimation(false, 100));
    expect(result.current.mounted).toBe(false);
  });

  it("mounts immediately and transitions entering → open when opened", async () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ open }: { open: boolean }) => useExitAnimation(open, 100),
      { initialProps: { open: false } },
    );

    await act(async () => {
      rerender({ open: true });
    });
    expect(result.current.mounted).toBe(true);
    // After the next frame the hook flips to "open"
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(result.current.state).toBe("open");
  });

  it("plays exit state and unmounts after exitMs when closed", async () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ open }: { open: boolean }) => useExitAnimation(open, 100),
      { initialProps: { open: true } },
    );
    expect(result.current.mounted).toBe(true);

    await act(async () => {
      rerender({ open: false });
    });
    expect(result.current.state).toBe("exiting");
    expect(result.current.mounted).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(result.current.mounted).toBe(false);
  });

  it("cancels pending unmount timer if reopened mid-exit", async () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ open }: { open: boolean }) => useExitAnimation(open, 100),
      { initialProps: { open: true } },
    );

    await act(async () => {
      rerender({ open: false });
    });
    expect(result.current.state).toBe("exiting");

    // Reopen before the 100ms timer fires
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
      rerender({ open: true });
    });
    expect(result.current.mounted).toBe(true);

    // Advance past what would have been the original unmount time — must stay mounted
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(result.current.mounted).toBe(true);
  });
});
