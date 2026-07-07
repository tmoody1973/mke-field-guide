export type SleepFn = (ms: number) => Promise<void>;

export const defaultSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Maps `fn` over `items` sequentially, sleeping `delayMs` between calls (never before the first). */
export async function mapWithDelay<T, R>(
  items: readonly T[],
  delayMs: number,
  fn: (item: T) => Promise<R>,
  sleepFn: SleepFn = defaultSleep,
): Promise<R[]> {
  const results: R[] = [];
  for (const [index, item] of items.entries()) {
    if (index > 0) await sleepFn(delayMs);
    results.push(await fn(item));
  }
  return results;
}
