// Imports an Overture Maps venue slice (JSONL, produced locally by
// scripts/venue-registry-slice.sql) into venue_registry. Upserts by GERS id.
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import * as schema from '@/db/schema';
import type { Db } from '@/db/types';

const IMPORT_BATCH_SIZE = 500;

export const registryRowSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: z.string().nullable().default(null),
  address: z.string().nullable().default(null),
  locality: z.string().nullable().default(null),
  lon: z.number(),
  lat: z.number(),
  confidence: z.number().nullable().default(null),
});
export type RegistryRow = z.infer<typeof registryRowSchema>;

export async function importRegistryRows(db: Db, rows: RegistryRow[]): Promise<{ upserted: number }> {
  let upserted = 0;
  for (let start = 0; start < rows.length; start += IMPORT_BATCH_SIZE) {
    const batch = rows.slice(start, start + IMPORT_BATCH_SIZE);
    const inserted = await db
      .insert(schema.venueRegistry)
      .values(batch.map((row) => ({
        id: row.id,
        name: row.name,
        category: row.category,
        address: row.address,
        locality: row.locality,
        lon: String(row.lon),
        lat: String(row.lat),
        confidence: row.confidence === null ? null : String(row.confidence),
      })))
      .onConflictDoUpdate({
        target: schema.venueRegistry.id,
        set: {
          name: sql`excluded.name`,
          category: sql`excluded.category`,
          address: sql`excluded.address`,
          locality: sql`excluded.locality`,
          lon: sql`excluded.lon`,
          lat: sql`excluded.lat`,
          confidence: sql`excluded.confidence`,
          importedAt: sql`now()`,
        },
      })
      .returning({ id: schema.venueRegistry.id });
    upserted += inserted.length;
  }
  return { upserted };
}

function parseJsonlLine(line: string): RegistryRow | null {
  try {
    const parsed = registryRowSchema.safeParse(JSON.parse(line));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function parseJsonlRows(fileContents: string): { rows: RegistryRow[]; invalidCount: number } {
  const lines = fileContents.split('\n').filter((line) => line.trim().length > 0);
  const rows: RegistryRow[] = [];
  let invalidCount = 0;
  for (const line of lines) {
    const row = parseJsonlLine(line);
    if (row) {
      rows.push(row);
    } else {
      invalidCount += 1;
    }
  }
  return { rows, invalidCount };
}

async function main(): Promise<void> {
  const jsonlPath = process.argv[2];
  if (!jsonlPath) {
    console.error('Usage: npm run registry:import <path-to-jsonl>');
    process.exit(1);
  }

  const fileContents = readFileSync(jsonlPath, 'utf8');
  const { rows, invalidCount } = parseJsonlRows(fileContents);

  const { db } = await import('@/db');
  const { upserted } = await importRegistryRows(db, rows);
  console.log(`imported ${upserted}, invalid ${invalidCount}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
