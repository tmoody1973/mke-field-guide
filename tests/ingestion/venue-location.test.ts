import { describe, expect, it } from 'vitest';
import { splitLocationName } from '@/ingestion/adapters/venue-location';

describe('splitLocationName', () => {
  it('strips a dash-delimited street address (the mke-shows shape)', () => {
    expect(splitLocationName('Cactus Club - 2496 S Wentworth Ave')).toBe('Cactus Club');
  });
  it('keeps dashes that are part of the venue name', () => {
    expect(splitLocationName('The Rave - Eagles Club')).toBe('The Rave - Eagles Club');
  });
  it('still splits on comma first', () => {
    expect(splitLocationName('Turner Hall Ballroom, 1040 N 4th St, Milwaukee')).toBe('Turner Hall Ballroom');
  });
  it('applies the dash rule to the comma-split head', () => {
    expect(splitLocationName('Linneman\'s Riverwest Inn - 1001 E Locust St, Milwaukee, WI')).toBe(
      'Linneman\'s Riverwest Inn',
    );
  });
  it('passes through clean names and handles undefined/empty', () => {
    expect(splitLocationName('Pabst Theater')).toBe('Pabst Theater');
    expect(splitLocationName(undefined)).toBeUndefined();
    expect(splitLocationName('   ')).toBeUndefined();
  });
});
