import { z } from 'zod';
import type { NormalizedEvent } from '@/lib/validation/normalized-event';
import { chicagoParts } from '@/lib/chicago-time';
import { fetchJson, normalizeWith } from './helpers';
import type { FetchedRecord, FetchOutcome, SourceAdapter } from './types';

const configSchema = z.object({
  adapter: z.literal('mlb'),
  teamId: z.number(),
  daysAhead: z.number().default(120),
  homeOnly: z.boolean().default(true),
});

const payloadSchema = z.object({
  gamePk: z.string(),
  title: z.string().min(1),
  gameDateUtc: z.string(),
  venueName: z.string().optional(),
  detailedState: z.string().optional(),
  homeGame: z.boolean(),
});

const API_URL = 'https://statsapi.mlb.com/api/v1/schedule';

// This adapter is Brewers-specific (the flat-payload title is hardcoded to "Brewers vs <away>"),
// so extraction identifies the home side by this constant rather than threading `config.teamId`
// through the pure helper. `config.teamId` still drives the live API query in fetch().
const BREWERS_TEAM_ID = 158;

/**
 * Schedule window derived from America/Chicago wall-clock "today", not UTC.
 * During Chicago evenings UTC has already rolled to tomorrow, which would
 * silently drop that day's home game from the query window.
 */
export function scheduleWindow(now: Date, daysAhead: number): { startDate: string; endDate: string } {
  const p = chicagoParts(now.getTime());
  const startUtcMidnight = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day));
  const format = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return {
    startDate: format(startUtcMidnight),
    endDate: format(startUtcMidnight + daysAhead * 86_400_000),
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function isBrewersHomeGame(game: any): boolean {
  return game?.teams?.home?.team?.id === BREWERS_TEAM_ID;
}

function toRecord(game: any): FetchedRecord {
  const homeGame = isBrewersHomeGame(game);
  const opponent = homeGame ? game?.teams?.away?.team?.name : game?.teams?.home?.team?.name;
  return {
    sourceEventId: String(game.gamePk),
    payload: {
      gamePk: String(game.gamePk),
      title: homeGame ? `Brewers vs ${opponent}` : `Brewers @ ${opponent}`,
      gameDateUtc: game?.gameDate,
      venueName: game?.venue?.name ?? undefined,
      detailedState: game?.status?.detailedState ?? undefined,
      homeGame,
    },
  };
}

export function extractMlbRecords(page: any, homeOnly: boolean): FetchedRecord[] {
  const dates: any[] = page?.dates ?? [];
  return dates
    .flatMap((d) => d?.games ?? [])
    .filter((game) => game?.gamePk != null && (!homeOnly || isBrewersHomeGame(game)))
    .map(toRecord);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function mapStatus(detailedState: string | undefined): NormalizedEvent['status'] {
  if (!detailedState) return 'scheduled';
  if (detailedState.includes('Postponed')) return 'postponed';
  if (detailedState.includes('Cancelled') || detailedState.includes('Canceled')) return 'cancelled';
  return 'scheduled';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchSchedule(config: z.infer<typeof configSchema>): Promise<any> {
  const { startDate, endDate } = scheduleWindow(new Date(), config.daysAhead);
  const url = new URL(API_URL);
  url.searchParams.set('sportId', '1');
  url.searchParams.set('teamId', String(config.teamId));
  url.searchParams.set('startDate', startDate);
  url.searchParams.set('endDate', endDate);
  return fetchJson(url, {}, 'MLB Stats API schedule');
}

export const mlbAdapter: SourceAdapter = {
  adapterType: 'api',

  async fetch(rawConfig: unknown): Promise<FetchOutcome> {
    const config = configSchema.parse(rawConfig);
    const page = await fetchSchedule(config);
    return { records: extractMlbRecords(page, config.homeOnly), parseSkipped: 0 };
  },

  normalize: normalizeWith(payloadSchema, (p) => ({
    sourceEventId: p.gamePk,
    title: p.title,
    venueName: p.venueName,
    startAt: p.gameDateUtc,
    status: mapStatus(p.detailedState),
  })),
};
