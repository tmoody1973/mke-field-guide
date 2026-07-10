import { AbortTaskRunError, queue, schedules, schemaTask } from '@trigger.dev/sdk';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { resolveAdapter } from '@/ingestion/adapters/registry';
import { filterDueSources, type Cadence } from '@/ingestion/cadence';
import { ingestSource } from '@/ingestion/ingest';

/**
 * concurrencyLimit 1 + a per-source concurrencyKey at trigger time = strictly
 * serial runs per source (the link-race guard), parallel across sources.
 */
export const ingestQueue = queue({ name: 'ingest', concurrencyLimit: 1 });

export const ingestSourceTask = schemaTask({
  id: 'ingest-source',
  schema: z.object({ sourceKey: z.string().min(1) }),
  queue: ingestQueue,
  maxDuration: 600,
  run: async ({ sourceKey }, { ctx }) => {
    const source = await db.query.sources.findFirst({
      where: eq(schema.sources.key, sourceKey),
    });
    if (!source) throw new AbortTaskRunError(`Unknown source key: ${sourceKey}`);
    const adapter = resolveAdapter(source);
    return ingestSource(db, source, adapter, ctx.run.id);
  },
});

async function fanOut(cadence: Cadence): Promise<{ triggered: number }> {
  const sources = await db.query.sources.findMany();
  const due = filterDueSources(sources, cadence, new Date());
  if (due.length > 0) {
    await ingestSourceTask.batchTrigger(
      due.map((source) => ({
        payload: { sourceKey: source.key },
        options: { concurrencyKey: source.key },
      })),
    );
  }
  return { triggered: due.length };
}

export const ingestDaily = schedules.task({
  id: 'ingest-daily',
  cron: { pattern: '0 6 * * *', timezone: 'America/Chicago' },
  run: async () => fanOut('daily'),
});

export const ingestWeekly = schedules.task({
  id: 'ingest-weekly',
  cron: { pattern: '0 5 * * 1', timezone: 'America/Chicago' },
  run: async () => fanOut('weekly'),
});
