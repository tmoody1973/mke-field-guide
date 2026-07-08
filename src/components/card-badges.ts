import { CREAM, GOLD, INK, ORANGE, RED } from '@/lib/design';
import type { EventCardMeta } from '@/lib/card-data';

export interface CardBadge {
  label: string;
  bg: string;
  fg: string;
  strike?: boolean;
}

/** VERIFIED against src/enrichment/tag.ts AUDIENCE_TAG_VALUES (line 13). */
const AGE_RESTRICTED_TAG = '21-plus';
const FAMILY_TAG = 'family-friendly';

export function audienceLabel(audienceTags: string[]): string {
  if (audienceTags.includes(AGE_RESTRICTED_TAG)) return '21+';
  if (audienceTags.includes(FAMILY_TAG)) return 'Family';
  return 'All ages';
}

export function cardBadges(meta: EventCardMeta): CardBadge[] {
  const badges: CardBadge[] = [];
  if (meta.status === 'cancelled') badges.push({ label: 'Cancelled', bg: INK, fg: CREAM, strike: true });
  if (meta.isFree) badges.push({ label: 'Free', bg: RED, fg: '#FFFFFF' });
  if (meta.isStationEvent) badges.push({ label: 'Radio Milwaukee', bg: ORANGE, fg: INK });
  const audience = audienceLabel(meta.audienceTags);
  if (audience === '21+') badges.push({ label: '21+', bg: INK, fg: CREAM });
  if (audience === 'Family') badges.push({ label: 'Family', bg: GOLD, fg: INK });
  return badges;
}
