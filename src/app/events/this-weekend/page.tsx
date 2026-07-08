import EventsPage from '../page';

export const dynamic = 'force-dynamic';

export default async function ThisWeekendPage() {
  return EventsPage({ searchParams: Promise.resolve({ date: 'this-weekend' }) });
}
