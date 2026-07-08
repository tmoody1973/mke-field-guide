import { schedules } from '@trigger.dev/sdk';
import { db } from '@/db';
import { dedupSweep } from '@/dedup/sweep';
import { runRetention } from '@/maintenance/retention';
import { enrichSweep } from '@/enrichment/sweep';

/** Between the 6:00 ingest fan-out and the 8:00 dedup sweep; fingerprint-gated and key-gated. */
export const enrichDaily = schedules.task({
  id: 'enrich-daily',
  cron: { pattern: '0 7 * * *', timezone: 'America/Chicago' },
  run: async () => enrichSweep(db),
});

/** Runs after the 6:00 ingest fan-out has had time to drain; sweep is idempotent either way. */
export const dedupDaily = schedules.task({
  id: 'dedup-daily',
  cron: { pattern: '0 8 * * *', timezone: 'America/Chicago' },
  run: async () => dedupSweep(db),
});

export const retentionWeekly = schedules.task({
  id: 'retention-weekly',
  cron: { pattern: '0 4 * * 1', timezone: 'America/Chicago' },
  run: async () => runRetention(db),
});
