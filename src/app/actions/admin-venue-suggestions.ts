// Pure, DB-injected venue-suggestion mutations (no 'use server' — the repo's admin-reviews.ts pattern).
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import * as schema from '@/db/schema';
import { mergeVenuesWithDb, type VenueActionState } from '@/app/actions/admin-venues';
import type { Db } from '@/db/types';

const suggestionIdSchema = z.object({ suggestionId: z.uuid() });

export async function applyVenueSuggestionWithDb(
  db: Db,
  input: Record<string, FormDataEntryValue | null | string>,
): Promise<VenueActionState> {
  const parsed = suggestionIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Unknown suggestion.' };
  try {
    const suggestion = await db.query.venueMergeSuggestions.findFirst({
      where: eq(schema.venueMergeSuggestions.id, parsed.data.suggestionId),
    });
    if (!suggestion || suggestion.status !== 'pending')
      return { ok: false, message: 'This suggestion is no longer pending.' };
    // Route through the existing human mutation: repoint/backfill/alias/delete core.
    // The absorbVenueId → venues FK cascade removes this row for us once the merge lands.
    return await mergeVenuesWithDb(db, {
      keepId: suggestion.keepVenueId,
      absorbId: suggestion.absorbVenueId,
    });
  } catch (error) {
    console.error('applyVenueSuggestionWithDb failed', error);
    return { ok: false, message: 'Could not apply the suggestion. Try again.' };
  }
}

export async function dismissVenueSuggestionWithDb(
  db: Db,
  input: Record<string, FormDataEntryValue | null | string>,
): Promise<VenueActionState> {
  const parsed = suggestionIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Unknown suggestion.' };
  try {
    const dismissed = await db
      .update(schema.venueMergeSuggestions)
      .set({ status: 'dismissed' })
      .where(
        and(
          eq(schema.venueMergeSuggestions.id, parsed.data.suggestionId),
          eq(schema.venueMergeSuggestions.status, 'pending'),
        ),
      )
      .returning({ id: schema.venueMergeSuggestions.id });
    if (dismissed.length === 0) return { ok: true, message: 'Already resolved.' };
    return { ok: true, message: 'Suggestion dismissed.' };
  } catch (error) {
    console.error('dismissVenueSuggestionWithDb failed', error);
    return { ok: false, message: 'Could not dismiss the suggestion. Try again.' };
  }
}
