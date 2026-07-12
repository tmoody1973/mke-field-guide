import { schedules } from '@trigger.dev/sdk';
import { db } from '@/db';
import { dedupSweep } from '@/dedup/sweep';
import { runRetention } from '@/maintenance/retention';
import { enrichSweep } from '@/enrichment/sweep';
import { proposeVenueMerges } from '@/maintenance/venue-proposals';
import { resolveVenues } from '@/maintenance/registry-resolve';

// 20 pairs x 15s worst-case model call = 300s, half of the 600s cron task budget (the S5 rule).
const CRON_PROPOSAL_LIMIT = 20;
const CRON_RESOLUTION_LIMIT = 50;

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

/** Weekly venue-registry resolution (annotate-only + registry-evidence proposals; geocode tier no-ops without its key). Runs 30 min before venue-proposals-weekly so fresh annotations inform its exclusions. Worst case: 25 geocode calls × 10s = 250s, under half the 600s budget. */
export const venueResolutionWeekly = schedules.task({
  id: 'venue-resolution-weekly',
  cron: { pattern: '30 8 * * 1', timezone: 'America/Chicago' },
  run: async () => resolveVenues(db, { limit: CRON_RESOLUTION_LIMIT }),
});

/** Weekly venue-merge proposals (advisory; humans apply in /admin/venues). Key-gated no-op. */
export const venueProposalsWeekly = schedules.task({
  id: 'venue-proposals-weekly',
  cron: { pattern: '0 9 * * 1', timezone: 'America/Chicago' },
  run: async () => proposeVenueMerges(db, { limit: CRON_PROPOSAL_LIMIT }),
});
