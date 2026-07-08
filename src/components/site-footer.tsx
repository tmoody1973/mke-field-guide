import Image from 'next/image';
import Link from 'next/link';
import { SITE_TAGLINE } from '@/lib/site';

const DISCOVER_LINKS = [
  { href: '/events/tonight', label: 'Tonight' },
  { href: '/events/this-weekend', label: 'This weekend' },
  { href: '/free-events', label: 'Free events' },
  { href: '/live-music', label: 'Live music' },
  { href: '/events', label: 'Browse all events' },
] as const;

const LISTEN_LINKS = [
  { href: 'https://radiomilwaukee.org', label: '88Nine Radio Milwaukee' },
  { href: 'https://hyfin.org', label: 'HYFIN' },
] as const;

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t-[3px] border-ink bg-ink text-[#C4C8CC]">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-start justify-between gap-7 px-5 py-10">
        <div className="max-w-[340px]">
          <p className="mb-4 text-sm font-medium leading-normal">{SITE_TAGLINE}</p>
          <span className="inline-flex items-center gap-2.5 border-2 border-cream bg-cream px-3 py-2">
            <Image src="/brand/crescendo-charcoal.png" alt="" width={86} height={50} className="h-5 w-auto" />
            <span className="text-xs font-extrabold uppercase tracking-[0.06em] text-ink">Powered by Radio Milwaukee</span>
          </span>
        </div>
        <div className="flex flex-wrap gap-11">
          <FooterColumn title="Discover" links={DISCOVER_LINKS} />
          <FooterColumn title="Listen" links={LISTEN_LINKS} />
        </div>
      </div>
      <div className="border-t border-cream/20 px-5 py-3.5 text-center text-xs font-semibold text-ink-subtle">
        © 2026 · A Radio Milwaukee project · Milwaukee, WI
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }: { title: string; links: readonly { href: string; label: string }[] }) {
  return (
    <div>
      <div className="mb-2.5 font-head text-base text-cream">{title}</div>
      <div className="flex flex-col gap-[7px] text-sm font-semibold">
        {links.map((link) => (
          <Link key={link.href} href={link.href} className="text-[#C4C8CC] no-underline hover:text-rm-orange">
            {link.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
