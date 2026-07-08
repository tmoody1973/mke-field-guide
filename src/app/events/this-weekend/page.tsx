import type { Metadata } from 'next';
import EventsPage from '../page';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'This weekend in Milwaukee',
  description: 'Everything happening in Milwaukee this weekend — live music, comedy, markets, and more.',
  alternates: { canonical: '/events/this-weekend' },
};

export default function ThisWeekendPage() {
  return EventsPage({ searchParams: Promise.resolve({ date: 'this-weekend' }) });
}
