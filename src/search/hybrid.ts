import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '@/ingestion/persist';
import type { TimeOfDay } from '@/search/query-understanding';

export interface SearchFilters {
  window?: { start: Date; end: Date };
  category?: string;
  venue?: string; // venues.normalized_name exact
  neighborhood?: string; // venues.neighborhood exact
  free?: boolean;
  vibe?: string; // ANY(vibe_tags)
  audience?: string; // ANY(audience_tags)
  timeOfDay?: TimeOfDay;
  maxPrice?: number; // price_min <= maxPrice
}

export interface SearchHit {
  eventId: string;
  slug: string;
  title: string;
  venueName: string | null;
  nextStartAt: Date;
  isFree: boolean | null;
  score: number;
}

export interface SearchArgs {
  text?: string;
  queryEmbedding?: number[];
  filters?: SearchFilters;
  limit?: number;
}

const DEFAULT_LIMIT = 50;
const VECTOR_LEG_LIMIT = 50;
const RRF_K = 60;

/** Chicago-local hour range for a time-of-day bucket; "night" wraps past midnight (21 -> 03). */
function timeOfDayClause(timeOfDay: TimeOfDay): SQL {
  const hour = sql`EXTRACT(HOUR FROM (ei.start_at AT TIME ZONE 'America/Chicago'))`;
  if (timeOfDay === 'morning') return sql`(${hour} >= 5 AND ${hour} < 12)`;
  if (timeOfDay === 'afternoon') return sql`(${hour} >= 12 AND ${hour} < 17)`;
  if (timeOfDay === 'evening') return sql`(${hour} >= 17 AND ${hour} < 21)`;
  return sql`(${hour} >= 21 OR ${hour} < 3)`;
}

/** Future-instances guard plus the optional date window and time-of-day bucket. */
function windowClause(filters?: SearchFilters): SQL {
  const clauses: SQL[] = [sql`ei.start_at >= now()`];
  if (filters?.window) {
    clauses.push(sql`ei.start_at >= ${filters.window.start}`, sql`ei.start_at <= ${filters.window.end}`);
  }
  if (filters?.timeOfDay) clauses.push(timeOfDayClause(filters.timeOfDay));
  return sql.join(clauses, sql` AND `);
}

/** Event/venue facet filters applied alongside the window clause in the base CTE. */
function facetClauses(filters?: SearchFilters): SQL {
  const clauses: SQL[] = [];
  if (filters?.category) clauses.push(sql`e.category = ${filters.category}`);
  if (filters?.free) clauses.push(sql`e.is_free = true`);
  if (filters?.vibe) clauses.push(sql`${filters.vibe} = ANY(e.vibe_tags)`);
  if (filters?.audience) clauses.push(sql`${filters.audience} = ANY(e.audience_tags)`);
  if (filters?.maxPrice !== undefined) clauses.push(sql`e.price_min <= ${filters.maxPrice}`);
  if (filters?.venue) clauses.push(sql`v.normalized_name = ${filters.venue}`);
  if (filters?.neighborhood) clauses.push(sql`v.neighborhood = ${filters.neighborhood}`);
  if (clauses.length === 0) return sql`TRUE`;
  return sql.join(clauses, sql` AND `);
}

/** Future instances joined to events/venues, grouped to one row per event with next_start_at. */
function baseCte(filters?: SearchFilters): SQL {
  return sql`
    base AS (
      SELECT e.id AS event_id, e.slug, e.title, e.is_free, v.name AS venue_name,
             MIN(ei.start_at) AS next_start_at
      FROM event_instances ei
      JOIN events e ON e.id = ei.event_id
      LEFT JOIN venues v ON v.id = e.venue_id
      WHERE ${windowClause(filters)} AND ${facetClauses(filters)}
      GROUP BY e.id, e.slug, e.title, e.is_free, v.name
    )
  `;
}

