'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import type { AdminPickState } from '@/app/actions/admin-picks';

const initialState: AdminPickState = { ok: false, message: '' };

export function DeletePickForm({
  action,
}: {
  action: (prev: AdminPickState, formData: FormData) => Promise<AdminPickState>;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm('Delete this pick?')) event.preventDefault();
      }}
      className="flex items-center gap-3"
    >
      <Button type="submit" variant="destructive" disabled={pending}>
        {pending ? 'Deleting…' : 'Delete pick'}
      </Button>
      {state.message && !state.ok ? (
        <p role="status" className="text-sm text-rm-red">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
