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
