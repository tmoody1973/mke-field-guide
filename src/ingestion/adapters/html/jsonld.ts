import * as cheerio from 'cheerio';
import { toFiniteNumber } from '../helpers';
import type { FetchedRecord } from '../types';

/* eslint-disable @typescript-eslint/no-explicit-any */

function flattenNodes(parsed: any): any[] {
  if (Array.isArray(parsed)) return parsed.flatMap(flattenNodes);
  if (parsed && typeof parsed === 'object') {
    const graph = parsed['@graph'];
    return Array.isArray(graph) ? [parsed, ...graph.flatMap(flattenNodes)] : [parsed];
  }
  return [];
}

function isEventNode(node: any): boolean {
  const raw = node?.['@type'];
  const types: unknown[] = Array.isArray(raw) ? raw : [raw];
  return types.some(
    (t) => typeof t === 'string' && (t === 'Event' || t === 'Festival' || t.endsWith('Event')),
  );
}

function mapEventStatus(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (value.includes('EventCancelled')) return 'cancelled';
  if (value.includes('EventPostponed') || value.includes('EventRescheduled')) return 'postponed';
  return undefined;
}

function placeFields(location: any) {
  if (typeof location === 'string') return { venueName: location };
  if (!location || typeof location !== 'object') return {};
  const a = location.address;
  const addressParts =
    typeof a === 'string'
      ? [a]
      : [a?.streetAddress, a?.addressLocality, a?.addressRegion].filter(Boolean);
  return {
    venueName: typeof location.name === 'string' ? location.name : undefined,
    venueAddress: addressParts.length > 0 ? addressParts.join(', ') : undefined,
    venueLat: toFiniteNumber(location.geo?.latitude),
    venueLng: toFiniteNumber(location.geo?.longitude),
  };
}

function imageUrl(image: any): string | undefined {
  const first = Array.isArray(image) ? image[0] : image;
  if (typeof first === 'string') return first;
  return typeof first?.url === 'string' ? first.url : undefined;
}

function offerIsFree(offers: any): boolean | undefined {
  const first = Array.isArray(offers) ? offers[0] : offers;
  const price = toFiniteNumber(first?.price ?? first?.lowPrice);
  return price === undefined ? undefined : price === 0;
}

function nodeToRecord(node: any, baseUrl: string): FetchedRecord | null {
  const name = typeof node.name === 'string' ? node.name : undefined;
  if (!name) return null;
  const url = typeof node.url === 'string' ? new URL(node.url, baseUrl).toString() : undefined;
  const id = url ?? (typeof node['@id'] === 'string' ? node['@id'] : `${name}|${node.startDate ?? ''}`);
  return {
    sourceEventId: id,
    sourceUrl: url,
    payload: {
      id,
      name,
      description: typeof node.description === 'string' ? node.description : undefined,
      url,
      startDate: typeof node.startDate === 'string' ? node.startDate : undefined,
      endDate: typeof node.endDate === 'string' ? node.endDate : undefined,
      status: mapEventStatus(node.eventStatus),
      ...placeFields(node.location),
      imageUrl: imageUrl(node.image),
      isFree: offerIsFree(node.offers),
    },
  };
}

export function extractJsonLdEvents(html: string, baseUrl: string): FetchedRecord[] {
  const $ = cheerio.load(html);
  const records: FetchedRecord[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse($(el).contents().text());
    } catch {
      return;
    }
    for (const node of flattenNodes(parsed)) {
      if (!isEventNode(node)) continue;
      const record = nodeToRecord(node, baseUrl);
      if (record) records.push(record);
    }
  });
  const seen = new Set<string>();
  return records.filter((r) => (seen.has(r.sourceEventId) ? false : seen.add(r.sourceEventId)));
}
