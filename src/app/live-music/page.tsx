import type { Metadata } from 'next';
import EventsPage from '../events/page';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Live music in Milwaukee',
  description: 'Every upcoming live music show in Milwaukee — by date, neighborhood, and price.',
  alternates: { canonical: '/live-music' },
};

export default function LiveMusicPage() {
  return EventsPage({ searchParams: Promise.resolve({ cat: 'music' }) });
}
