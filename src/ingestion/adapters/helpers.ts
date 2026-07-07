import { z } from 'zod';
import { normalizedEventSchema, type NormalizedEvent } from '@/lib/validation/normalized-event';
import type { FetchedRecord } from './types';

const BOT_UA = 'MKEEventsBot/0.1 (event aggregation; Milwaukee, WI)';

export function requireEnv(name: string, hint: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set — ${hint}`);
  return value;
}

export function toFiniteNumber(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

async function fetchOk(url: URL | string, init: RequestInit, label: string): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: { 'user-agent': BOT_UA, ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${label} fetch failed (${res.status})`);
  return res;
}

export async function fetchJson(
  url: URL | string,
  init: RequestInit,
  label: string,
): Promise<unknown> {
  return (await fetchOk(url, init, label)).json();
}

export async function fetchText(url: URL | string, label: string): Promise<string> {
  return (await fetchOk(url, {}, label)).text();
}

export function normalizeWith<T>(
  payloadSchema: z.ZodType<T>,
  map: (p: T) => unknown,
): (record: FetchedRecord) => NormalizedEvent | null {
  return (record) => {
    const parsed = payloadSchema.safeParse(record.payload);
    if (!parsed.success) return null;
    const result = normalizedEventSchema.safeParse(map(parsed.data));
    return result.success ? result.data : null;
  };
}
