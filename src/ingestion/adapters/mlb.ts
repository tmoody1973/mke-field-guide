import { z } from 'zod';
import type { NormalizedEvent } from '@/lib/validation/normalized-event';
import { fetchJson, normalizeWith } from './helpers';
import type { FetchedRecord, SourceAdapter } from './types';

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

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function extractMlbRecords(page: any, homeOnly: boolean): FetchedRecord[] {
  const dates: any[] = page?.dates ?? [];
  const games: any[] = dates.flatMap((d) => d?.games ?? []);
  const records: FetchedRecord[] = [];

  for (const game of games) {
    const gamePk = game?.gamePk;
    if (gamePk == null) continue;

    const homeTeam = game?.teams?.home?.team;
    const awayTeam = game?.teams?.away?.team;
    const homeGame = homeTeam?.id === BREWERS_TEAM_ID;
    if (homeOnly && !homeGame) continue;

    const opponent = homeGame ? awayTeam?.name : homeTeam?.name;
    const title = homeGame ? `Brewers vs ${opponent}` : `Brewers @ ${opponent}`;

    records.push({
      sourceEventId: String(gamePk),
      payload: {
        gamePk: String(gamePk),
        title,
        gameDateUtc: game?.gameDate,
        venueName: game?.venue?.name ?? undefined,
        detailedState: game?.status?.detailedState ?? undefined,
        homeGame,
      },
    });
  }

  return records;
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
  const startDate = todayIso();
  const endDate = addDaysIso(startDate, config.daysAhead);
  const url = new URL(API_URL);
  url.searchParams.set('sportId', '1');
  url.searchParams.set('teamId', String(config.teamId));
  url.searchParams.set('startDate', startDate);
  url.searchParams.set('endDate', endDate);
  return fetchJson(url, {}, 'MLB Stats API schedule');
}

export const mlbAdapter: SourceAdapter = {
  adapterType: 'api',

  async fetch(rawConfig: unknown): Promise<FetchedRecord[]> {
    const config = configSchema.parse(rawConfig);
    const page = await fetchSchedule(config);
    return extractMlbRecords(page, config.homeOnly);
  },

  normalize: normalizeWith(payloadSchema, (p) => ({
    sourceEventId: p.gamePk,
    title: p.title,
    venueName: p.venueName,
    startAt: p.gameDateUtc,
    status: mapStatus(p.detailedState),
  })),
};
