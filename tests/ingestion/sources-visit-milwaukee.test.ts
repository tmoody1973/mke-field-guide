import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { enrichVisitMilwaukeeDetail } from '@/ingestion/adapters/html/sources/visit-milwaukee';
import type { FetchedRecord } from '@/ingestion/adapters/types';

const detailHtml = readFileSync(
  join(process.cwd(), 'tests/fixtures/html/visit-milwaukee-detail.html'),
  'utf8',
);

const record = (startDate?: string, endDate?: string): FetchedRecord => ({
  sourceEventId: 'https://www.visitmilwaukee.org/event/x/1/',
  payload: { id: 'https://www.visitmilwaukee.org/event/x/1/', name: 'X', startDate, endDate },
});

const dates = (r: FetchedRecord) => r.payload as { startDate?: string; endDate?: string };

const varsHtml = (startVar: string, endVar?: string) =>
  `<script>
    var startDate = "${startVar}";
    ${endVar ? `var endDate = "${endVar}";` : ''}
  </script>`;

describe('enrichVisitMilwaukeeDetail', () => {
  test('upgrades date-only start/end using the real detail page inline vars', () => {
    const out = enrichVisitMilwaukeeDetail(record('2026-07-07', '2026-07-07'), detailHtml);
    expect(dates(out).startDate).toBe('2026-07-08T01:00:00.000Z'); // 8:00 PM CDT
    expect(dates(out).endDate).toBe('2026-07-08T03:00:00.000Z'); // 10:00 PM CDT
  });

  test('leaves the record untouched when the inline date disagrees with the JSON-LD date', () => {
    const input = record('2026-08-01', '2026-08-01');
    const out = enrichVisitMilwaukeeDetail(input, detailHtml);
    expect(out).toBe(input);
  });

  test('never clobbers an already-timed startDate', () => {
    const timed = '2026-07-07T19:00:00-05:00';
    const out = enrichVisitMilwaukeeDetail(record(timed, '2026-07-07'), detailHtml);
    expect(dates(out).startDate).toBe(timed);
  });

  test('drops a same-day date-only endDate when only the start gains a time', () => {
    const html = varsHtml('Tuesday, July 7, 2026 8:00 PM');
    const out = enrichVisitMilwaukeeDetail(record('2026-07-07', '2026-07-07'), html);
    expect(dates(out).startDate).toBe('2026-07-08T01:00:00.000Z');
    expect(dates(out).endDate).toBeUndefined();
  });

  test('keeps a later-day date-only endDate when only the start gains a time', () => {
    const html = varsHtml('Tuesday, July 7, 2026 8:00 PM');
    const out = enrichVisitMilwaukeeDetail(record('2026-07-07', '2026-09-30'), html);
    expect(dates(out).endDate).toBe('2026-09-30');
  });

  test('rolls a cross-midnight end forward instead of ending before the start', () => {
    const html = varsHtml('Tuesday, July 7, 2026 11:00 PM', 'Tuesday, July 7, 2026 1:00 AM');
    const out = enrichVisitMilwaukeeDetail(record('2026-07-07', '2026-07-07'), html);
    expect(dates(out).startDate).toBe('2026-07-08T04:00:00.000Z');
    expect(dates(out).endDate).toBe('2026-07-08T06:00:00.000Z'); // +24h roll
  });

  test('returns the record unchanged when the page has no usable vars', () => {
    const input = record('2026-07-07', '2026-07-07');
    const out = enrichVisitMilwaukeeDetail(input, '<html><body>nothing</body></html>');
    expect(out).toBe(input);
  });
});
