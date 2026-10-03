import { describe, expect, it } from 'vitest';
import { acceptMatch } from '@/lib/venue-geocode';

const near = { lat: 43.04, lng: -87.91 };
describe('acceptMatch', () => {
  it('accepts a result named like the venue, in the Milwaukee area', () => {
    expect(acceptMatch({ name: 'The Cooperage', address: '822 S Water St' }, { title: 'Cooperage', label: 'Cooperage, 822 S Water St, Milwaukee, WI', ...near }))
      .toEqual({ lat: 43.04, lng: -87.91, label: 'Cooperage, 822 S Water St, Milwaukee, WI' });
  });
  it('accepts a result at the same street address even if the name differs', () => {
    expect(acceptMatch({ name: 'Club Garibaldi', address: '2501 S Superior St, Milwaukee' }, { title: '2501 S Superior St', label: '2501 S Superior St, Milwaukee, WI 53207', ...near })).not.toBeNull();
  });
  it('rejects a different place, or anything far from Milwaukee', () => {
    expect(acceptMatch({ name: 'Cactus Club', address: '2496 S Wentworth Ave' }, { title: 'Starbucks', label: 'Starbucks, 100 E Wisconsin Ave', ...near })).toBeNull();
    expect(acceptMatch({ name: 'The Cooperage', address: '822 S Water St' }, { title: 'Cooperage', label: 'Cooperage, Chicago, IL', lat: 41.88, lng: -87.63 })).toBeNull();
  });
  it('a shared generic word is not a match', () => {
    expect(acceptMatch({ name: 'Milwaukee Bar', address: null }, { title: 'Milwaukee Public Library', label: 'Milwaukee Public Library', ...near })).toBeNull();
  });
  it('"108 East Wells Street" and "108 E Wells St" are the same address', () => {
    expect(acceptMatch({ name: 'Checota Powerhouse Theater', address: '108 East Wells Street, Milwaukee, WI 53202' }, { title: '108 E Wells St', label: '108 E Wells St, Milwaukee, WI 53202', ...near })).not.toBeNull();
  });
});

