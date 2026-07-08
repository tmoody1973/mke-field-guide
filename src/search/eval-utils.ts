export type HitResult = boolean | 'n/a';

/** Sorted-index percentile: `p95` → `sorted[ceil(0.95*n)-1]`, clamped to valid bounds. */
export function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const rawIndex = Math.ceil(p * sorted.length) - 1;
  const index = Math.min(Math.max(rawIndex, 0), sorted.length - 1);
  return sorted[index];
}

/** Median via the same sorted-index formula as `percentile`, at p=0.5. */
export function median(values: number[]): number {
  return percentile(values, 0.5);
}

/**
 * Any expected slug landing in the top 3 counts as a hit. Draft rows (or rows with no
 * expected slugs authored yet) report 'n/a' rather than a false miss.
 */
export function hitAt3(topSlugs: string[], expectedSlugs: string[], isDraft: boolean | undefined): HitResult {
  if (isDraft || expectedSlugs.length === 0) return 'n/a';
  return topSlugs.slice(0, 3).some((slug) => expectedSlugs.includes(slug));
}

/** Pads each column to its fixed width and joins with a two-space gutter for aligned console output. */
export function formatRow(columns: string[], widths: number[]): string {
  return columns.map((column, i) => column.padEnd(widths[i] ?? column.length)).join('  ');
}
