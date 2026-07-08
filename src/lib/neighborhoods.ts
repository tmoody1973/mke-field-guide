import { BLUE, GOLD, INK, ORANGE, PINK } from '@/lib/design';

export interface Neighborhood {
  slug: string;
  name: string;
  accent: string;
}

/** Curated MVP set (mockup palette). venues.neighborhood stores the display NAME (search facet matches it). */
export const NEIGHBORHOODS: readonly Neighborhood[] = [
  { slug: 'bay-view', name: 'Bay View', accent: PINK },
  { slug: 'riverwest', name: 'Riverwest', accent: ORANGE },
  { slug: 'third-ward', name: 'Third Ward', accent: BLUE },
  { slug: 'walkers-point', name: "Walker's Point", accent: GOLD },
  { slug: 'east-town', name: 'East Town', accent: INK },
  { slug: 'downtown', name: 'Downtown', accent: GOLD },
  { slug: 'lakefront', name: 'Lakefront', accent: ORANGE },
  { slug: 'west-side', name: 'West Side', accent: BLUE },
] as const;

export function neighborhoodBySlug(slug: string): Neighborhood | undefined {
  return NEIGHBORHOODS.find((candidate) => candidate.slug === slug);
}

export function neighborhoodByName(name: string): Neighborhood | undefined {
  return NEIGHBORHOODS.find((candidate) => candidate.name === name);
}
