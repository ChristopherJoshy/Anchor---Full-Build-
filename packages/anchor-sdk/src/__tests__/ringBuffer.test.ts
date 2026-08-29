import { RingBuffer } from '../utils/ringBuffer';

describe('RingBuffer', () => {
  it('stores items in chronological order', () => {
    const buffer = new RingBuffer<number>(4);
    [10, 20, 30].forEach((value) => buffer.push(value));
    expect(buffer.toArray()).toEqual([10, 20, 30]);
    expect(buffer.size).toBe(3);
  });

  it('overwrites the oldest items when full', () => {
    const buffer = new RingBuffer<number>(3);
    [1, 2, 3, 4, 5].forEach((value) => buffer.push(value));
    expect(buffer.toArray()).toEqual([3, 4, 5]);
    expect(buffer.size).toBe(3);
    expect(buffer.capacity).toBe(3);
    expect(buffer.latest()).toBe(5);
  });

  it('returns undefined as latest when empty', () => {
    const buffer = new RingBuffer<string>(2);
    expect(buffer.latest()).toBeUndefined();
    expect(buffer.toArray()).toEqual([]);
    buffer.push('a');
    buffer.clear();
    expect(buffer.size).toBe(0);
    expect(buffer.latest()).toBeUndefined();
  });

  it('rejects invalid capacities', () => {
    expect(() => new RingBuffer(0)).toThrow(/capacity/);
    expect(() => new RingBuffer(2.5)).toThrow(/capacity/);
  });

  it('wraps correctly across the boundary with objects', () => {
    const buffer = new RingBuffer<{ t: number }>(2);
    buffer.push({ t: 1 });
    buffer.push({ t: 2 });
    buffer.push({ t: 3 });
    expect(buffer.toArray().map((item) => item.t)).toEqual([2, 3]);
  });
});
