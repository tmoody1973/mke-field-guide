import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { applyVenueSuggestionWithDb, dismissVenueSuggestionWithDb } from '@/app/actions/admin-venue-suggestions';
import { createTestDb } from '../helpers/test-db';

describe('venue-merge suggestion actions', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  });

  async function seedSuggestion(keepName: string, absorbName: string) {
    const [keep] = await db.insert(schema.venues)
      .values({ name: keepName, normalizedName: keepName.toLowerCase() }).returning();
    const [absorb] = await db.insert(schema.venues)
      .values({ name: absorbName, normalizedName: absorbName.toLowerCase() }).returning();
    const [event] = await db.insert(schema.events)
      .values({ slug: `${absorbName.toLowerCase()}-event`, title: 'Show', normalizedTitle: 'show', venueId: absorb.id })
      .returning();
    const [suggestion] = await db.insert(schema.venueMergeSuggestions).values({
      keepVenueId: keep.id,
      absorbVenueId: absorb.id,
      confidence: '0.9000',
      rationale: 'Likely the same room.',
    }).returning();
    return { keep, absorb, event, suggestion };
  }

  it('applyVenueSuggestion merges via the existing core and the suggestion row cascades away', async () => {
    const { keep, absorb, event, suggestion } = await seedSuggestion('Turner Hall', 'Turner Hall Ballroom');

    const result = await applyVenueSuggestionWithDb(db, { suggestionId: suggestion.id });
    expect(result.ok).toBe(true);

    const movedEvent = await db.query.events.findFirst({ where: eq(schema.events.id, event.id) });
    expect(movedEvent?.venueId).toBe(keep.id);

    const alias = await db.query.venueAliases.findFirst({
      where: eq(schema.venueAliases.normalizedName, absorb.normalizedName),
    });
    expect(alias?.venueId).toBe(keep.id);

    const absorbedVenue = await db.query.venues.findFirst({ where: eq(schema.venues.id, absorb.id) });
    expect(absorbedVenue).toBeUndefined();

    const remainingSuggestion = await db.query.venueMergeSuggestions.findFirst({
      where: eq(schema.venueMergeSuggestions.id, suggestion.id),
    });
    expect(remainingSuggestion).toBeUndefined();
  });

  it('apply on an already-resolved suggestion returns an envelope, not a crash', async () => {
    const { suggestion } = await seedSuggestion('Cactus Club', 'The Cactus Club Annex');
    const dismissed = await dismissVenueSuggestionWithDb(db, { suggestionId: suggestion.id });
    expect(dismissed.ok).toBe(true);

    const result = await applyVenueSuggestionWithDb(db, { suggestionId: suggestion.id });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/no longer pending/i);

    const unknownResult = await applyVenueSuggestionWithDb(db, {
      suggestionId: '00000000-0000-0000-0000-000000000000',
    });
    expect(unknownResult.ok).toBe(false);
  });

  it('dismiss is a CAS to dismissed and survives a second dismiss cleanly', async () => {
    const { suggestion } = await seedSuggestion('Colectivo', 'Colectivo Lakefront');

    const first = await dismissVenueSuggestionWithDb(db, { suggestionId: suggestion.id });
    expect(first.ok).toBe(true);
    expect(first.message).toBe('Suggestion dismissed.');

    const stored = await db.query.venueMergeSuggestions.findFirst({
      where: eq(schema.venueMergeSuggestions.id, suggestion.id),
    });
    expect(stored?.status).toBe('dismissed');

    const second = await dismissVenueSuggestionWithDb(db, { suggestionId: suggestion.id });
    expect(second.ok).toBe(true);
    expect(second.message).toBe('Already resolved.');
  });
});
