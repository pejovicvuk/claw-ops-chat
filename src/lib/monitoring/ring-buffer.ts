/**
 * Fixed-capacity ring buffer for numeric time-series. Pushes evict the
 * oldest sample when full; reads are always returned oldest → newest.
 *
 * Used by every collector to maintain ~60-3600 sample history per metric
 * for sparkline rendering, without unbounded memory growth.
 */
export class RingBuffer {
  private readonly buf: Float64Array;
  private nextIdx = 0;
  private len = 0;

  constructor(public readonly capacity: number) {
    if (capacity <= 0) throw new Error("RingBuffer capacity must be > 0");
    this.buf = new Float64Array(capacity);
  }

  push(value: number): void {
    this.buf[this.nextIdx] = value;
    this.nextIdx = (this.nextIdx + 1) % this.capacity;
    if (this.len < this.capacity) this.len += 1;
  }

  /** Number of samples currently held (≤ capacity). */
  get length(): number {
    return this.len;
  }

  /** Most recently pushed value, or `null` if empty. */
  get latest(): number | null {
    if (this.len === 0) return null;
    const idx = (this.nextIdx - 1 + this.capacity) % this.capacity;
    return this.buf[idx];
  }

  /** Oldest sample, or `null` if empty. */
  get oldest(): number | null {
    if (this.len === 0) return null;
    const startIdx = this.len < this.capacity ? 0 : this.nextIdx;
    return this.buf[startIdx];
  }

  /**
   * Snapshot to a plain `number[]`, oldest → newest. Allocates a new array
   * each call — callers should memo on the buffer reference if they care
   * about reference identity.
   */
  toArray(): number[] {
    const out = new Array<number>(this.len);
    if (this.len < this.capacity) {
      for (let i = 0; i < this.len; i += 1) out[i] = this.buf[i];
      return out;
    }
    for (let i = 0; i < this.len; i += 1) {
      out[i] = this.buf[(this.nextIdx + i) % this.capacity];
    }
    return out;
  }

  /** Discard all samples. Capacity is preserved. */
  clear(): void {
    this.nextIdx = 0;
    this.len = 0;
  }

  /** Mean of all samples, or 0 if empty. */
  mean(): number {
    if (this.len === 0) return 0;
    let sum = 0;
    if (this.len < this.capacity) {
      for (let i = 0; i < this.len; i += 1) sum += this.buf[i];
    } else {
      for (let i = 0; i < this.capacity; i += 1) sum += this.buf[i];
    }
    return sum / this.len;
  }

  /** Maximum of all samples, or 0 if empty. */
  max(): number {
    if (this.len === 0) return 0;
    let max = -Infinity;
    if (this.len < this.capacity) {
      for (let i = 0; i < this.len; i += 1) if (this.buf[i] > max) max = this.buf[i];
    } else {
      for (let i = 0; i < this.capacity; i += 1) if (this.buf[i] > max) max = this.buf[i];
    }
    return max;
  }
}
