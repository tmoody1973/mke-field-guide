/**
 * One-time venue pins (Radio Commons events slice). DRY RUN ONLY: reads `venues.txt` (id|name|address, exported
 * read-only from the database), asks Amazon Location once per venue through the AWS CLI (the operator's own
 * `aws login`; stored-use tier because the coordinates are kept), and writes geocode-plan.json (accepted, with the
 * matched label) and geocode-skipped.json (with the reason). Applying the plan is a separate, reviewed step.
 *
 * Usage: npx tsx scripts/geocode-venues.ts <folder containing venues.txt>
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { acceptMatch, type GeoCandidate } from '../src/lib/venue-geocode';

const folder = process.argv[2];
if (!folder) throw new Error('Usage: npx tsx scripts/geocode-venues.ts <folder>');
const MILWAUKEE = '-87.9065,43.0389';

const venues = readFileSync(join(folder, 'venues.txt'), 'utf8').trim().split('\n').map((line) => {
  const [id, name, address] = line.split('|');
  return { id, name, address };
});

const plan: unknown[] = [];
const skipped: unknown[] = [];
for (const venue of venues) {
  let candidates: GeoCandidate[] = [];
  try {
    const out = execFileSync('aws', [
      'geo-places', 'search-text', '--region', 'us-east-1', '--query-text', venue.address, `--bias-position=[${MILWAUKEE}]`,
      '--filter', 'IncludeCountries=USA', '--max-results', '3', '--intended-use', 'Storage', '--output', 'json',
    ], { encoding: 'utf8' });
    const items = (JSON.parse(out).ResultItems ?? []) as { Title?: string; Address?: { Label?: string }; Position?: [number, number] }[];
    candidates = items.flatMap((item) => (item.Position ? [{ title: item.Title ?? '', label: item.Address?.Label ?? item.Title ?? '', lng: item.Position[0], lat: item.Position[1] }] : []));
  } catch (error) {
    skipped.push({ ...venue, reason: `lookup failed: ${String(error).slice(0, 120)}` });
    continue;
  }
  const match = candidates.map((c) => acceptMatch(venue, c)).find(Boolean);
  if (match) plan.push({ ...venue, ...match });
  else skipped.push({ ...venue, reason: candidates.length ? `no confident match (best: ${candidates[0].label})` : 'no result' });
}
writeFileSync(join(folder, 'geocode-plan.json'), JSON.stringify(plan, null, 2));
writeFileSync(join(folder, 'geocode-skipped.json'), JSON.stringify(skipped, null, 2));
console.log(`looked up ${venues.length}: ${plan.length} accepted, ${skipped.length} skipped`);
