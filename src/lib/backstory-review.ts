import type { Episode } from '@/lib/backstory-types';

export type ItemTable = 'mentions' | 'places' | 'storyTopics' | 'storyActions';
export type Attention = 'no_pin' | 'uncertain_pin' | 'passing_mention';
export type RemoveReason = 'wrong' | 'sensitive' | 'minor';

/** One reviewable thing on the page, whatever table it lives in. */
export interface ReviewItem {
  key: string;
  table: ItemTable;
  id: string;
  title: string;
  kind: string;
  detail: string | null;
  quote: string;
  startMs: number;
  status: 'pending' | 'approved' | 'rejected';
  removeReason: RemoveReason | null;
  attention: Attention | null;
  /** The mention a spelling fix or a location attaches to; null for topics and actions. */
  renameMentionId: string | null;
  canLocate: boolean;
  hasPin: boolean;
  category: string;
  placeId: string | null;
  neighborhood: string | null;
}

export const ATTENTION_COPY: Record<Attention, string> = {
  no_pin: 'No map pin yet. Add a location, or it stays off Alexa.',
  uncertain_pin: "The map match isn't certain. Check the address.",
  passing_mention: 'Possibly only mentioned in passing.',
};

export const REASON_COPY: Record<RemoveReason, string> = {
  wrong: 'Wrong',
  sensitive: 'True, but keep off Alexa',
  minor: 'Too minor',
};

const LOCATABLE = new Set(['organization', 'event']);

export function toReviewItems(episode: Episode): ReviewItem[] {
  const common = { placeId: null, neighborhood: null, hasPin: false, category: 'venue' };
  const places: ReviewItem[] = episode.places.map((p) => ({
    ...common, key: `places:${p.id}`, table: 'places', id: p.id, title: p.officialName ?? p.name, kind: 'place',
    detail: p.geocodeLabel ?? p.category, quote: p.quote, startMs: p.startMs, status: p.reviewStatus, removeReason: p.removeReason,
    attention: p.attention, renameMentionId: p.mentionId, canLocate: true, hasPin: p.geocodeLabel !== null,
    category: p.category, placeId: p.id, neighborhood: p.neighborhood,
  }));
  const mentions: ReviewItem[] = episode.mentions.map((m) => ({
    ...common, key: `mentions:${m.id}`, table: 'mentions', id: m.id, title: m.name, kind: m.entityType, detail: null,
    quote: m.quote, startMs: m.startMs, status: m.reviewStatus, removeReason: m.removeReason, attention: m.attention,
    renameMentionId: m.id, canLocate: LOCATABLE.has(m.entityType), hasPin: episode.places.some((p) => p.mentionId === m.id),
  }));
  const topics: ReviewItem[] = episode.topics.map((t) => ({
    ...common, key: `storyTopics:${t.id}`, table: 'storyTopics', id: t.id, title: t.topic, kind: 'topic', detail: null,
    quote: t.quote, startMs: t.startMs, status: t.reviewStatus, removeReason: t.removeReason, attention: t.attention,
    renameMentionId: null, canLocate: false,
  }));
  const actions: ReviewItem[] = episode.actions.map((a) => ({
    ...common, key: `storyActions:${a.id}`, table: 'storyActions', id: a.id, title: a.label, kind: 'action', detail: a.place,
    quote: a.quote, startMs: a.startMs, status: a.reviewStatus, removeReason: a.removeReason, attention: a.attention,
    renameMentionId: null, canLocate: false,
  }));
  return [...places, ...mentions, ...topics, ...actions];
}

/** Undecided items the system flagged come first; everything else is kept unless removed. */
export function splitForReview(items: ReviewItem[]) {
  const needs = (item: ReviewItem) => item.status === 'pending' && item.attention !== null;
  return { needsYou: items.filter(needs), looksRight: items.filter((item) => !needs(item)) };
}

/** What Alexa could share if published now (decision 010: removed items and unpinned pending places stay off). */
export function publishPreview(items: ReviewItem[]) {
  const live = items.filter((i) => i.status !== 'rejected' && !(i.table === 'places' && i.status === 'pending' && i.attention));
  return {
    people: live.filter((i) => i.table === 'mentions' && i.kind === 'person').length,
    organizations: live.filter((i) => i.table === 'mentions' && i.kind !== 'person').length,
    places: live.filter((i) => i.table === 'places').length,
    topics: live.filter((i) => i.table === 'storyTopics').length,
    actions: live.filter((i) => i.table === 'storyActions').length,
  };
}

/** Rough review time for the queue: ~45s per item that needs you, ~5s per other item. */
export function minutesEstimate(items: number, needsYou: number): number {
  return Math.max(1, Math.ceil((needsYou * 45 + (items - needsYou) * 5) / 60));
}

export type Shortcut = 'next' | 'prev' | 'keep' | 'remove' | 'hear' | 'help';
const SHORTCUTS: Record<string, Shortcut> = { j: 'next', k: 'prev', y: 'keep', r: 'remove', h: 'hear', '?': 'help' };
const TYPING = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** Single-key shortcuts for the review page; never while typing. */
export function shortcutAction(key: string, targetTag: string): Shortcut | null {
  return TYPING.has(targetTag) ? null : (SHORTCUTS[key] ?? null);
}

const PODTRAC = /^https?:\/\/dts\.podtrac\.com\/redirect\.mp3\//;

/** Podtrac is a download-counting hop that ad and tracker blockers block; Dovetail behind it serves the same file. */
export function directAudioUrl(url: string): string {
  return PODTRAC.test(url) ? url.replace(PODTRAC, 'https://') : url;
}

export const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

/** A save confirmation that names its item, for the page-level status line (a card can move after it saves). */
export function announcement(subject: string, state: { ok: boolean; message: string }): { ok: boolean; text: string } | null {
  if (!state.message) return null;
  return { ok: state.ok, text: `${state.ok ? '✓ ' : ''}${subject}: ${state.message}` };
}
