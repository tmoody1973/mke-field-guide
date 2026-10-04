import { describe, expect, it } from 'vitest';
import { REASON_COPY } from '@/lib/backstory-review';

describe('remove reasons say what they do', () => {
  it('"private" warns it blocks quotes; out-of-town places have a plain choice that does not', () => {
    expect(REASON_COPY).toEqual({
      wrong: 'Wrong',
      minor: 'Not local or too minor',
      sensitive: 'Private: never say or quote',
    });
  });
});
