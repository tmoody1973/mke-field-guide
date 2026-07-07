import { createHash } from 'node:crypto';

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function slugify(title: string, sourceEventId: string): string {
  const base = normalizeName(title)
    .replace(/\s/g, '-')
    .slice(0, 60)
    .replace(/^-+|-+$/g, '');
  const hash = createHash('sha256').update(sourceEventId).digest('hex').slice(0, 8);
  return `${base}-${hash}`;
}
