import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';

export const sources = pgTable('sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  adapterType: text('adapter_type', {
    enum: ['api', 'ical', 'rss', 'html', 'firecrawl'],
  }).notNull(),
  config: jsonb('config').notNull().default({}),
  healthStatus: text('health_status', { enum: ['ok', 'failing', 'unknown'] })
    .notNull()
    .default('unknown'),
  lastFetchAt: timestamp('last_fetch_at', { withTimezone: true }),
  lastError: text('last_error'),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
  lastFetchedCount: integer('last_fetched_count'),
  lastPublishedCount: integer('last_published_count'),
  lastSkippedCount: integer('last_skipped_count'),
  // Trigger.dev run id of the most recent ingest attempt (success OR failure) —
  // the admin dashboard deep-links to the run detail. Null for CLI/manual ingests.
  lastRunId: text('last_run_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const rawEvents = pgTable(
  'raw_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    sourceEventId: text('source_event_id').notNull(),
    sourceUrl: text('source_url'),
    extractionMethod: text('extraction_method').notNull(),
    payload: jsonb('payload').notNull(),
    contentHash: text('content_hash').notNull(),
    extractedAt: timestamp('extracted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('raw_events_source_event_hash_idx').on(
      t.sourceId,
      t.sourceEventId,
      t.contentHash,
    ),
    index('raw_events_source_event_idx').on(t.sourceId, t.sourceEventId),
  ],
);

export const venues = pgTable(
  'venues',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    address: text('address'),
    lat: numeric('lat'),
    lng: numeric('lng'),
    neighborhood: text('neighborhood'),
    slug: text('slug'),
    // Annotate-only registry link (judge precedent): the resolution sweep writes ONLY
    // these two columns. registryId is an Overture GERS id into venue_registry (loose
    // reference, no FK — registry refreshes replace rows). registryMatchedAt is the
    // one-shot attempt gate: stamped on every attempt, including "no confident match".
    registryId: text('registry_id'),
    registryMatchedAt: timestamp('registry_matched_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('venues_normalized_name_idx').on(t.normalizedName)],
);

export const organizers = pgTable(
  'organizers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    url: text('url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('organizers_normalized_name_idx').on(t.normalizedName)],
);

export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    title: text('title').notNull(),
    normalizedTitle: text('normalized_title').notNull(),
    summary: text('summary'),
    description: text('description'),
    status: text('status', { enum: ['scheduled', 'cancelled', 'postponed'] })
      .notNull()
      .default('scheduled'),
    category: text('category'),
    imageUrl: text('image_url'),
    canonicalUrl: text('canonical_url'),
    venueId: uuid('venue_id').references(() => venues.id),
    organizerId: uuid('organizer_id').references(() => organizers.id),
    isFree: boolean('is_free'),
    isStationEvent: boolean('is_station_event').notNull().default(false),
    embedding: vector('embedding', { dimensions: 1536 }),
    embeddedAt: timestamp('embedded_at', { withTimezone: true }),
    contentFingerprint: text('content_fingerprint'),
    vibeTags: text('vibe_tags').array(),
    audienceTags: text('audience_tags').array(),
    // Admin-locked fields ('title'|'status'|'venue'|'time'): ingestion must not
    // overwrite these — see updateEventRow/persistNormalizedEvent in ingestion/persist.ts.
    lockedFields: text('locked_fields').array().notNull().default([]),
    // Advisory AI title-cleanup proposal (propose-only — a human applies via the
    // editor, which locks + records provenance). titleSuggestedAt is a one-shot
    // gate: set on every sweep verdict (incl. "already clean") and kept on dismiss.
    titleSuggestion: text('title_suggestion'),
    titleSuggestedAt: timestamp('title_suggested_at', { withTimezone: true }),
    priceMin: numeric('price_min'),
    priceMax: numeric('price_max'),
    // search_tsv is a tsvector maintained by a BEFORE INSERT/UPDATE trigger (0011_search-tsv.sql).
    // A generated STORED column is impossible on ANY Postgres: array_to_string() is STABLE,
    // not IMMUTABLE — the trigger is the permanent design, not a workaround.
    // Queried via raw sql only, deliberately outside drizzle schema management.
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('events_normalized_title_idx').on(t.normalizedTitle)],
);

