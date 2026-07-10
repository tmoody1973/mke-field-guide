import type { PgDatabase } from 'drizzle-orm/pg-core';
import * as schema from '@/db/schema';

// The one canonical Db type. Historical homes (ingestion/persist.ts, lib/card-data.ts)
// re-export it so their ~17 importers compile unchanged.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<any, typeof schema>;
