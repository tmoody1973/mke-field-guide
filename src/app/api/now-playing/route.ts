import { ConvexHttpClient } from 'convex/browser';
import { anyApi } from 'convex/server';
import { z } from 'zod';
import { RM_PLAYLIST_CONVEX_URL } from '@/lib/site';

const stationParam = z.enum(['88nine', 'hyfin', 'rhythmlab', '414music']);

/** External data — validate the shape we consume, pass through nothing else.
 *  Field names confirmed against rm-playlist-v2's PublicPlay (buildPublicPlay
 *  in packages/convex/convex/plays.ts): artist/title/playedAt match verbatim. */
const playSchema = z.object({
  artist: z.string().min(1),
  title: z.string().min(1),
  playedAt: z.number(),
});

const STALE_MS = 20 * 60 * 1000;
const NONE = { none: true } as const;

function respond(body: unknown): Response {
  return Response.json(body, {
    headers: { 'Cache-Control': 's-maxage=15, stale-while-revalidate=30' },
  });
}

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get('station');
  const station = stationParam.safeParse(raw);
  if (!station.success) return new Response('Unknown station', { status: 400 });
  if (!RM_PLAYLIST_CONVEX_URL) return respond(NONE); // credential-pending — never crash

  try {
    const client = new ConvexHttpClient(RM_PLAYLIST_CONVEX_URL);
    const play = playSchema.safeParse(
      await client.query(anyApi.plays.currentByStation, { stationSlug: station.data }),
    );
    if (!play.success || Date.now() - play.data.playedAt > STALE_MS) return respond(NONE);
    return respond({ artist: play.data.artist, title: play.data.title });
  } catch {
    return respond(NONE);
  }
}
