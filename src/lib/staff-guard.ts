import { auth, currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { staffRoleForEmail, type StaffRole } from '@/lib/staff-auth';

export interface StaffIdentity {
  role: StaffRole;
  email: string;
}

async function signedInEmail(): Promise<string | null> {
  const user = await currentUser();
  return (
    user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses?.[0]?.emailAddress ?? null
  );
}

/** Envelope-friendly check for server actions: returns null instead of redirecting. */
export async function currentStaffRole(): Promise<StaffIdentity | null> {
  const { isAuthenticated } = await auth();
  if (!isAuthenticated) return null;
  const email = await signedInEmail();
  const role = staffRoleForEmail(email, {
    adminEmails: process.env.ADMIN_ALLOWLIST_EMAILS,
    picksEmails: process.env.PICKS_ALLOWLIST_EMAILS,
  });
  return role && email ? { role, email } : null;
}

/** Page gate. Unauthenticated → sign-in; not staff or insufficient tier → denied. */
export async function requireStaff(minimum: StaffRole = 'picks'): Promise<StaffIdentity> {
  const { isAuthenticated } = await auth();
  if (!isAuthenticated) redirect('/admin/sign-in');
  const staff = await currentStaffRole();
  if (!staff) redirect('/admin/denied');
  if (minimum === 'admin' && staff.role !== 'admin') redirect('/admin/denied');
  return staff;
}
