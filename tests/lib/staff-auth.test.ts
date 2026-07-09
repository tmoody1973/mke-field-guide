import { describe, expect, it } from 'vitest';
import { parseEmailList, staffRoleForEmail } from '@/lib/staff-auth';

describe('parseEmailList', () => {
  it('splits on commas, trims, lowercases, drops empties', () => {
    expect(parseEmailList(' A@x.com, b@Y.org ,,')).toEqual(['a@x.com', 'b@y.org']);
  });
  it('returns empty for undefined, null, or empty string', () => {
    expect(parseEmailList(undefined)).toEqual([]);
    expect(parseEmailList(null)).toEqual([]);
    expect(parseEmailList('')).toEqual([]);
  });
});

describe('staffRoleForEmail', () => {
  const lists = { adminEmails: 'tarik@radiomilwaukee.org', picksEmails: 'dj@radiomilwaukee.org' };
  it('maps admin-list emails to admin', () => {
    expect(staffRoleForEmail('tarik@radiomilwaukee.org', lists)).toBe('admin');
  });
  it('is case-insensitive on both sides', () => {
    expect(staffRoleForEmail('Tarik@RadioMilwaukee.org', lists)).toBe('admin');
    expect(staffRoleForEmail('dj@radiomilwaukee.org', { picksEmails: 'DJ@RadioMilwaukee.org' })).toBe('picks');
  });
  it('maps picks-list emails to picks', () => {
    expect(staffRoleForEmail('dj@radiomilwaukee.org', lists)).toBe('picks');
  });
  it('admin wins when an email is on both lists', () => {
    expect(
      staffRoleForEmail('tarik@radiomilwaukee.org', {
        adminEmails: 'tarik@radiomilwaukee.org',
        picksEmails: 'tarik@radiomilwaukee.org',
      }),
    ).toBe('admin');
  });
  it('returns null for unknown, missing, or empty-env cases', () => {
    expect(staffRoleForEmail('rando@example.com', lists)).toBeNull();
    expect(staffRoleForEmail(null, lists)).toBeNull();
    expect(staffRoleForEmail(undefined, {})).toBeNull();
    expect(staffRoleForEmail('tarik@radiomilwaukee.org', {})).toBeNull();
  });
});

describe('staffRoleForEmail domain entries', () => {
  const lists = { adminEmails: 'tarik@radiomilwaukee.org', picksEmails: '@radiomilwaukee.org' };
  it('grants the role to any email at an @domain entry', () => {
    expect(staffRoleForEmail('dj@radiomilwaukee.org', lists)).toBe('picks');
    expect(staffRoleForEmail('newhire@radiomilwaukee.org', lists)).toBe('picks');
  });
  it('is case-insensitive for domain entries', () => {
    expect(staffRoleForEmail('DJ@RadioMilwaukee.ORG', lists)).toBe('picks');
    expect(staffRoleForEmail('dj@radiomilwaukee.org', { picksEmails: '@RadioMilwaukee.ORG' })).toBe('picks');
  });
  it('exact admin entry outranks a domain picks entry', () => {
    expect(staffRoleForEmail('tarik@radiomilwaukee.org', lists)).toBe('admin');
  });
  it('supports domain entries in the admin list too', () => {
    expect(staffRoleForEmail('anyone@radiomilwaukee.org', { adminEmails: '@radiomilwaukee.org' })).toBe('admin');
  });
  it('does not match other domains, lookalike suffixes, or subdomains', () => {
    expect(staffRoleForEmail('evil@notradiomilwaukee.org', lists)).toBeNull();
    expect(staffRoleForEmail('evil@radiomilwaukee.org.attacker.com', lists)).toBeNull();
    expect(staffRoleForEmail('evil@sub.radiomilwaukee.org', lists)).toBeNull();
  });
  it('mixed exact and domain entries in one list both work', () => {
    const mixed = { picksEmails: 'guest@example.com, @radiomilwaukee.org' };
    expect(staffRoleForEmail('guest@example.com', mixed)).toBe('picks');
    expect(staffRoleForEmail('dj@radiomilwaukee.org', mixed)).toBe('picks');
    expect(staffRoleForEmail('other@example.com', mixed)).toBeNull();
  });
});
