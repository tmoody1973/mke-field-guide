/** Brand name confirmed by Tarik 2026-07-08. */
export const SITE_NAME = 'MKE Field Guide';
/** Carries the "Milwaukee events" head term — SEO-load-bearing, keep the phrase intact. */
export const SITE_TAGLINE = 'Milwaukee events, powered by Radio Milwaukee';

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

/** Verified live 2026-07-08 — see task-6 report for curl evidence. */
export const STREAMS = {
  '88Nine': { slug: '88nine', url: 'https://wyms.streamguys1.com/live' },
  HYFIN: { slug: 'hyfin', url: 'https://wyms.streamguys1.com/hyfin' },
  'Rhythm Lab': { slug: 'rhythmlab', url: 'https://wyms.streamguys1.com/rhythmLabRadio' },
  '414 Music': { slug: '414music', url: 'https://wyms.streamguys1.com/414music_aac' },
} as const;

export type StationKey = keyof typeof STREAMS;
export type StationSlug = (typeof STREAMS)[StationKey]['slug'];

export const RM_PLAYLIST_CONVEX_URL = process.env.RM_PLAYLIST_CONVEX_URL;
