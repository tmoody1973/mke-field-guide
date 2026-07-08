import EventsPage from '../page';

export const dynamic = 'force-dynamic';

export default async function TonightPage() {
  return EventsPage({ searchParams: Promise.resolve({ date: 'tonight' }) });
}
