import type { SearchParams } from './search-params';

export type FacetPatch = Partial<Record<keyof SearchParams, string | undefined>>;

/** URL-state facet navigation: merge current params with a patch; undefined deletes. */
export function buildFacetHref(current: Partial<Record<string, string | number>>, patch: FacetPatch): string {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(current)) {
    if (value !== undefined && value !== '') merged[key] = String(value);
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete merged[key];
    else merged[key] = value;
  }
  const query = new URLSearchParams(merged).toString();
  return query ? `/events?${query}` : '/events';
}
