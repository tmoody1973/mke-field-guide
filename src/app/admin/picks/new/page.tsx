import { notFound } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/db';
import { createPickAction } from '@/app/actions/admin-picks-actions';
import { PickForm } from '@/components/admin/pick-form';
import { loadCardMeta } from '@/lib/card-data';
import { chicagoWeekMonday } from '@/lib/display';
import { requireStaff } from '@/lib/staff-guard';

const paramsSchema = z.object({
  eventId: z.uuid().catch(''),
  week: z.iso.date().catch(''),
});

export default async function NewPickPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireStaff('picks');
  const raw = await searchParams;
  const parsed = paramsSchema.parse({ eventId: raw.eventId ?? '', week: raw.week ?? '' });
  if (!parsed.eventId) notFound();
  const meta = (await loadCardMeta(db, [parsed.eventId])).get(parsed.eventId);
  if (!meta) notFound();
  const weekOf = parsed.week || chicagoWeekMonday(new Date());

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="font-head text-3xl text-ink">New pick</h1>
        <p className="mt-1 text-ink-muted">
          {meta.title} · {meta.venueName ?? 'Venue TBA'}
        </p>
      </div>
      <PickForm
        action={createPickAction}
        eventId={parsed.eventId}
        defaults={{ weekOf }}
        submitLabel="Add pick"
      />
    </div>
  );
}
