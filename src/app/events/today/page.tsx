import type { Metadata } from 'next';
import EventsPage from '../page';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Today in Milwaukee',
  description: 'Everything happening in Milwaukee today — live music, comedy, markets, and more.',
  alternates: { canonical: '/events/today' },
};

export default function TodayPage() {
  return EventsPage({ searchParams: Promise.resolve({ date: 'today' }) });
}
