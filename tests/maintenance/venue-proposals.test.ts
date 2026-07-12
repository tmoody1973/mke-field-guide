import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '@/db/schema';
import {
  buildVenuePrompt,
  findAddressMatchCandidates,
  findVenuePairCandidates,
  proposeVenueMerges,
  venueProposalSchema,
  type VenueProposal,
  type VenuePairInput,
} from '@/maintenance/venue-proposals';
import { createTestDb } from '../helpers/test-db';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('findVenuePairCandidates', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  const seededIds: Record<string, string> = {};

  async function seedVenue(name: string, normalizedName: string) {
    const [venue] = await db.insert(schema.venues).values({ name, normalizedName }).returning();
    return venue;
  }

  function pairMatches(row: { venueAId: string; venueBId: string }, idA: string, idB: string): boolean {
    return (row.venueAId === idA && row.venueBId === idB) || (row.venueAId === idB && row.venueBId === idA);
  }

  beforeAll(async () => {
    db = await createTestDb();

    // Two in-band pairs (should be returned, ordered by similarity DESC):
    const cactusClub = await seedVenue('Cactus Club', 'cactus club');
    const theCactusClub = await seedVenue('The Cactus Club', 'the cactus club'); // similarity ~0.73
    const turnerHall = await seedVenue('Turner Hall', 'turner hall');
    const turnerHallBallroom = await seedVenue('Turner Hall Ballroom', 'turner hall ballroom'); // similarity ~0.60

    // A distinct control venue: not similar to anything above (no candidate row).
    const millerHighLifeTheatre = await seedVenue('Miller High Life Theatre', 'miller high life theatre');

    // An in-band pair (~0.71 similarity) that already has a suggestion row —
    // must be excluded even though it would otherwise qualify. The suggestion
    // is stored with keep = the venue with the LARGER id and absorb = the
    // SMALLER id, i.e. the reverse of the self-join's a.id < b.id ordering —
    // proving the exclusion isn't order-dependent.
    const falconBowl = await seedVenue('Falcon Bowl', 'falcon bowl');
    const falconBowlRoom = await seedVenue('Falcon Bowl Room', 'falcon bowl room');
    const [smallerId, largerId] =
      falconBowl.id < falconBowlRoom.id ? [falconBowl.id, falconBowlRoom.id] : [falconBowlRoom.id, falconBowl.id];
    await db.insert(schema.venueMergeSuggestions).values({
      keepVenueId: largerId,
      absorbVenueId: smallerId,
      confidence: '0.8',
      rationale: 'pre-existing suggestion fixture',
    });

    Object.assign(seededIds, {
      cactusClubId: cactusClub.id,
      theCactusClubId: theCactusClub.id,
      turnerHallId: turnerHall.id,
      turnerHallBallroomId: turnerHallBallroom.id,
      millerId: millerHighLifeTheatre.id,
      falconBowlId: falconBowl.id,
      falconBowlRoomId: falconBowlRoom.id,
    });
  });

  it('returns in-band trigram pairs, excludes suggested pairs in either direction, orders by similarity', async () => {
    const candidates = await findVenuePairCandidates(db, 10);

    expect(candidates).toHaveLength(2);
    expect(pairMatches(candidates[0], seededIds.cactusClubId, seededIds.theCactusClubId)).toBe(true);
    expect(candidates[0].similarity).toBeCloseTo(0.7333, 3);
    expect(pairMatches(candidates[1], seededIds.turnerHallId, seededIds.turnerHallBallroomId)).toBe(true);
    expect(candidates[0].similarity).toBeGreaterThan(candidates[1].similarity);

    const hasFalconPair = candidates.some((c) => pairMatches(c, seededIds.falconBowlId, seededIds.falconBowlRoomId));
    expect(hasFalconPair).toBe(false);

    const involvesMiller = candidates.some(
      (c) => c.venueAId === seededIds.millerId || c.venueBId === seededIds.millerId,
    );
    expect(involvesMiller).toBe(false);
  });

  it('respects the limit parameter', async () => {
    const candidates = await findVenuePairCandidates(db, 1);
    expect(candidates).toHaveLength(1);
  });
});

