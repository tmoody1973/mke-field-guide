import Link from 'next/link';

function LogoLockup() {
  {
    /* Brand lockup — "MKE Field Guide", confirmed 2026-07-08. Three stamp blocks. */
  }
  return (
    <span className="flex items-center">
      <span className="border-[3px] border-ink bg-ink px-2 pb-1 pt-[7px] font-head text-base leading-none text-rm-orange sm:px-[9px] sm:pb-1.5 sm:pt-[8px] sm:text-xl">MKE</span>
      <span className="border-[3px] border-l-0 border-ink bg-rm-orange px-2 pb-1 pt-[7px] font-head text-base leading-none text-ink sm:px-[9px] sm:pb-1.5 sm:pt-[8px] sm:text-xl">FIELD</span>
      <span className="border-[3px] border-l-0 border-ink bg-cream px-2 pb-1 pt-[7px] font-head text-base leading-none text-ink sm:px-[9px] sm:pb-1.5 sm:pt-[8px] sm:text-xl">GUIDE</span>
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
          <Link href="/picks" className="hidden border-[3px] border-transparent px-2.5 py-2 text-sm font-extrabold uppercase tracking-[0.04em] text-ink no-underline hover:border-ink hover:bg-cream-raised sm:inline-block">
            Staff picks
          </Link>
          <Link href="/events" className="flex items-center gap-2 border-[3px] border-ink bg-ink px-3 py-2.5 text-sm font-extrabold uppercase tracking-[0.04em] text-cream no-underline shadow-[4px_4px_0_#F8971D] transition-[transform,box-shadow] duration-100 hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0_#F8971D] sm:px-4">
            <span className="hidden sm:inline">Browse events ⌕</span>
            <span className="sm:hidden">Browse ⌕</span>
          </Link>
        </nav>
      </div>
    </header>
  );
}
