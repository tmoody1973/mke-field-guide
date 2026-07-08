import type { MetadataRoute } from 'next';
import { gte, isNotNull } from 'drizzle-orm';
import { db } from '@/db';
import { eventInstances, venues } from '@/db/schema';
import { CATEGORIES } from '@/lib/design';
import { NEIGHBORHOODS } from '@/lib/neighborhoods';
import { SITE_URL } from '@/lib/site';

const SECTION_IDS = ['core', 'events', 'venues', 'taxonomy'] as const;

export async function generateSitemaps() {
  return SECTION_IDS.map((id) => ({ id }));
}

const CORE_PATHS = [
  '/',
  '/events',
  '/events/tonight',
  '/events/today',
  '/events/this-weekend',
  '/free-events',
  '/live-music',
  '/picks',
];

const MAX_EVENT_URLS = 5000;

function entry(path: string, lastModified?: Date): MetadataRoute.Sitemap[number] {
  return { url: `${SITE_URL}${path}`, lastModified };
}

async function eventEntries(): Promise<MetadataRoute.Sitemap> {
  const instances = await db.query.eventInstances.findMany({
    where: gte(eventInstances.startAt, new Date()),
    with: { event: { columns: { slug: true, updatedAt: true } } },
    limit: 15_000,
  });
  const bySlug = new Map(instances.map((instance) => [instance.event.slug, instance.event.updatedAt]));
  return [...bySlug.entries()].slice(0, MAX_EVENT_URLS).map(([slug, updatedAt]) => entry(`/events/${slug}`, updatedAt));
}

async function venueEntries(): Promise<MetadataRoute.Sitemap> {
  const rows = await db.query.venues.findMany({ columns: { slug: true }, where: isNotNull(venues.slug) });
  return rows.flatMap((row) => (row.slug ? [entry(`/venues/${row.slug}`)] : []));
}

function taxonomyEntries(): MetadataRoute.Sitemap {
  return [
    ...CATEGORIES.map((category) => entry(`/categories/${category.slug}`)),
    ...NEIGHBORHOODS.map((hood) => entry(`/neighborhoods/${hood.slug}`)),
  ];
}

export default async function sitemap({
  id,
}: {
  id: Promise<(typeof SECTION_IDS)[number]>;
}): Promise<MetadataRoute.Sitemap> {
  const section = await id;
  if (section === 'events') return eventEntries();
  if (section === 'venues') return venueEntries();
  if (section === 'taxonomy') return taxonomyEntries();
  return CORE_PATHS.map((path) => entry(path));
}
