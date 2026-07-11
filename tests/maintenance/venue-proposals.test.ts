import { beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import {
  buildVenuePrompt,
  findVenuePairCandidates,
  venueProposalSchema,
  type VenuePairInput,
} from '@/maintenance/venue-proposals';
import { createTestDb } from '../helpers/test-db';

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
