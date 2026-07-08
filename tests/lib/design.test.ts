import { describe, expect, it } from 'vitest';
import { accentForCategory, onAccent, priceLabel } from '@/lib/design';

describe('accentForCategory', () => {
  it('maps known categories to brand accents', () => {
    expect(accentForCategory('music', false)).toBe('#F8971D');
    expect(accentForCategory('comedy', false)).toBe('#C9366B');
  });
  it('forces orange for station events regardless of category', () => {
    expect(accentForCategory('comedy', true)).toBe('#F8971D');
  });
  it('falls back to blue for unknown or null categories', () => {
    expect(accentForCategory('zydeco-polka', false)).toBe('#32588E');
    expect(accentForCategory(null, false)).toBe('#32588E');
  });
});

describe('onAccent', () => {
  it('returns cream text on dark accents', () => {
    expect(onAccent('#32588E')).toBe('#F7F1DB');
    expect(onAccent('#C9366B')).toBe('#F7F1DB');
    expect(onAccent('#E8342A')).toBe('#F7F1DB');
    expect(onAccent('#1F2528')).toBe('#F7F1DB');
  });
  it('returns charcoal text on light accents', () => {
    expect(onAccent('#F8971D')).toBe('#1F2528');
    expect(onAccent('#F2C230')).toBe('#1F2528');
  });
});

describe('priceLabel', () => {
  it('prefers Free when isFree', () => {
    expect(priceLabel({ isFree: true, priceMin: null, priceMax: null })).toBe('Free');
  });
  it('shows From $X when priceMin is set', () => {
    expect(priceLabel({ isFree: false, priceMin: '15', priceMax: null })).toBe('From $15');
  });
  it('drops trailing zeros from numeric strings', () => {
    expect(priceLabel({ isFree: null, priceMin: '12.50', priceMax: null })).toBe('From $12.50');
    expect(priceLabel({ isFree: null, priceMin: '40.00', priceMax: null })).toBe('From $40');
  });
  it('falls back to See tickets when nothing is known', () => {
    expect(priceLabel({ isFree: null, priceMin: null, priceMax: null })).toBe('See tickets');
  });
});
