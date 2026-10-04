import { describe, expect, it } from 'vitest';
import { publishedSchema } from '@/lib/backstory-types';

describe('publishedSchema', () => {
  it('reads Backstory review.published rows', () => {
    const rows = publishedSchema.parse([{
      storyId: 'jn75', title: 'Ladies First: Arlo Parks', showSlug: 'ladies-first', showName: 'Ladies First',
      publishedAt: 1790000000000, doNotUse: false, newVersionWaiting: false,
    }]);
    expect(rows[0]).toMatchObject({ title: 'Ladies First: Arlo Parks', newVersionWaiting: false });
  });
});