export const eventInstances = pgTable(
  'event_instances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    sourceId: uuid('source_id').references(() => sources.id, { onDelete: 'set null' }),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }),
    timezone: text('timezone').notNull().default('America/Chicago'),
    status: text('status', { enum: ['scheduled', 'cancelled', 'postponed'] })
      .notNull()
      .default('scheduled'),
  },
  (t) => [
    uniqueIndex('event_instances_event_start_idx').on(t.eventId, t.startAt),
    index('event_instances_start_at_idx').on(t.startAt),
  ],
);

export const eventSourceLinks = pgTable(
  'event_source_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    sourceEventId: text('source_event_id').notNull(),
    sourceUrl: text('source_url'),
    isCanonical: boolean('is_canonical').notNull().default(true),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('event_source_links_source_event_idx').on(t.sourceId, t.sourceEventId)],
);

export const eventsRelations = relations(events, ({ one, many }) => ({
  venue: one(venues, { fields: [events.venueId], references: [venues.id] }),
  organizer: one(organizers, { fields: [events.organizerId], references: [organizers.id] }),
  instances: many(eventInstances),
  sourceLinks: many(eventSourceLinks),
}));

export const eventInstancesRelations = relations(eventInstances, ({ one }) => ({
  event: one(events, { fields: [eventInstances.eventId], references: [events.id] }),
}));

export const eventSourceLinksRelations = relations(eventSourceLinks, ({ one }) => ({
  event: one(events, { fields: [eventSourceLinks.eventId], references: [events.id] }),
  source: one(sources, { fields: [eventSourceLinks.sourceId], references: [sources.id] }),
}));

export const venuesRelations = relations(venues, ({ many }) => ({
  events: many(events),
}));

// Variant venue names (e.g. "Cactus Club - 2496 S Wentworth Ave") resolved to their
// canonical venue at ingest — written by mergeVenues when it absorbs a variant row.
// Cascade: an alias is meaningless without its canonical venue.
export const venueAliases = pgTable(
  'venue_aliases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    normalizedName: text('normalized_name').notNull(),
    venueId: uuid('venue_id')
      .notNull()
      .references(() => venues.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('venue_aliases_normalized_name_idx').on(t.normalizedName)],
);

export const venueAliasesRelations = relations(venueAliases, ({ one }) => ({
  venue: one(venues, { fields: [venueAliases.venueId], references: [venues.id] }),
}));

// Advisory AI venue-merge proposals (propose-only — a human applies via the
// existing mergeVenues path). FK cascade: an applied merge deletes the absorbed
// venue and this row with it; 'dismissed' rows persist and block re-proposal
// together with the unique pair index.
export const venueMergeSuggestions = pgTable(
  'venue_merge_suggestions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    keepVenueId: uuid('keep_venue_id')
      .notNull()
      .references(() => venues.id, { onDelete: 'cascade' }),
    absorbVenueId: uuid('absorb_venue_id')
      .notNull()
      .references(() => venues.id, { onDelete: 'cascade' }),
    confidence: numeric('confidence').notNull(),
    rationale: text('rationale').notNull(),
    status: text('status', { enum: ['pending', 'dismissed'] }).notNull().default('pending'),
    // Proposal provenance: 'registry' rows carry real-world-identity evidence (shared
    // GERS entity / address match) — the dataset a future auto-merge ruling is judged on.
    source: text('source', { enum: ['llm', 'registry'] }).notNull().default('llm'),
    evidence: jsonb('evidence'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('venue_merge_suggestions_pair_idx').on(t.keepVenueId, t.absorbVenueId)],
);

