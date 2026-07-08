import Link from 'next/link';

function LogoLockup() {
  {
    /* Brand lockup — "MKE Field Guide", confirmed 2026-07-08. Three stamp blocks. */
  }
  return (
    <span className="flex items-center">
      <span className="border-[3px] border-ink bg-ink px-[9px] pb-1.5 pt-[8px] font-head text-xl leading-none text-rm-orange">MKE</span>
      <span className="border-[3px] border-l-0 border-ink bg-rm-orange px-[9px] pb-1.5 pt-[8px] font-head text-xl leading-none text-ink">FIELD</span>
      <span className="border-[3px] border-l-0 border-ink bg-cream px-[9px] pb-1.5 pt-[8px] font-head text-xl leading-none text-ink">GUIDE</span>
    </span>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b-[3px] border-ink bg-cream">
      <div className="mx-auto flex max-w-[1240px] items-center justify-between gap-4 px-5 py-3">
        <Link href="/" aria-label="Home" className="no-underline">
          <LogoLockup />
        </Link>
        <nav className="flex items-center gap-2.5">
          <Link href="/picks" className="border-[3px] border-transparent px-2.5 py-2 text-sm font-extrabold uppercase tracking-[0.04em] text-ink no-underline hover:border-ink hover:bg-cream-raised">
            Staff picks
          </Link>
          <Link href="/events" className="flex items-center gap-2 border-[3px] border-ink bg-ink px-4 py-2.5 text-sm font-extrabold uppercase tracking-[0.04em] text-cream no-underline shadow-[4px_4px_0_#F8971D] transition-[transform,box-shadow] duration-100 hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0_#F8971D]">
            Browse events ⌕
          </Link>
        </nav>
      </div>
    </header>
  );
}
