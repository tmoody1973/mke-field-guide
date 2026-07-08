import EventsPage from '../events/page';

export const dynamic = 'force-dynamic';

export default async function FreeEventsPage() {
  return EventsPage({ searchParams: Promise.resolve({ free: '1' }) });
}
