import { z } from 'zod';
import { shouldSkipForBackoff, type BackoffSource } from './backoff';

const cadenceSchema = z.object({ cadence: z.enum(['daily', 'weekly']).default('daily') });

export type Cadence = 'daily' | 'weekly';

/** Reads the optional cadence field out of a source's config jsonb; anything else means daily. */
export function cadenceOf(config: unknown): Cadence {
  const parsed = cadenceSchema.safeParse(config ?? {});
  return parsed.success ? parsed.data.cadence : 'daily';
}

export interface SchedulableSource extends BackoffSource {
  key: string;
  config: unknown;
}

/** Daily runs take daily sources; weekly runs take everything. Backoff always wins. */
export function filterDueSources<T extends SchedulableSource>(
  sources: T[],
  cadence: Cadence,
  now: Date,
): T[] {
  return sources.filter(
    (source) =>
      !shouldSkipForBackoff(source, now) &&
      (cadence === 'weekly' || cadenceOf(source.config) === 'daily'),
  );
}
