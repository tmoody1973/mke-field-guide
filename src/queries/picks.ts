import { asc, eq } from 'drizzle-orm';
import { staffPicks } from '@/db/schema';
import { loadCardMeta, type Db, type EventCardMeta } from '@/lib/card-data';

export interface PickWithEvent {
  id: string;
  curatorName: string;
  curatorRole: string | null;
  showUrl: string | null;
  blurb: string;
  meta: EventCardMeta;
  nextStartAt: Date | null;
}

function fetchPicksForWeek(db: Db, weekOf: string) {
  return db.query.staffPicks.findMany({
    where: eq(staffPicks.weekOf, weekOf),
    orderBy: [asc(staffPicks.sortOrder)],
    with: { event: { with: { instances: true } } },
  });
}

function toPickWithEvent(
  pick: Awaited<ReturnType<typeof fetchPicksForWeek>>[number],
  metaById: Map<string, EventCardMeta>
): PickWithEvent[] {
  const meta = metaById.get(pick.eventId);
  if (!meta) return [];
  const upcoming = pick.event.instances
    .filter((instance) => instance.startAt.getTime() >= Date.now())
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  return [{
    id: pick.id,
    curatorName: pick.curatorName,
    curatorRole: pick.curatorRole,
    showUrl: pick.showUrl,
    blurb: pick.blurb,
    meta,
    nextStartAt: upcoming[0]?.startAt ?? null,
  }];
}

export async function picksForWeek(db: Db, weekOf: string): Promise<PickWithEvent[]> {
  const picks = await fetchPicksForWeek(db, weekOf);
  const metaById = await loadCardMeta(db, picks.map((pick) => pick.eventId));
  return picks.flatMap((pick) => toPickWithEvent(pick, metaById));
}
