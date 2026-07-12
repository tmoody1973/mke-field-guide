import { describe, expect, it } from 'vitest';
import { importRegistryRows, registryRowSchema, type RegistryRow } from '@/maintenance/registry-import';
import { createTestDb } from '../helpers/test-db';

function buildRow(overrides: Partial<RegistryRow> = {}): RegistryRow {
  return {
    id: 'gers-1',
    name: 'Turner Hall Ballroom',
    category: 'music_venue',
    address: '1040 N 4th St',
    locality: 'Milwaukee',
    lon: -87.9146,
    lat: 43.0436,
    confidence: 0.92,
    ...overrides,
  };
}

describe('registryRowSchema', () => {
  it('accepts a full row and a row with null category/address/locality/confidence', () => {
    const fullRow = registryRowSchema.safeParse(buildRow());
    expect(fullRow.success).toBe(true);

    const sparseRow = registryRowSchema.safeParse({
      id: 'gers-2',
      name: 'Cactus Club',
      category: null,
      address: null,
      locality: null,
      lon: -87.9,
      lat: 43.0,
      confidence: null,
    });
    expect(sparseRow.success).toBe(true);
  });

  it('rejects rows missing id, name, or coordinates', () => {
    const missingId = registryRowSchema.safeParse({ ...buildRow(), id: undefined });
    expect(missingId.success).toBe(false);

    const missingName = registryRowSchema.safeParse({ ...buildRow(), name: undefined });
    expect(missingName.success).toBe(false);

    const missingLon = registryRowSchema.safeParse({ ...buildRow(), lon: undefined });
    expect(missingLon.success).toBe(false);

    const missingLat = registryRowSchema.safeParse({ ...buildRow(), lat: undefined });
    expect(missingLat.success).toBe(false);
  });
});

describe('importRegistryRows', () => {
  it('inserts new rows and reports an honest upserted count', async () => {
    const db = await createTestDb();
    const rows = [buildRow({ id: 'gers-1' }), buildRow({ id: 'gers-2', name: 'Cactus Club' })];

    const result = await importRegistryRows(db, rows);

    expect(result.upserted).toBe(2);
    const stored = await db.query.venueRegistry.findMany();
    expect(stored).toHaveLength(2);
    expect(stored.map((row) => row.id).sort()).toEqual(['gers-1', 'gers-2']);
  });

  it('re-import updates name/address in place by id (upsert, no duplicate rows)', async () => {
    const db = await createTestDb();
    await importRegistryRows(db, [buildRow({ id: 'gers-1', name: 'Turner Hall Ballroom', address: '1040 N 4th St' })]);

    const result = await importRegistryRows(db, [
      buildRow({ id: 'gers-1', name: 'Turner Hall (Renamed)', address: '1040 N 4th Street' }),
    ]);

    expect(result.upserted).toBe(1);
    const stored = await db.query.venueRegistry.findMany();
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe('Turner Hall (Renamed)');
    expect(stored[0].address).toBe('1040 N 4th Street');
  });
});
