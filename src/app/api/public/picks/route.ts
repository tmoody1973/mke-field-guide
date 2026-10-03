import { db } from '@/db';
import { PUBLIC_CACHE } from '@/lib/public-api';
import { publicPicks } from '@/queries/public-events';

/** This week's Radio Milwaukee staff picks, topped up with station events, for Radio Commons (Alexa+). */
export async function GET(request: Request) {
  if ([...new URL(request.url).searchParams.keys()].length) return Response.json({ error: 'No settings.' }, { status: 400 });
  return Response.json({ events: await publicPicks(db, new Date()) }, { headers: PUBLIC_CACHE });
}
