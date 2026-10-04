import Link from 'next/link';

export const BACKSTORY_SHOWS = [
  { slug: '', name: 'All shows' },
  { slug: 'this-bites', name: 'This Bites' },
  { slug: 'uniquely-milwaukee', name: 'Uniquely Milwaukee' },
  { slug: 'ladies-first', name: 'Ladies First' },
  { slug: 'milwaukee-music-premiere', name: 'Music Premieres' },
  { slug: 'studio-milwaukee', name: 'Studio Milwaukee' },
];

const TABS = [
  { key: 'episodes', name: 'Needs review', href: '/admin/backstory' },
  { key: 'published', name: 'Published', href: '/admin/backstory/published' },
  { key: 'places', name: 'Places & organizations', href: '/admin/backstory/places' },
] as const;

/** The Backstory admin's sections; the current one is marked for screen readers and shown filled. */
export function BackstoryTabs({ current }: { current: (typeof TABS)[number]['key'] }) {
  return (
    <nav aria-label="Backstory sections" className="flex flex-wrap gap-2">
      {TABS.map((tab) =>
        tab.key === current ? (
          <span key={tab.key} aria-current="page" className="border-[3px] border-ink bg-ink px-3 py-1 font-semibold text-cream">{tab.name}</span>
        ) : (
          <Link key={tab.key} href={tab.href} className="border-[3px] border-ink px-3 py-1 font-semibold">{tab.name}</Link>
        ),
      )}
    </nav>
  );
}
