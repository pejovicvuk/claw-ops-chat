import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetFileChangeBus,
  emitFileChange,
  subscribeFileChange,
  type FileChangeEvent,
} from "./file-change-bus";

function event(path: string, overrides: Partial<FileChangeEvent> = {}): FileChangeEvent {
  return { path, mtimeMs: 1000, source: "test", deleted: false, ...overrides };
}

beforeEach(() => {
  _resetFileChangeBus();
});

describe("file-change-bus", () => {
  it("delivers an event to a single matching subscriber", () => {
    const cb = vi.fn();
    subscribeFileChange("/a", cb);
    emitFileChange(event("/a"));
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ path: "/a" }));
  });

  it("does not deliver events to subscribers of other paths", () => {
    const onA = vi.fn();
    const onB = vi.fn();
    subscribeFileChange("/a", onA);
    subscribeFileChange("/b", onB);
    emitFileChange(event("/a"));
    expect(onA).toHaveBeenCalledTimes(1);
    expect(onB).not.toHaveBeenCalled();
  });

  it("delivers a single event to multiple subscribers of the same path", () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    subscribeFileChange("/shared", cb1);
    subscribeFileChange("/shared", cb2);
    emitFileChange(event("/shared", { mtimeMs: 42 }));
    expect(cb1).toHaveBeenCalledWith(expect.objectContaining({ mtimeMs: 42 }));
    expect(cb2).toHaveBeenCalledWith(expect.objectContaining({ mtimeMs: 42 }));
  });

  it("stops delivering after unsubscribe", () => {
    const cb = vi.fn();
    const off = subscribeFileChange("/a", cb);
    emitFileChange(event("/a"));
    off();
    emitFileChange(event("/a"));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("isolates listener errors from other subscribers on the same path", () => {
    const onError = vi.fn(() => {
      throw new Error("boom");
    });
    const onOk = vi.fn();
    subscribeFileChange("/a", onError);
    subscribeFileChange("/a", onOk);
    emitFileChange(event("/a"));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onOk).toHaveBeenCalledTimes(1);
  });

  it("handles emit with no subscribers without throwing", () => {
    expect(() => emitFileChange(event("/nobody-listening"))).not.toThrow();
  });

  it("propagates the deleted flag to subscribers", () => {
    const cb = vi.fn();
    subscribeFileChange("/d", cb);
    emitFileChange(event("/d", { deleted: true, mtimeMs: null }));
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ deleted: true, mtimeMs: null }));
  });
});
