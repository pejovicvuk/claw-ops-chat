/**
 * Time-series ring buffer storing (timestamp_ms, value) pairs. Used by
 * the long-history extension so the multi-series chart can plot up to 1h
 * of data per metric (3600 samples at 1Hz = ~58KB of memory per buffer).
 *
 * Distinct from the bare numeric `RingBuffer` because we need real
 * timestamps for X-axis alignment when collectors tick at different
 * cadences. Uses two parallel Float64Arrays for cache locality.
 */
export class TimeSeriesBuffer {
  private readonly times: Float64Array;
  private readonly values: Float64Array;
  private nextIdx = 0;
  private len = 0;

  constructor(public readonly capacity: number) {
    if (capacity <= 0) throw new Error("TimeSeriesBuffer capacity must be > 0");
    this.times = new Float64Array(capacity);
    this.values = new Float64Array(capacity);
  }

  push(t: number, v: number): void {
    this.times[this.nextIdx] = t;
    this.values[this.nextIdx] = v;
    this.nextIdx = (this.nextIdx + 1) % this.capacity;
    if (this.len < this.capacity) this.len += 1;
  }

  get length(): number {
    return this.len;
  }

  /**
   * Snapshot to `{ t, v }[]` ordered oldest → newest, optionally clipped
   * to `[fromMs, toMs]`. Allocates a new array each call.
   */
  toRange(fromMs?: number, toMs?: number): Array<{ t: number; v: number }> {
    const out: Array<{ t: number; v: number }> = [];
    const startIdx = this.len < this.capacity ? 0 : this.nextIdx;
    for (let i = 0; i < this.len; i += 1) {
      const idx = (startIdx + i) % this.capacity;
      const t = this.times[idx];
      const v = this.values[idx];
      if (fromMs !== undefined && t < fromMs) continue;
      if (toMs !== undefined && t > toMs) continue;
      out.push({ t, v });
    }
    return out;
  }

  clear(): void {
    this.nextIdx = 0;
    this.len = 0;
  }
}
