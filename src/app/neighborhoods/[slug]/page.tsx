import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { neighborhoodBySlug } from '@/lib/neighborhoods';
import EventsPage from '../../events/page';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const hood = neighborhoodBySlug((await params).slug);
  if (!hood) return { title: 'Neighborhood not found' };
  return {
    title: `${hood.name} events in Milwaukee`,
    description: `Every upcoming event in ${hood.name}, Milwaukee, updated daily.`,
    alternates: { canonical: `/neighborhoods/${hood.slug}` },
  };
}

export default async function NeighborhoodPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const hood = neighborhoodBySlug(slug);
  if (!hood) notFound();
  return EventsPage({ searchParams: Promise.resolve({ neighborhood: hood.name }) });
}
