import { notFound } from 'next/navigation';
import { asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import * as schema from '@/db/schema';
import {
  unlockFieldAction,
  updateEventAction,
  updateInstanceTimeAction,
} from '@/app/actions/admin-events-actions';
import { EventEditForm } from '@/components/admin/event-edit-form';
import { InstanceTimeForm } from '@/components/admin/instance-time-form';
import { UnlockButton } from '@/components/admin/unlock-button';
import { Badge } from '@/components/ui/badge';
import { CATEGORY_VALUES } from '@/enrichment/tag';
import { chicagoDateLabel } from '@/lib/display';
import { requireStaff } from '@/lib/staff-guard';
import { venueOptions } from '@/queries/admin-events';

const HISTORY_SHOWN = 20;

export default async function AdminEventEditPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaff('admin');
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const event = await db.query.events.findFirst({
    where: eq(schema.events.id, id),
    with: {
      venue: true,
      instances: { orderBy: [asc(schema.eventInstances.startAt)] },
      sourceLinks: { with: { source: true } },
    },
  });
  if (!event) notFound();
  const [venues, edits] = await Promise.all([
    venueOptions(db),
    db.query.eventEdits.findMany({
      where: eq(schema.eventEdits.eventId, event.id),
      orderBy: [desc(schema.eventEdits.createdAt)],
      limit: HISTORY_SHOWN,
    }),
  ]);
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-head text-3xl text-ink">{event.title}</h1>
        <p className="mt-1 text-ink-muted">
          Edited fields lock against ingestion overwrites; unlock to let source values flow again.
        </p>
        <div className="mt-2 flex flex-wrap gap-1">
          {event.sourceLinks.map((link) => (
            <Badge key={link.id} variant={link.isCanonical ? 'default' : 'outline'}>
              {link.source.key}
              {link.isCanonical ? ' ★' : ''}
            </Badge>
          ))}
        </div>
      </div>
      <EventEditForm
        event={{
          eventId: event.id,
          title: event.title,
          status: event.status,
          category: event.category,
          venueId: event.venueId,
          lockedFields: event.lockedFields,
        }}
        categories={CATEGORY_VALUES}
        venues={venues}
        action={updateEventAction}
      />
      <section className="grid gap-2">
        <h2 className="font-head text-xl text-ink">Dates</h2>
        {event.instances.map((instance) => (
          <InstanceTimeForm
            key={instance.id}
            instance={{
              instanceId: instance.id,
              startAt: instance.startAt.toISOString(),
              endAt: instance.endAt?.toISOString() ?? null,
              status: instance.status,
            }}
            action={updateInstanceTimeAction}
          />
        ))}
        {event.instances.length === 0 ? <p className="text-ink-muted">No instances.</p> : null}
      </section>
      {event.lockedFields.length > 0 ? (
        <section className="grid gap-2">
          <h2 className="font-head text-xl text-ink">Locks</h2>
          <div className="flex flex-wrap gap-2">
            {event.lockedFields.map((field) => (
              <UnlockButton key={field} eventId={event.id} field={field} action={unlockFieldAction} />
            ))}
          </div>
        </section>
      ) : null}
      <section className="grid gap-1">
        <h2 className="font-head text-xl text-ink">Edit history</h2>
        {edits.length === 0 ? <p className="text-ink-muted">No manual edits yet.</p> : null}
        {edits.map((edit) => (
          <p key={edit.id} className="text-sm text-ink-muted">
            {chicagoDateLabel(edit.createdAt)} · {edit.editedBy} · {edit.field}:{' '}
            {edit.oldValue ?? '—'} → {edit.newValue ?? '—'}
          </p>
        ))}
      </section>
    </div>
  );
}
