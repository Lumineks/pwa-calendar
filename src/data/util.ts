export interface Debounced<TArgs extends unknown[]> {
  (...args: TArgs): void;
  cancel(): void;
  flush(...args: TArgs): void;
}

export function debounce<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  ms: number,
): Debounced<TArgs> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pendingArgs: TArgs | undefined;

  const debounced = (...args: TArgs): void => {
    pendingArgs = args;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      const a = pendingArgs as TArgs;
      pendingArgs = undefined;
      fn(...a);
    }, ms);
  };

  debounced.cancel = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    pendingArgs = undefined;
  };

  debounced.flush = (...args: TArgs): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    pendingArgs = undefined;
    fn(...args);
  };

  return debounced;
}
