import { describe, expect, it } from "vitest";
import { TimeSeriesBuffer } from "./timeseries-buffer";

describe("TimeSeriesBuffer", () => {
  it("starts empty", () => {
    const ts = new TimeSeriesBuffer(5);
    expect(ts.length).toBe(0);
    expect(ts.toRange()).toEqual([]);
  });

  it("pushes and orders oldest -> newest", () => {
    const ts = new TimeSeriesBuffer(10);
    ts.push(100, 1);
    ts.push(200, 2);
    ts.push(300, 3);
    expect(ts.toRange()).toEqual([
      { t: 100, v: 1 },
      { t: 200, v: 2 },
      { t: 300, v: 3 },
    ]);
  });

  it("evicts oldest when over capacity", () => {
    const ts = new TimeSeriesBuffer(3);
    ts.push(1, 10);
    ts.push(2, 20);
    ts.push(3, 30);
    ts.push(4, 40);
    expect(ts.toRange()).toEqual([
      { t: 2, v: 20 },
      { t: 3, v: 30 },
      { t: 4, v: 40 },
    ]);
  });

  it("clips to [from, to]", () => {
    const ts = new TimeSeriesBuffer(10);
    for (let i = 0; i < 10; i += 1) ts.push(i * 100, i);
    expect(ts.toRange(200, 500)).toEqual([
      { t: 200, v: 2 },
      { t: 300, v: 3 },
      { t: 400, v: 4 },
      { t: 500, v: 5 },
    ]);
  });

  it("clears", () => {
    const ts = new TimeSeriesBuffer(3);
    ts.push(1, 1);
    ts.clear();
    expect(ts.length).toBe(0);
    expect(ts.toRange()).toEqual([]);
  });

  it("rejects non-positive capacity", () => {
    expect(() => new TimeSeriesBuffer(0)).toThrow();
  });
});