/** Weighted FTS + trigram leg: rank within the base's event set, then number the rows. */
function ftsLeg(text: string): SQL {
  const rankExpr = sql`ts_rank(e.search_tsv, websearch_to_tsquery('english', ${text}))
    + 0.5 * similarity(e.normalized_title, ${text})
    + 0.3 * COALESCE(similarity(v.normalized_name, ${text}), 0)`;
  return sql`
    fts AS (
      SELECT b.*, ROW_NUMBER() OVER (ORDER BY ${rankExpr} DESC) AS r
      FROM base b
      JOIN events e ON e.id = b.event_id
      LEFT JOIN venues v ON v.id = e.venue_id
      WHERE e.search_tsv @@ websearch_to_tsquery('english', ${text})
         OR similarity(e.normalized_title, ${text}) > 0.3
         OR similarity(v.normalized_name, ${text}) > 0.4
    )
  `;
}

/** Cosine-distance vector leg, pre-limited to the nearest 50 within the base's event set. */
function vecLeg(queryEmbedding: number[]): SQL {
  const vectorLiteral = `[${queryEmbedding.join(',')}]`;
  return sql`
    vec AS (
      SELECT b.*, ROW_NUMBER() OVER (ORDER BY e.embedding <=> ${vectorLiteral}::vector) AS r
      FROM base b
      JOIN events e ON e.id = b.event_id
      ORDER BY e.embedding <=> ${vectorLiteral}::vector
      LIMIT ${VECTOR_LEG_LIMIT}
    )
  `;
}

/** Fuses both legs by event_id with reciprocal rank fusion. */
function bothLegsSelect(limit: number): SQL {
  return sql`
    SELECT
      COALESCE(fts.event_id, vec.event_id) AS event_id,
      COALESCE(fts.slug, vec.slug) AS slug,
      COALESCE(fts.title, vec.title) AS title,
      COALESCE(fts.venue_name, vec.venue_name) AS venue_name,
      COALESCE(fts.next_start_at, vec.next_start_at) AS next_start_at,
      COALESCE(fts.is_free, vec.is_free) AS is_free,
      COALESCE(1.0 / (${RRF_K} + fts.r), 0) + COALESCE(1.0 / (${RRF_K} + vec.r), 0) AS score
    FROM fts
    FULL OUTER JOIN vec ON vec.event_id = fts.event_id
    ORDER BY score DESC, next_start_at ASC
    LIMIT ${limit}
  `;
}

/** Ranks a single leg (fts-only or vec-only) by its own RRF term. */
function singleLegSelect(legName: 'fts' | 'vec', limit: number): SQL {
  const leg = sql.raw(legName);
  return sql`
    SELECT event_id, slug, title, venue_name, next_start_at, is_free,
      1.0 / (${RRF_K} + r) AS score
    FROM ${leg}
    ORDER BY score DESC, next_start_at ASC
    LIMIT ${limit}
  `;
}

/** No text and no embedding: pure facet browse ordered by soonest upcoming instance. */
function browseSelect(limit: number): SQL {
  return sql`
    SELECT event_id, slug, title, venue_name, next_start_at, is_free, 0 AS score
    FROM base
    ORDER BY next_start_at ASC
    LIMIT ${limit}
  `;
}

/** Picks the final SELECT shape based on which legs are present. */
function rrfSelect(hasText: boolean, hasVec: boolean, limit: number): SQL {
  if (hasText && hasVec) return bothLegsSelect(limit);
  if (hasText) return singleLegSelect('fts', limit);
  if (hasVec) return singleLegSelect('vec', limit);
  return browseSelect(limit);
}

function toSearchHit(row: Record<string, unknown>): SearchHit {
  return {
    eventId: String(row.event_id),
    slug: String(row.slug),
    title: String(row.title),
    venueName: row.venue_name === null ? null : String(row.venue_name),
    nextStartAt: new Date(row.next_start_at as string),
    isFree: row.is_free === null ? null : Boolean(row.is_free),
    score: Number(row.score),
  };
}

export async function searchEvents(db: Db, args: SearchArgs): Promise<SearchHit[]> {
  const { text, queryEmbedding, filters, limit = DEFAULT_LIMIT } = args;
  const ctes: SQL[] = [baseCte(filters)];
  if (text) ctes.push(ftsLeg(text));
  if (queryEmbedding) ctes.push(vecLeg(queryEmbedding));
  const select = rrfSelect(Boolean(text), Boolean(queryEmbedding), limit);
  const query = sql`WITH ${sql.join(ctes, sql`, `)} ${select}`;
  const result = await db.execute(query);
  return (result.rows as Record<string, unknown>[]).map(toSearchHit);
}
