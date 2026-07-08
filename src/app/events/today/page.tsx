import EventsPage from '../page';

export const dynamic = 'force-dynamic';

export default async function TodayPage() {
  return EventsPage({ searchParams: Promise.resolve({ date: 'today' }) });
}
