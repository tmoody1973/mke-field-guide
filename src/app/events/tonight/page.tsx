import type { Metadata } from 'next';
import EventsPage from '../page';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Tonight in Milwaukee',
  description: 'Everything happening in Milwaukee tonight — live music, comedy, markets, and more.',
  alternates: { canonical: '/events/tonight' },
};

export default function TonightPage() {
  return EventsPage({ searchParams: Promise.resolve({ date: 'tonight' }) });
}