describe('findVenuePairCandidates registry/alias exclusions', () => {
  async function seedVenue(
    db: Awaited<ReturnType<typeof createTestDb>>,
    overrides: Partial<typeof schema.venues.$inferInsert> & { name: string; normalizedName: string },
  ) {
    const [venue] = await db.insert(schema.venues).values(overrides).returning();
    return venue;
  }

  function pairMatches(row: { venueAId: string; venueBId: string }, idA: string, idB: string): boolean {
    return (row.venueAId === idA && row.venueBId === idB) || (row.venueAId === idB && row.venueBId === idA);
  }

  it('trigram candidates exclude pairs with different registry ids', async () => {
    const db = await createTestDb();
    const cactusClub = await seedVenue(db, { name: 'Cactus Club', normalizedName: 'cactus club', registryId: 'gers-a' });
    const theCactusClub = await seedVenue(db, {
      name: 'The Cactus Club',
      normalizedName: 'the cactus club',
      registryId: 'gers-b',
    });
    // Control: an in-band pair with no registry ids at all is unaffected by the exclusion.
    const turnerHall = await seedVenue(db, { name: 'Turner Hall', normalizedName: 'turner hall' });
    const turnerHallBallroom = await seedVenue(db, {
      name: 'Turner Hall Ballroom',
      normalizedName: 'turner hall ballroom',
    });

    const candidates = await findVenuePairCandidates(db, 10);

    expect(candidates.some((c) => pairMatches(c, cactusClub.id, theCactusClub.id))).toBe(false);
    expect(candidates.some((c) => pairMatches(c, turnerHall.id, turnerHallBallroom.id))).toBe(true);
  });

  it('trigram candidates exclude alias-covered names (either side)', async () => {
    const db = await createTestDb();
    const cactusClub = await seedVenue(db, { name: 'Cactus Club', normalizedName: 'cactus club' });
    const theCactusClub = await seedVenue(db, { name: 'The Cactus Club', normalizedName: 'the cactus club' });
    const canonicalVenue = await seedVenue(db, {
      name: 'Cactus Club Canonical',
      normalizedName: 'cactus club canonical',
    });
    // theCactusClub's normalized name is already recorded as a resolved alias of another venue.
    await db.insert(schema.venueAliases).values({ normalizedName: theCactusClub.normalizedName, venueId: canonicalVenue.id });

    // Control: an in-band pair with no alias coverage is unaffected by the exclusion.
    const turnerHall = await seedVenue(db, { name: 'Turner Hall', normalizedName: 'turner hall' });
    const turnerHallBallroom = await seedVenue(db, {
      name: 'Turner Hall Ballroom',
      normalizedName: 'turner hall ballroom',
    });

    const candidates = await findVenuePairCandidates(db, 10);

    expect(candidates.some((c) => pairMatches(c, cactusClub.id, theCactusClub.id))).toBe(false);
    expect(candidates.some((c) => pairMatches(c, turnerHall.id, turnerHallBallroom.id))).toBe(true);
  });
});

describe('findAddressMatchCandidates', () => {
  async function seedVenue(
    db: Awaited<ReturnType<typeof createTestDb>>,
    overrides: Partial<typeof schema.venues.$inferInsert> & { name: string; normalizedName: string },
  ) {
    const [venue] = await db.insert(schema.venues).values(overrides).returning();
    return venue;
  }

  function pairMatches(row: { venueAId: string; venueBId: string }, idA: string, idB: string): boolean {
    return (row.venueAId === idA && row.venueBId === idB) || (row.venueAId === idB && row.venueBId === idA);
  }

  it('address-match candidates surface a below-band dash-variant pair (Shank Hall shape)', async () => {
    const db = await createTestDb();
    const shankHall = await seedVenue(db, {
      name: 'Shank Hall',
      normalizedName: 'shank hall',
      address: '1434 N Farwell Ave',
    });
    const shankHallVariant = await seedVenue(db, {
      name: 'Shank Hall - 1434 N Farwell Ave Milwaukee',
      normalizedName: 'shank hall - 1434 n farwell ave milwaukee',
      address: '1434 N Farwell Ave Milwaukee',
    });

    // The trigram query misses it entirely -- proves the address query has no floor.
    const trigramCandidates = await findVenuePairCandidates(db, 10);
    expect(trigramCandidates.some((c) => pairMatches(c, shankHall.id, shankHallVariant.id))).toBe(false);

    const addressCandidates = await findAddressMatchCandidates(db, 10);
    expect(addressCandidates).toHaveLength(1);
    expect(pairMatches(addressCandidates[0], shankHall.id, shankHallVariant.id)).toBe(true);
    expect(addressCandidates[0].similarity).toBeLessThan(0.45);
    expect(addressCandidates[0].similarity).toBeCloseTo(0.2820513, 5);
  });

  it('applies the same registry/alias/suggested-pair exclusions as the trigram query', async () => {
    const db = await createTestDb();
    const shankHall = await seedVenue(db, {
      name: 'Shank Hall',
      normalizedName: 'shank hall',
      address: '1434 N Farwell Ave',
      registryId: 'gers-a',
    });
    const shankHallVariant = await seedVenue(db, {
      name: 'Shank Hall - 1434 N Farwell Ave Milwaukee',
      normalizedName: 'shank hall - 1434 n farwell ave milwaukee',
      address: '1434 N Farwell Ave Milwaukee',
      registryId: 'gers-b',
    });

    const candidates = await findAddressMatchCandidates(db, 10);
    expect(candidates.some((c) => pairMatches(c, shankHall.id, shankHallVariant.id))).toBe(false);
  });
});

