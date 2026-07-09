import Link from 'next/link';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireStaff } from '@/lib/staff-guard';

export default async function AdminHomePage() {
  const staff = await requireStaff('picks');
  return (
    <div>
      <h1 className="font-head text-3xl text-ink">Admin</h1>
      <p className="mt-1 text-ink-muted">
        Signed in as {staff.email} ({staff.role})
      </p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Link href="/admin/picks" className="block">
          <Card>
            <CardHeader>
              <CardTitle>Staff picks</CardTitle>
              <CardDescription>
                Weekly picks: search events, add blurbs, edit and reorder.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
        {staff.role === 'admin' ? (
          <Card>
            <CardHeader>
              <CardTitle>Review queue &amp; sources</CardTitle>
              <CardDescription>Duplicate review with survivor picker — coming in Slice 2.</CardDescription>
            </CardHeader>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
