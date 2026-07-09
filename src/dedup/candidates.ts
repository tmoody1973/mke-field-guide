import { sql } from 'drizzle-orm';
import type { Db } from '@/ingestion/persist';

export interface CandidateRow {
  eventAId: string;
  eventBId: string;
  titleSimilarity: number;
  venueAffinity: number;
  startDeltaMinutes: number | null;
  urlMatch: boolean;
}

const MIN_TITLE_SIMILARITY = 0.3;

/**
 * Cross-source pairs of future events sharing a Chicago calendar day.
 * Midnight-placeholder starts (00:00 Chicago wall time) are excluded from the
 * time-delta signal; pairs already merged or reviewed are excluded entirely.
 */
export async function findCandidates(db: Db): Promise<CandidateRow[]> {
  const result = await db.execute(sql`
    WITH future_instances AS (
      SELECT i.event_id,
             i.start_at,
             (i.start_at AT TIME ZONE 'America/Chicago')::date AS chi_day,
             (i.start_at AT TIME ZONE 'America/Chicago')::time = '00:00:00' AS is_midnight
      FROM event_instances i
      WHERE i.start_at >= now() - interval '1 day'
    ),
    pairs AS (
      SELECT a.event_id AS event_a_id,
             b.event_id AS event_b_id,
             MIN(ABS(EXTRACT(EPOCH FROM (a.start_at - b.start_at)) / 60))
               FILTER (WHERE NOT a.is_midnight AND NOT b.is_midnight) AS start_delta_minutes
      FROM future_instances a
      JOIN future_instances b
        ON a.chi_day = b.chi_day AND a.event_id < b.event_id
      GROUP BY a.event_id, b.event_id
    )
    SELECT p.event_a_id,
           p.event_b_id,
           similarity(ea.normalized_title, eb.normalized_title) AS title_similarity,
           CASE
             WHEN ea.venue_id IS NOT NULL AND ea.venue_id = eb.venue_id THEN 1
             WHEN va.normalized_name IS NOT NULL AND vb.normalized_name IS NOT NULL
               THEN similarity(va.normalized_name, vb.normalized_name)
             ELSE 0.5
           END AS venue_affinity,
           p.start_delta_minutes,
           (ea.canonical_url IS NOT NULL AND ea.canonical_url = eb.canonical_url) AS url_match
    FROM pairs p
    JOIN events ea ON ea.id = p.event_a_id
    JOIN events eb ON eb.id = p.event_b_id
    LEFT JOIN venues va ON va.id = ea.venue_id
    LEFT JOIN venues vb ON vb.id = eb.venue_id
    WHERE similarity(ea.normalized_title, eb.normalized_title) >= ${MIN_TITLE_SIMILARITY}
      AND NOT EXISTS (
        SELECT 1
        FROM event_source_links la
        JOIN event_source_links lb ON la.source_id = lb.source_id
        WHERE la.event_id = p.event_a_id AND lb.event_id = p.event_b_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM event_reviews r
        WHERE r.event_a_id = p.event_a_id AND r.event_b_id = p.event_b_id
      )
    ORDER BY title_similarity DESC, p.event_a_id ASC, p.event_b_id ASC
  `);
  return (result.rows as Record<string, unknown>[]).map(toCandidateRow);
}

function toCandidateRow(row: Record<string, unknown>): CandidateRow {
  return {
    eventAId: String(row.event_a_id),
    eventBId: String(row.event_b_id),
    titleSimilarity: Number(row.title_similarity),
    venueAffinity: Number(row.venue_affinity),
    startDeltaMinutes: row.start_delta_minutes === null ? null : Number(row.start_delta_minutes),
    urlMatch: Boolean(row.url_match),
  };
}
