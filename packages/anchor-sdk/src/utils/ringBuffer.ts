/**
 * Fixed-capacity FIFO ring buffer, shared by the sensor hooks to retain the
 * last N samples without unbounded memory growth.
 */
export class RingBuffer<T> {
  private readonly items: (T | undefined)[];
  private head = 0; // index of the oldest element
  private count = 0;

  constructor(public readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error(`RingBuffer capacity must be a positive integer, got ${capacity}`);
    }
    this.items = new Array<T | undefined>(capacity);
  }

  get size(): number {
    return this.count;
  }

  /** Appends an item, overwriting the oldest when full. */
  push(item: T): void {
    const tail = (this.head + this.count) % this.capacity;
    this.items[tail] = item;
    if (this.count < this.capacity) {
      this.count += 1;
    } else {
      this.head = (this.head + 1) % this.capacity;
    }
  }

  /** Newest item, or undefined when empty. */
  latest(): T | undefined {
    if (this.count === 0) return undefined;
    return this.items[(this.head + this.count - 1) % this.capacity];
  }

  /** Snapshot in chronological order (oldest first). */
  toArray(): T[] {
    const out: T[] = new Array(this.count);
    for (let i = 0; i < this.count; i += 1) {
      out[i] = this.items[(this.head + i) % this.capacity] as T;
    }
    return out;
  }

  clear(): void {
    this.items.fill(undefined);
    this.head = 0;
    this.count = 0;
  }
}
