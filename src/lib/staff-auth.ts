export type StaffRole = 'admin' | 'picks';

export interface StaffEnvLists {
  adminEmails?: string;
  picksEmails?: string;
}

const DOMAIN_RULE = /^@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

// Fail closed: a malformed entry matches no one; warn so an operator typo
// ('@x@y' or a pasted display name) is visible at first use instead of silently dead.
function isWellFormedEntry(entry: string): boolean {
  if (entry.startsWith('@')) return DOMAIN_RULE.test(entry);
  return entry.lastIndexOf('@') > 0;
}

export function parseEmailList(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0)
    .filter((entry) => {
      if (isWellFormedEntry(entry)) return true;
      console.warn(`staff allowlist: ignoring malformed entry "${entry}"`);
      return false;
    });
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
