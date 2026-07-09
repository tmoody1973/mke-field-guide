export type StaffRole = 'admin' | 'picks';

export interface StaffEnvLists {
  adminEmails?: string;
  picksEmails?: string;
}

export function parseEmailList(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

export function staffRoleForEmail(
  email: string | null | undefined,
  lists: StaffEnvLists,
): StaffRole | null {
  if (!email) return null;
  const normalized = email.trim().toLowerCase();
  if (parseEmailList(lists.adminEmails).includes(normalized)) return 'admin';
  if (parseEmailList(lists.picksEmails).includes(normalized)) return 'picks';
  return null;
}