describe('buildVenuePrompt', () => {
  const INPUT: VenuePairInput = {
    nameA: 'Cactus Club',
    nameB: 'Cactus Club - 2496 S Wentworth Ave',
    addressA: null,
    addressB: '2496 S Wentworth Ave',
    hoodA: 'Bay View',
    hoodB: null,
    eventCountA: 42,
    eventCountB: 3,
    sampleTitlesA: ['Colin Bracewell w/ Floryence', 'Vundabar'],
    sampleTitlesB: ['Local Band Showcase'],
  };

  it("carries both venues' facts and the rooms/address/The-prefix trap guidance", () => {
    const prompt = buildVenuePrompt(INPUT);
    for (const fragment of [
      'Cactus Club',
      'Cactus Club - 2496 S Wentworth Ave',
      '2496 S Wentworth Ave',
      'Bay View',
      '42 event',
      'Colin Bracewell w/ Floryence',
      'Local Band Showcase',
      'Falcon Bowl',
      'Falcon Nest',
      'bandshell',
      'The X',
      'embedded address',
      'samePlace',
      'keep',
    ]) {
      expect(prompt).toContain(fragment);
    }
  });
});

describe('venueProposalSchema', () => {
  it('accepts a valid proposal', () => {
    const parsed = venueProposalSchema.safeParse({
      samePlace: true,
      confidence: 0.9,
      keep: 'a',
      rationale: 'same address, "The" prefix dropped',
    });
    expect(parsed.success).toBe(true);
  });

  it('bounds confidence and requires keep a|b', () => {
    expect(
      venueProposalSchema.safeParse({ samePlace: true, confidence: 1.5, keep: 'a', rationale: 'x' }).success,
    ).toBe(false);
    expect(
      venueProposalSchema.safeParse({ samePlace: true, confidence: -0.1, keep: 'a', rationale: 'x' }).success,
    ).toBe(false);
    expect(
      venueProposalSchema.safeParse({ samePlace: true, confidence: 0.9, keep: 'c', rationale: 'x' }).success,
    ).toBe(false);
    expect(
      venueProposalSchema.safeParse({ samePlace: true, confidence: 0.9, keep: 'a', rationale: 'x'.repeat(400) })
        .success,
    ).toBe(false);
  });
});

