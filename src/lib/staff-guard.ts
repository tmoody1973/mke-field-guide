import { auth, currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { staffRoleForEmail, type StaffRole } from '@/lib/staff-auth';

export interface StaffIdentity {
  role: StaffRole;
  email: string;
}

async function signedInEmail(): Promise<string | null> {
  const user = await currentUser();
  // The allowlist must never key off an unverified address, so only a
  // 'verified' email (primary, or the first verified one) is accepted.
  if (user?.primaryEmailAddress?.verification?.status === 'verified') {
    return user.primaryEmailAddress.emailAddress;
  }
  const verifiedEmail = user?.emailAddresses?.find((email) => email.verification?.status === 'verified');
  return verifiedEmail?.emailAddress ?? null;
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
  // Deliberate double auth() call (also inside currentStaffRole): this one
  // distinguishes "not signed in" (-> sign-in) from "signed in but not staff"
  // (-> denied). Do not collapse into a single call.
  const { isAuthenticated } = await auth();
  if (!isAuthenticated) redirect('/admin/sign-in');
  const staff = await currentStaffRole();
  if (!staff) redirect('/admin/denied');
  if (minimum === 'admin' && staff.role !== 'admin') redirect('/admin/denied');
  return staff;
}
