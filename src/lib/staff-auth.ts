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

/**
 * Entries starting with '@' are domain rules (e.g. '@radiomilwaukee.org' matches any
 * email at exactly that domain — not subdomains or lookalike suffixes). The match is
 * anchored at the email's LAST '@' so a quoted local-part containing '@' (RFC 5321
 * allows "a@b"@domain) can't smuggle a foreign mailbox past a suffix check.
 */
function matchesEntry(email: string, entry: string): boolean {
  if (!entry.startsWith('@')) return email === entry;
  return email.slice(email.lastIndexOf('@')) === entry;
}

export function staffRoleForEmail(
  email: string | null | undefined,
  lists: StaffEnvLists,
): StaffRole | null {
  if (!email) return null;
  const normalized = email.trim().toLowerCase();
  if (parseEmailList(lists.adminEmails).some((entry) => matchesEntry(normalized, entry))) {
    return 'admin';
  }
  if (parseEmailList(lists.picksEmails).some((entry) => matchesEntry(normalized, entry))) {
    return 'picks';
  }
  return null;
}
