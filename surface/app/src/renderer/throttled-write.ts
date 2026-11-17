/** Writes the latest value at most once per `ms`, after the first push of each burst. `flush` writes a waiting value now. */
export function throttledWrite<T>(write: (value: T) => void, ms: number): { push: (value: T) => void; flush: () => void } {
  let waiting: { value: T } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    if (!waiting) return;
    const { value } = waiting;
    waiting = undefined;
    write(value);
  };
  return {
    push(value) {
      waiting = { value };
      timer ??= setTimeout(flush, ms);
    },
    flush,
  };
}
