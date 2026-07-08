import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import * as schema from '@/db/schema';
import type { Db } from '@/ingestion/persist';
import { chicagoParts } from '@/lib/chicago-time';

export interface AddStaffPickInput {
  slug: string;
  curatorName: string;
  curatorRole?: string;
  showUrl?: string;
  blurb: string;
  weekOf: string;
  sortOrder?: number;
}

export async function addStaffPick(db: Db, input: AddStaffPickInput) {
  const event = await db.query.events.findFirst({ where: eq(schema.events.slug, input.slug) });
  if (!event) throw new Error(`Unknown event slug: ${input.slug}`);
  const [pick] = await db
    .insert(schema.staffPicks)
    .values({
      eventId: event.id,
      curatorName: input.curatorName,
      curatorRole: input.curatorRole,
      showUrl: input.showUrl,
      blurb: input.blurb,
      weekOf: input.weekOf,
      sortOrder: input.sortOrder ?? 0,
    })
    .returning();
  return pick;
}

/** Monday (YYYY-MM-DD) of the current America/Chicago calendar week. */
function currentChicagoWeekMonday(now: Date = new Date()): string {
  const parts = chicagoParts(now.getTime());
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0=Sun..6=Sat
  const daysSinceMonday = (weekday + 6) % 7; // Mon=0
  const monday = new Date(Date.UTC(year, month - 1, day - daysSinceMonday));
  return monday.toISOString().slice(0, 10);
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      out[argv[i].slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return out;
}

const cliArgsSchema = z.object({
  slug: z.string().min(1, 'slug is required'),
  curator: z.string().min(1, 'curator is required'),
  blurb: z.string().min(1, 'blurb is required'),
  role: z.string().optional(),
  'show-url': z.string().url().optional(),
  'week-of': z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sort: z.coerce.number().int().optional(),
});

async function main(): Promise<void> {
  const raw = parseArgs(process.argv.slice(2));
  const parsed = cliArgsSchema.parse(raw);
  const { db } = await import('@/db');
  const pick = await addStaffPick(db, {
    slug: parsed.slug,
    curatorName: parsed.curator,
    curatorRole: parsed.role,
    showUrl: parsed['show-url'],
    blurb: parsed.blurb,
    weekOf: parsed['week-of'] ?? currentChicagoWeekMonday(),
    sortOrder: parsed.sort,
  });
  console.log(`staff pick added: ${pick.id} (${parsed.curator} — ${parsed.slug}, week of ${pick.weekOf})`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err instanceof z.ZodError ? err.issues.map((issue) => issue.message).join('; ') : err);
    process.exit(1);
  });
}