describe('proposeVenueMerges', () => {
  let eventSlugCounter = 0;

  async function seedVenue(db: Awaited<ReturnType<typeof createTestDb>>, name: string, normalizedName: string) {
    const [venue] = await db.insert(schema.venues).values({ name, normalizedName }).returning();
    return venue;
  }

  async function seedEvent(db: Awaited<ReturnType<typeof createTestDb>>, venueId: string, title: string) {
    eventSlugCounter += 1;
    const [event] = await db
      .insert(schema.events)
      .values({
        slug: `proposal-fixture-${eventSlugCounter}`,
        title,
        normalizedTitle: title.toLowerCase(),
        venueId,
      })
      .returning();
    return event;
  }

  it("writes a pending suggestion for samePlace with the model's keep side", async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', 'test');
    const db = await createTestDb();
    const cactusClub = await seedVenue(db, 'Cactus Club', 'cactus club');
    const theCactusClub = await seedVenue(db, 'The Cactus Club', 'the cactus club');
    await seedEvent(db, cactusClub.id, 'Vundabar');
    await seedEvent(db, theCactusClub.id, 'Local Band Showcase');

    let capturedInput: VenuePairInput | undefined;
    const proposeFn = vi.fn(async (input: VenuePairInput): Promise<VenueProposal> => {
      capturedInput = input;
      return { samePlace: true, confidence: 0.92, keep: 'a', rationale: 'same address, "The" prefix dropped' };
    });

    const result = await proposeVenueMerges(db, { proposeFn });

    expect(result).toEqual({ proposed: 1, rejected: 0, skipped: 0 });
    expect(proposeFn).toHaveBeenCalledTimes(1);
    expect(capturedInput).toBeDefined();

    const suggestions = await db.query.venueMergeSuggestions.findMany();
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].status).toBe('pending');
    expect(suggestions[0].rationale).toBe('same address, "The" prefix dropped');
    expect(Number(suggestions[0].confidence)).toBeCloseTo(0.92, 4);

    // keep: 'a' names the venue that was nameA in the model's input as canonical.
    const keptVenue = await db.query.venues.findFirst({ where: eq(schema.venues.id, suggestions[0].keepVenueId) });
    expect(keptVenue?.name).toBe(capturedInput?.nameA);
  });

  it('writes a dismissed suggestion for a model no (durable, never re-proposed)', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', 'test');
    const db = await createTestDb();
    const falconBowl = await seedVenue(db, 'Falcon Bowl', 'falcon bowl');
    const falconBowlRoom = await seedVenue(db, 'Falcon Bowl Room', 'falcon bowl room');

    const proposeFn = vi.fn(
      async (): Promise<VenueProposal> => ({
        samePlace: false,
        confidence: 0.6,
        keep: 'a',
        rationale: 'different rooms in the same building',
      }),
    );

    const result = await proposeVenueMerges(db, { proposeFn });
    expect(result).toEqual({ proposed: 0, rejected: 1, skipped: 0 });

    const suggestions = await db.query.venueMergeSuggestions.findMany();
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].status).toBe('dismissed');
    expect(suggestions[0].rationale).toBe('different rooms in the same building');
    // Dismissed rows are written in candidate order, ignoring the model's keep side.
    expect([suggestions[0].keepVenueId, suggestions[0].absorbVenueId].sort()).toEqual(
      [falconBowl.id, falconBowlRoom.id].sort(),
    );

    // A second sweep must not re-propose: findVenuePairCandidates excludes the recorded pair.
    const secondResult = await proposeVenueMerges(db, { proposeFn });
    expect(secondResult).toEqual({ proposed: 0, rejected: 0, skipped: 0 });
    expect(proposeFn).toHaveBeenCalledTimes(1);

    const afterSecondSweep = await db.query.venueMergeSuggestions.findMany();
    expect(afterSecondSweep).toHaveLength(1);
  });

  it('null proposal = skip, no row, candidate reappears next run', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', 'test');
    const db = await createTestDb();
    await seedVenue(db, 'Turner Hall', 'turner hall');
    await seedVenue(db, 'Turner Hall Ballroom', 'turner hall ballroom');

    const proposeFn = vi.fn(async (): Promise<VenueProposal | null> => null);
    const result = await proposeVenueMerges(db, { proposeFn });

    expect(result).toEqual({ proposed: 0, rejected: 0, skipped: 1 });
    const suggestions = await db.query.venueMergeSuggestions.findMany();
    expect(suggestions).toHaveLength(0);

    // No row was written, so the candidate query still surfaces the pair for retry.
    const candidates = await findVenuePairCandidates(db, 10);
    expect(candidates).toHaveLength(1);
  });

  it('PROPOSE-ONLY invariant: venues and events tables byte-untouched', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', 'test');
    const db = await createTestDb();
    const cactusClub = await seedVenue(db, 'Cactus Club', 'cactus club');
    const theCactusClub = await seedVenue(db, 'The Cactus Club', 'the cactus club');
    await seedEvent(db, cactusClub.id, 'Vundabar');
    await seedEvent(db, theCactusClub.id, 'Local Band Showcase');

    const venuesBefore = await db.query.venues.findMany();
    const eventsBefore = await db.query.events.findMany();

    const proposeFn = vi.fn(
      async (): Promise<VenueProposal> => ({
        samePlace: true,
        confidence: 0.92,
        keep: 'a',
        rationale: 'same address, "The" prefix dropped',
      }),
    );
    await proposeVenueMerges(db, { proposeFn });

    const venuesAfter = await db.query.venues.findMany();
    const eventsAfter = await db.query.events.findMany();

    expect(venuesAfter).toEqual(venuesBefore);
    expect(eventsAfter).toEqual(eventsBefore);
  });

  it('no-key = no-op', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', '');
    const db = await createTestDb();
    await seedVenue(db, 'Cactus Club', 'cactus club');
    await seedVenue(db, 'The Cactus Club', 'the cactus club');

    const proposeFn = vi.fn(async (): Promise<VenueProposal | null> => null);
    const result = await proposeVenueMerges(db, { proposeFn });

    expect(result).toEqual({ proposed: 0, rejected: 0, skipped: 0 });
    expect(proposeFn).not.toHaveBeenCalled();
    const suggestions = await db.query.venueMergeSuggestions.findMany();
    expect(suggestions).toHaveLength(0);
  });

  async function seedVenueWithOverrides(
    db: Awaited<ReturnType<typeof createTestDb>>,
    overrides: Partial<typeof schema.venues.$inferInsert> & { name: string; normalizedName: string },
  ) {
    const [venue] = await db.insert(schema.venues).values(overrides).returning();
    return venue;
  }

  it('combined candidate list dedupes pairs and respects the limit', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', 'test');
    const db = await createTestDb();

    // Overlap pair: qualifies for BOTH the trigram query (0.6875 in-band similarity)
    // and the address-match query (identical own address) -- must be judged once.
    await seedVenueWithOverrides(db, {
      name: 'Cactus Club',
      normalizedName: 'cactus club',
      address: '2496 S Wentworth Ave',
    });
    await seedVenueWithOverrides(db, {
      name: 'Cactus Club Room',
      normalizedName: 'cactus club room',
      address: '2496 S Wentworth Ave',
    });

    // Trigram-only pair: in-band name similarity, no addresses set at all.
    await seedVenueWithOverrides(db, { name: 'Turner Hall', normalizedName: 'turner hall' });
    await seedVenueWithOverrides(db, { name: 'Turner Hall Ballroom', normalizedName: 'turner hall ballroom' });

    const proposeFn = vi.fn(
      async (): Promise<VenueProposal> => ({ samePlace: true, confidence: 0.9, keep: 'a', rationale: 'fixture' }),
    );

    // limit: 1 -- only one deduped candidate is judged even though the overlap
    // pair would otherwise be counted twice (once per source list).
    const limited = await proposeVenueMerges(db, { proposeFn, limit: 1 });
    expect(proposeFn).toHaveBeenCalledTimes(1);
    expect(limited.proposed).toBe(1);

    proposeFn.mockClear();
    await db.delete(schema.venueMergeSuggestions);

    // With headroom, exactly the two distinct pairs are judged -- not three.
    const full = await proposeVenueMerges(db, { proposeFn, limit: 10 });
    expect(proposeFn).toHaveBeenCalledTimes(2);
    expect(full.proposed).toBe(2);
  });

  it('address-pair suggestions carry evidence tier address-pair; trigram ones keep evidence null', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', 'test');
    const db = await createTestDb();

    const shankHall = await seedVenueWithOverrides(db, {
      name: 'Shank Hall',
      normalizedName: 'shank hall',
      address: '1434 N Farwell Ave',
    });
    const shankHallVariant = await seedVenueWithOverrides(db, {
      name: 'Shank Hall - 1434 N Farwell Ave Milwaukee',
      normalizedName: 'shank hall - 1434 n farwell ave milwaukee',
      address: '1434 N Farwell Ave Milwaukee',
    });
    const turnerHall = await seedVenueWithOverrides(db, { name: 'Turner Hall', normalizedName: 'turner hall' });
    const turnerHallBallroom = await seedVenueWithOverrides(db, {
      name: 'Turner Hall Ballroom',
      normalizedName: 'turner hall ballroom',
    });

    const proposeFn = vi.fn(
      async (): Promise<VenueProposal> => ({ samePlace: true, confidence: 0.9, keep: 'a', rationale: 'fixture' }),
    );

    const result = await proposeVenueMerges(db, { proposeFn, limit: 10 });
    expect(result.proposed).toBe(2);

    const suggestions = await db.query.venueMergeSuggestions.findMany();
    expect(suggestions).toHaveLength(2);

    const addressPairIds = [shankHall.id, shankHallVariant.id].sort();
    const trigramPairIds = [turnerHall.id, turnerHallBallroom.id].sort();

    const addressSuggestion = suggestions.find(
      (s) => [s.keepVenueId, s.absorbVenueId].sort().join(':') === addressPairIds.join(':'),
    );
    const trigramSuggestion = suggestions.find(
      (s) => [s.keepVenueId, s.absorbVenueId].sort().join(':') === trigramPairIds.join(':'),
    );

    expect(addressSuggestion?.evidence).toEqual({ tier: 'address-pair' });
    expect(trigramSuggestion?.evidence).toBeNull();
    expect(addressSuggestion?.source).toBe('llm');
    expect(trigramSuggestion?.source).toBe('llm');
  });
});
