import { db } from '@/db';
import { parsePublicEventsQuery, PUBLIC_CACHE } from '@/lib/public-api';
import { publicEvents } from '@/queries/public-events';

/** Read-only upcoming events for Radio Commons (Alexa+): only what the public site already shows. */
export async function GET(request: Request) {
  const parsed = parsePublicEventsQuery(new URL(request.url).searchParams);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const events = await publicEvents(db, { ...parsed.opts, now: new Date() });
  return Response.json({ events }, { headers: PUBLIC_CACHE });
}
