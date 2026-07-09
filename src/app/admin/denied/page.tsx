import { SignOutButton } from '@clerk/nextjs';
import { auth, currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

export default async function AdminDeniedPage() {
  const { isAuthenticated } = await auth();
  if (!isAuthenticated) redirect('/admin/sign-in');
  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? 'This account';
  return (
    <div className="max-w-md border-[3px] border-ink bg-cream-raised p-6 shadow-[6px_6px_0_#1F2528]">
      <h1 className="font-head text-2xl text-ink">Not authorized</h1>
      <p className="mt-2 text-ink-muted">
        {email} is signed in but isn&apos;t on the staff list. Ask Tarik to add it to
        ADMIN_ALLOWLIST_EMAILS or PICKS_ALLOWLIST_EMAILS, or sign out.
      </p>
      <div className="mt-4">
        <SignOutButton redirectUrl="/admin/sign-in">
          <Button variant="outline">Sign out</Button>
        </SignOutButton>
      </div>
    </div>
  );
}
