import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

async function main() {
  const [key, url] = process.argv.slice(2);
  if (!key || !url) {
    console.error('Usage: npm run capture:fixture -- <source-key> <listing-url>');
    process.exit(1);
  }
  const res = await fetch(url, {
    headers: { 'user-agent': 'MKEEventsBot/0.1 (event aggregation; Milwaukee, WI)' },
  });
  if (!res.ok) throw new Error(`capture failed (${res.status}) for ${url}`);
  const dir = join(process.cwd(), 'tests/fixtures/html');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${key}.html`);
  writeFileSync(file, await res.text());
  console.log(`wrote ${file}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
