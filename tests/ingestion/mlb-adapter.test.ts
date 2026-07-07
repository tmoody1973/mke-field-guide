import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { extractMlbRecords, mlbAdapter, scheduleWindow } from '@/ingestion/adapters/mlb';
import { resolveAdapter } from '@/ingestion/adapters/registry';
import type { FetchedRecord } from '@/ingestion/adapters/types';

const page = JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/mlb-schedule.json'), 'utf8'));

interface MlbPayload {
  gamePk: string;
  title: string;
  gameDateUtc: string;
  venueName?: string;
  detailedState?: string;
  homeGame: boolean;
}

function payloadOf(record: FetchedRecord): MlbPayload {
  return record.payload as MlbPayload;
}

describe('extractMlbRecords', () => {
  test('home-only filter excludes away games', () => {
    const records = extractMlbRecords(page, true);
    expect(records).toHaveLength(2);
    expect(records.every((r) => payloadOf(r).homeGame)).toBe(true);
  });

  test('without the home-only filter, away games are included too', () => {
    const records = extractMlbRecords(page, false);
    expect(records).toHaveLength(4);
    expect(records.some((r) => !payloadOf(r).homeGame)).toBe(true);
  });

  test('uses gamePk as sourceEventId', () => {
    const [record] = extractMlbRecords(page, true);
    expect(record.sourceEventId).toBe(String(payloadOf(record).gamePk));
    expect(record.sourceEventId).toMatch(/^\d+$/);
  });

  test('formats home-game titles as "Brewers vs <away team>"', () => {
    const records = extractMlbRecords(page, true);
    const scheduled = records.find((r) => payloadOf(r).detailedState === 'Scheduled');
    expect(scheduled && payloadOf(scheduled).title).toBe('Brewers vs New York Mets');
  });

  test('maps venue name and gameDateUtc onto the flat payload', () => {
    const records = extractMlbRecords(page, true);
    const postponed = records.find((r) => payloadOf(r).detailedState === 'Postponed');
    expect(postponed && payloadOf(postponed).venueName).toBe('American Family Field');
    expect(postponed && payloadOf(postponed).gameDateUtc).toBe('2026-07-17T23:40:00Z');
  });
});

describe('scheduleWindow', () => {
  test('uses the Chicago-local date, not UTC, during Chicago evenings', () => {
    // 2026-07-18T00:30:00Z is still July 17, 7:30 PM CDT in Chicago —
    // a UTC-based "today" would skip that evening's home game.
    const window = scheduleWindow(new Date('2026-07-18T00:30:00Z'), 120);
    expect(window.startDate).toBe('2026-07-17');
    expect(window.endDate).toBe('2026-11-14');
  });

  test('matches the UTC date when Chicago and UTC agree', () => {
    // 2026-07-17T18:00:00Z is July 17, 1:00 PM CDT — same calendar day.
    const window = scheduleWindow(new Date('2026-07-17T18:00:00Z'), 1);
    expect(window.startDate).toBe('2026-07-17');
    expect(window.endDate).toBe('2026-07-18');
  });
});

describe('mlbAdapter.normalize', () => {
  test('maps a scheduled home game to a NormalizedEvent', () => {
    const records = extractMlbRecords(page, true);
    const scheduled = records.find((r) => payloadOf(r).detailedState === 'Scheduled');
    const n = mlbAdapter.normalize(scheduled!);
    expect(n?.title).toBe('Brewers vs New York Mets');
    expect(n?.venueName).toBe('American Family Field');
    expect(n?.status).toBe('scheduled');
    expect(n?.startAt.toISOString()).toBe('2026-07-20T23:40:00.000Z');
  });

  test('maps Postponed detailedState to status postponed', () => {
    const records = extractMlbRecords(page, true);
    const postponed = records.find((r) => payloadOf(r).detailedState === 'Postponed');
    const n = mlbAdapter.normalize(postponed!);
    expect(n?.status).toBe('postponed');
  });
});

describe('resolveAdapter', () => {
  test('resolves the mlb api adapter', () => {
    expect(resolveAdapter({ adapterType: 'api', config: { adapter: 'mlb' } }).adapterType).toBe('api');
  });
});
