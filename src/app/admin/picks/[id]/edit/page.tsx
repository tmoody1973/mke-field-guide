import { notFound } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/db';
import { deletePickAction, updatePickAction } from '@/app/actions/admin-picks-actions';
import { DeletePickForm } from '@/components/admin/delete-pick-form';
import { PickForm } from '@/components/admin/pick-form';
import { requireStaff } from '@/lib/staff-guard';
import { getPickById } from '@/queries/admin-picks';

export default async function EditPickPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireStaff('picks');
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const pick = await getPickById(db, id);
  if (!pick) notFound();

  const updateWithId = updatePickAction.bind(null, pick.id);
  const deleteWithId = deletePickAction.bind(null, pick.id);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-head text-3xl text-ink">Edit pick</h1>
        <p className="mt-1 text-ink-muted">
          {pick.eventTitle} · week of {pick.weekOf}
        </p>
      </div>
      <PickForm
        action={updateWithId}
        defaults={{
          curatorName: pick.curatorName,
          curatorRole: pick.curatorRole,
          showUrl: pick.showUrl,
          blurb: pick.blurb,
          weekOf: pick.weekOf,
          sortOrder: pick.sortOrder,
        }}
        submitLabel="Save changes"
      />
      <div className="border-t-[3px] border-ink pt-4">
        <DeletePickForm action={deleteWithId} />
      </div>
    </div>
  );
}
