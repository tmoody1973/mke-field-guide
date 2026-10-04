// MKE Concert Picks: Radio Milwaukee's weekly list of recommended shows. The list is regular enough to read
// without AI: "Oct. 2: Bright Eyes w/Lullaby For The Working Class @ Turner Hall, 7:30 p.m."

export interface ParsedPick {
  date: string; // YYYY-MM-DD
  headliner: string;
  openers: string[];
  venue: string;
  time: string;
  line: string;
  order: number;
}

const MONTH = '(Jan|Feb|Mar|Apr|May|June?|July?|Aug|Sept?|Oct|Nov|Dec)';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
// CDS runs the list's lines together ("…7 p.m.Oct. 1: …"), so split before each "<Mon>. <day>: ".
const LINE_START = new RegExp(`(?=${MONTH}\\.? \\d{1,2}: )`);
const LINE = new RegExp(`^${MONTH}\\.? (\\d{1,2}): (.+?) @ (.+?), (.+)$`);
const LIST_HEADING = /^best concerts in milwaukee/i;

export function isConcertPicks(doc: { title: string; url: string | null }): boolean {
  return doc.title.startsWith('MKE Concert Picks:') && !!doc.url?.includes('/concerts/');
}

/** The year of a list date: the article's year, or the next one for January dates in a late-December list. */
function isoDate(monthName: string, day: number, published: Date): string {
  const month = MONTHS.indexOf(monthName.slice(0, 3).toLowerCase());
  const year = published.getFullYear() + (month < published.getMonth() - 6 ? 1 : 0);
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function bill(text: string): { headliner: string; openers: string[] } {
  const [main, support] = text.split(/ w\//);
  const names = main.split(', ').map((s) => s.trim());
  const openers = [...names.slice(1), ...(support ? support.split(', ').map((s) => s.trim()) : [])];
  return { headliner: names[0], openers };
}

/** The list's shows in order; lines that don't fit the pattern are reported, never guessed. */
export function parsePicks(paragraphs: string[], published: Date): { picks: ParsedPick[]; unparsed: string[] } {
  const heading = paragraphs.findIndex((p) => LIST_HEADING.test(p));
  const listText = (heading >= 0 ? paragraphs.slice(heading + 1) : paragraphs).join('');
  const lines = listText.split(LINE_START).map((l) => l.trim()).filter((l) => new RegExp(`^${MONTH}\\.? \\d{1,2}: `).test(l));
  const picks: ParsedPick[] = [];
  const unparsed: string[] = [];
  for (const line of lines) {
    const m = LINE.exec(line);
    if (!m) {
      unparsed.push(line);
      continue;
    }
    const [, month, day, who, venue, time] = m;
    picks.push({ date: isoDate(month, Number(day), published), ...bill(who), venue: venue.trim(), time: time.trim(), line, order: picks.length });
  }
  return { picks, unparsed };
}

/** The write-up paragraph(s) before the list that name this headliner, or null. */
export function spotlightFor(paragraphs: string[], headliner: string): string | null {
  const heading = paragraphs.findIndex((p) => LIST_HEADING.test(p));
  const name = new RegExp(`\\b${headliner.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  const found = (heading >= 0 ? paragraphs.slice(0, heading) : paragraphs).filter((p) => name.test(p));
  return found.length ? found.join(' ') : null;
}
