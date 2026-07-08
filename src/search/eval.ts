import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { db } from '@/db';
import { embedQueryWithTimeout } from '@/app/events/embed-query';
import { parseSearchParams, resolveSearch } from '@/app/events/search-params';
import { hasGatewayKey } from '@/enrichment/embed';
import { searchEvents } from '@/search/hybrid';
import { formatRow, hitAt3, median, percentile, type HitResult } from '@/search/eval-utils';

const ITERATIONS = 3;
const QUERIES_PATH = join(process.cwd(), 'eval/search-queries.json');
const ZERO_RESULT_PROBES = ['live music tonight', 'free family events', 'things to do this weekend'];
const ROW_WIDTHS = [48, 10, 6, 40, 16, 16];

const searchQuerySchema = z.object({
  query: z.string(),
  kind: z.enum(['keyword', 'semantic']),
  expectedSlugs: z.array(z.string()),
  draft: z.literal(true).optional(),
});
const searchQueriesSchema = z.array(searchQuerySchema);
type SearchQuery = z.infer<typeof searchQuerySchema>;

interface IterationTiming {
  queryMs: number;
  totalMs: number;
  slugs: string[];
}

interface QueryEvalResult {
  query: string;
  kind: string;
  hit: HitResult;
  topSlugs: string[];
  zeroResult: boolean;
  medianQueryMs: number;
  medianTotalMs: number;
  queryMsSamples: number[];
  totalMsSamples: number[];
}

function loadQueries(): SearchQuery[] {
  const raw = readFileSync(QUERIES_PATH, 'utf-8');
  return searchQueriesSchema.parse(JSON.parse(raw));
}

/** One resolveSearch → embed → searchEvents pass; total includes embedding, query-only does not. */
async function runIteration(queryText: string, now: Date): Promise<IterationTiming> {
  const params = parseSearchParams({ q: queryText });
  const { text, filters } = resolveSearch(params, now);
  const totalStart = performance.now();
  const queryEmbedding = await embedQueryWithTimeout(text ?? '');
  const queryStart = performance.now();
  const hits = await searchEvents(db, { text, queryEmbedding, filters });
  const queryMs = performance.now() - queryStart;
  const totalMs = performance.now() - totalStart;
  return { queryMs, totalMs, slugs: hits.map((hit) => hit.slug) };
}

async function evalQuery(entry: SearchQuery, now: Date): Promise<QueryEvalResult> {
  const iterations: IterationTiming[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    iterations.push(await runIteration(entry.query, now));
  }
  const lastRun = iterations[iterations.length - 1];
  const topSlugs = lastRun.slugs.slice(0, 3);
  return {
    query: entry.query,
    kind: entry.kind,
    hit: hitAt3(topSlugs, entry.expectedSlugs, entry.draft),
    topSlugs,
    zeroResult: lastRun.slugs.length === 0,
    medianQueryMs: median(iterations.map((it) => it.queryMs)),
    medianTotalMs: median(iterations.map((it) => it.totalMs)),
    queryMsSamples: iterations.map((it) => it.queryMs),
    totalMsSamples: iterations.map((it) => it.totalMs),
  };
}

function formatHit(hit: HitResult): string {
  if (hit === 'n/a') return 'n/a';
  return hit ? 'HIT' : 'MISS';
}

function printQueryTable(results: QueryEvalResult[]): void {
  console.log('\nPer-query results:');
  console.log(formatRow(['query', 'kind', 'hit@3', 'top-3 slugs', 'median query ms', 'median total ms'], ROW_WIDTHS));
  for (const result of results) {
    const row = [
      result.query,
      result.kind,
      formatHit(result.hit),
      result.topSlugs.join(', ') || '(none)',
      result.medianQueryMs.toFixed(1),
      result.medianTotalMs.toFixed(1),
    ];
    console.log(formatRow(row, ROW_WIDTHS));
  }
}

function printSummary(results: QueryEvalResult[]): void {
  const nonDraftResults = results.filter((result) => result.hit !== 'n/a');
  const hitCount = nonDraftResults.filter((result) => result.hit === true).length;
  const hitRate = nonDraftResults.length ? (hitCount / nonDraftResults.length) * 100 : 0;
  const allQueryMs = results.flatMap((result) => result.queryMsSamples);
  const allTotalMs = results.flatMap((result) => result.totalMsSamples);
  const zeroResultQueries = results.filter((result) => result.zeroResult).map((result) => result.query);

  console.log('\nSummary:');
  console.log(`  hit@3 rate (non-draft): ${hitRate.toFixed(1)}% (${hitCount}/${nonDraftResults.length})`);
  console.log(`  query-only ms: p50=${percentile(allQueryMs, 0.5).toFixed(1)}  p95=${percentile(allQueryMs, 0.95).toFixed(1)}`);
  console.log(`  total ms:      p50=${percentile(allTotalMs, 0.5).toFixed(1)}  p95=${percentile(allTotalMs, 0.95).toFixed(1)}`);
  console.log(`  zero-result queries: ${zeroResultQueries.length ? zeroResultQueries.join(', ') : 'none'}`);
}

async function runZeroResultProbes(now: Date): Promise<void> {
  console.log('\nZero-result probes:');
  for (const probe of ZERO_RESULT_PROBES) {
    const { slugs } = await runIteration(probe, now);
    const flag = slugs.length === 0 ? '  <-- ZERO RESULTS' : '';
    console.log(`  "${probe}": ${slugs.length} results${flag}`);
  }
}

function printModeHeader(): void {
  console.log(
    hasGatewayKey()
      ? 'AI_GATEWAY_API_KEY present — running hybrid search (FTS + vector).'
      : 'AI_GATEWAY_API_KEY absent — running FTS-only (query embedding skipped).',
  );
}

async function main(): Promise<void> {
  const now = new Date();
  printModeHeader();
  const queries = loadQueries();
  const results: QueryEvalResult[] = [];
  for (const entry of queries) {
    results.push(await evalQuery(entry, now));
  }
  printQueryTable(results);
  printSummary(results);
  await runZeroResultProbes(now);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
