import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '@/db/schema';
import {
  buildVenuePrompt,
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
});
