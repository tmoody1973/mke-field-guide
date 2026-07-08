import type { Metadata } from 'next';
import EventsPage from '../events/page';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Free events in Milwaukee',
  description: 'Everything free and happening in Milwaukee — live music, comedy, markets, and more.',
  alternates: { canonical: '/free-events' },
};

export default function FreeEventsPage() {
  return EventsPage({ searchParams: Promise.resolve({ free: '1' }) });
}
