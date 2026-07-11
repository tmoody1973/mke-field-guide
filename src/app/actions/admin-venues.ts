// Pure, DB-injected venue-merge mutation (no 'use server' — the repo's admin-reviews.ts pattern).
import { z } from 'zod';
import { mergeVenues } from '@/maintenance/merge-venues';
import type { Db } from '@/db/types';

export interface VenueActionState {
  ok: boolean;
  message: string;
}

const mergeSchema = z
  .object({ keepId: z.uuid(), absorbId: z.uuid() })
  .refine((v) => v.keepId !== v.absorbId, { message: 'Pick two different venues.' });

export async function mergeVenuesWithDb(
  db: Db,
  input: Record<string, FormDataEntryValue | null | string>,
): Promise<VenueActionState> {
  const parsed = mergeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  try {
    const result = await mergeVenues(db, parsed.data.keepId, parsed.data.absorbId);
    return {
      ok: true,
      message: `Merged — ${result.eventsRepointed} event${result.eventsRepointed === 1 ? '' : 's'} repointed; "${result.aliasRecorded}" now resolves to the kept venue.`,
    };
  } catch (error) {
    console.error('mergeVenuesWithDb failed', error);
    return { ok: false, message: error instanceof Error ? error.message : 'Merge failed. Try again.' };
  }
}
