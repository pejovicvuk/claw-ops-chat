import { describe, expect, it } from "vitest";
import { RingBuffer } from "./ring-buffer";

describe("RingBuffer", () => {
  it("starts empty", () => {
    const rb = new RingBuffer(3);
    expect(rb.length).toBe(0);
    expect(rb.latest).toBe(null);
    expect(rb.oldest).toBe(null);
    expect(rb.toArray()).toEqual([]);
  });

  it("fills below capacity", () => {
    const rb = new RingBuffer(5);
    rb.push(1);
    rb.push(2);
    rb.push(3);
    expect(rb.length).toBe(3);
    expect(rb.latest).toBe(3);
    expect(rb.oldest).toBe(1);
    expect(rb.toArray()).toEqual([1, 2, 3]);
  });

  it("evicts oldest when over capacity", () => {
    const rb = new RingBuffer(3);
    rb.push(1);
    rb.push(2);
    rb.push(3);
    rb.push(4);
    rb.push(5);
    expect(rb.length).toBe(3);
    expect(rb.latest).toBe(5);
    expect(rb.oldest).toBe(3);
    expect(rb.toArray()).toEqual([3, 4, 5]);
  });

  it("computes mean and max", () => {
    const rb = new RingBuffer(4);
    rb.push(2);
    rb.push(4);
    rb.push(6);
    expect(rb.mean()).toBe(4);
    expect(rb.max()).toBe(6);
  });

  it("clears", () => {
    const rb = new RingBuffer(3);
    rb.push(1);
    rb.push(2);
    rb.clear();
    expect(rb.length).toBe(0);
    expect(rb.toArray()).toEqual([]);
  });

  it("rejects non-positive capacity", () => {
    expect(() => new RingBuffer(0)).toThrow();
    expect(() => new RingBuffer(-1)).toThrow();
  });
});
