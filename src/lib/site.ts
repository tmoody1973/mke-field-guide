/** Working title — final brand name is Tarik's pre-launch decision. Rename HERE only. */
export const SITE_NAME = 'MKE Events';
export const SITE_TAGLINE = 'Milwaukee event discovery, powered by Radio Milwaukee';

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

/** Live-verified in Task 6 (curl + radiomilwaukee.org player source). */
export const STREAMS = {
  '88Nine': 'https://wyms.streamguys1.com/live',
  HYFIN: 'https://wyms.streamguys1.com/hyfin',
} as const;

export type StationKey = keyof typeof STREAMS;
