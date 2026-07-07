import { asc, gte } from 'drizzle-orm';
import { db } from '@/db';
import { eventInstances } from '@/db/schema';

export const dynamic = 'force-dynamic';

const dayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  weekday: 'long',
  month: 'long',
  day: 'numeric',
});

const timeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  hour: 'numeric',
  minute: '2-digit',
});

export default async function EventsPage() {
  const instances = await db.query.eventInstances.findMany({
    where: gte(eventInstances.startAt, new Date()),
    orderBy: [asc(eventInstances.startAt)],
    limit: 100,
    with: { event: { with: { venue: true } } },
  });

  const byDay = new Map<string, typeof instances>();
  for (const instance of instances) {
    const day = dayFormatter.format(instance.startAt);
    byDay.set(day, [...(byDay.get(day) ?? []), instance]);
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-bold">MKE Events</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Upcoming Milwaukee events · powered by Radio Milwaukee
      </p>
      {instances.length === 0 && (
        <p className="mt-8 text-neutral-500">
          No upcoming events yet. Run <code>npm run ingest -- urban-milwaukee</code>.
        </p>
      )}
      {[...byDay.entries()].map(([day, dayInstances]) => (
        <section key={day} className="mt-8">
          <h2 className="border-b pb-1 text-lg font-semibold">{day}</h2>
          <ul className="mt-3 space-y-3">
            {dayInstances.map((instance) => (
              <li key={instance.id} className="flex gap-3">
                <span className="w-20 shrink-0 text-sm text-neutral-500">
                  {timeFormatter.format(instance.startAt)}
                </span>
                <span>
                  <span className="font-medium">{instance.event.title}</span>
                  {instance.event.venue && (
                    <span className="text-sm text-neutral-500">
                      {' '}
                      · {instance.event.venue.name}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
