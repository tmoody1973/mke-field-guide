import 'dotenv/config';
import { eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { venues } from '@/db/schema';
import { disambiguateSlug, venueSlug } from '@/lib/venue-slug';

function disambiguate(slug: string, normalizedName: string, taken: Set<string>): string {
  return taken.has(slug) ? disambiguateSlug(slug, normalizedName) : slug;
}

async function backfillVenueSlugs(): Promise<void> {
  const rows = await db.select().from(venues).where(isNull(venues.slug));
  const existing = await db.select({ slug: venues.slug }).from(venues);
  const taken = new Set(existing.map((row) => row.slug).filter((slug): slug is string => slug !== null));
  let updated = 0;
  for (const venue of rows) {
    const slug = disambiguate(venueSlug(venue.normalizedName), venue.normalizedName, taken);
    await db.update(venues).set({ slug }).where(eq(venues.id, venue.id));
    taken.add(slug);
    updated += 1;
  }
  console.log(`venue slugs backfilled: ${updated}`);
}

backfillVenueSlugs().catch((err) => {
  console.error(err);
  process.exit(1);
});
