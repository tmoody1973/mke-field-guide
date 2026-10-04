import { schedules } from '@trigger.dev/sdk';
import { db } from '@/db';
import { fetchLatestConcertPicks } from '@/lib/concert-picks-cds';
import { importConcertPicks } from '@/queries/concert-picks-import';

/** After the 7:00 enrichment: this week's MKE Concert Picks become staff picks (re-runs add nothing). */
export const concertPicksDaily = schedules.task({
  id: 'concert-picks-daily',
  cron: { pattern: '30 7 * * *', timezone: 'America/Chicago' },
  run: async () => {
    const token = process.env.NPR_CDS_TOKEN;
    if (!token) throw new Error('NPR_CDS_TOKEN is not set');
    const article = await fetchLatestConcertPicks(fetch, token);
    if (!article) return { imported: false };
    const result = await importConcertPicks(db, article, { dryRun: false });
    return { imported: true, article: article.id, written: result.written, matched: result.matched.length, unmatched: result.unmatched.length };
  },
});