export const venueMergeSuggestionsRelations = relations(venueMergeSuggestions, ({ one }) => ({
  keepVenue: one(venues, { fields: [venueMergeSuggestions.keepVenueId], references: [venues.id] }),
  absorbVenue: one(venues, { fields: [venueMergeSuggestions.absorbVenueId], references: [venues.id] }),
}));

// Overture Maps places slice for Milwaukee metro (imported via registry:import;
// refreshed manually — venue churn is slow). Internal-only this slice: used to
// resolve venue identity, never displayed publicly.
export const venueRegistry = pgTable(
  'venue_registry',
  {
    id: text('id').primaryKey(), // Overture GERS id — stable real-world-entity identifier
    name: text('name').notNull(),
    category: text('category'),
    address: text('address'),
    locality: text('locality'),
    lon: numeric('lon').notNull(),
    lat: numeric('lat').notNull(),
    confidence: numeric('confidence'),
    importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('venue_registry_name_trgm_idx').using('gin', sql`lower(${t.name}) gin_trgm_ops`)],
);

export const eventClusters = pgTable('event_clusters', {
  id: uuid('id').primaryKey().defaultRandom(),
  canonicalEventId: uuid('canonical_event_id')
    .notNull()
    .references(() => events.id, { onDelete: 'cascade' }),
  mergedEventSlug: text('merged_event_slug').notNull(),
  mergedEventTitle: text('merged_event_title').notNull(),
  score: numeric('score').notNull(),
  breakdown: jsonb('breakdown').notNull(),
  decidedBy: text('decided_by', { enum: ['auto', 'review'] }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const eventReviews = pgTable(
  'event_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind', { enum: ['duplicate'] }).notNull().default('duplicate'),
    eventAId: uuid('event_a_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    eventBId: uuid('event_b_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    score: numeric('score').notNull(),
    breakdown: jsonb('breakdown').notNull(),
    status: text('status', { enum: ['pending', 'approved', 'rejected'] })
      .notNull()
      .default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    // Advisory AI adjudication (annotate-only — a human still decides). Cascades
    // with the pair; judged_at IS NULL is the sweep's re-judge gate.
    judgeVerdict: text('judge_verdict', { enum: ['same', 'different', 'unsure'] }),
    judgeConfidence: numeric('judge_confidence'),
    judgeRationale: text('judge_rationale'),
    judgedAt: timestamp('judged_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('event_reviews_pair_idx').on(t.eventAId, t.eventBId)],
);

// Provenance for manual admin edits (MOO-258 "writes provenance"). One row per
// changed field per save. Cascade: if the event is later merge-deleted as a
// duplicate, the event_clusters receipt is the durable record — same contract
// as event_reviews.
export const eventEdits = pgTable(
  'event_edits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    editedBy: text('edited_by').notNull(),
    field: text('field').notNull(),
    oldValue: text('old_value'),
    newValue: text('new_value'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('event_edits_event_idx').on(t.eventId, t.createdAt)],
);

export const eventEditsRelations = relations(eventEdits, ({ one }) => ({
  event: one(events, { fields: [eventEdits.eventId], references: [events.id] }),
}));

export const staffPicks = pgTable(
  'staff_picks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    curatorName: text('curator_name').notNull(),
    curatorRole: text('curator_role'),
    showUrl: text('show_url'),
    blurb: text('blurb').notNull(),
    weekOf: date('week_of').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('staff_picks_week_idx').on(table.weekOf, table.sortOrder)],
);

export const newsletterSubscribers = pgTable('newsletter_subscribers', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  source: text('source'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const staffPicksRelations = relations(staffPicks, ({ one }) => ({
  event: one(events, { fields: [staffPicks.eventId], references: [events.id] }),
}));

export const subscriptionAttempts = pgTable(
  'subscription_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ipHash: text('ip_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('subscription_attempts_ip_idx').on(table.ipHash, table.createdAt)],
);
