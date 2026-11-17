import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { throttledWrite } from './throttled-write';

describe('throttledWrite', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('writes the latest value once per interval while pushes keep coming', () => {
    const write = vi.fn();
    const saver = throttledWrite(write, 300);
    saver.push('a');
    vi.advanceTimersByTime(100);
    saver.push('ab');
    vi.advanceTimersByTime(100);
    saver.push('abc');
    expect(write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(write.mock.calls).toEqual([['abc']]);
    saver.push('abcd');
    vi.advanceTimersByTime(300);
    expect(write.mock.calls).toEqual([['abc'], ['abcd']]);
  });

  it('writes a waiting value at once on flush, and nothing when none waits', () => {
    const write = vi.fn();
    const saver = throttledWrite(write, 300);
    saver.flush();
    saver.push('x');
    saver.flush();
    expect(write.mock.calls).toEqual([['x']]);
    vi.advanceTimersByTime(300);
    expect(write).toHaveBeenCalledTimes(1);
  });
});
