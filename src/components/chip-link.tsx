import Link from 'next/link';

interface ChipLinkProps {
  href: string;
  active?: boolean;
  children: React.ReactNode;
}

/** Server-rendered facet chip: state lives in the URL, active chips link to their removal. */
export function ChipLink({ href, active = false, children }: ChipLinkProps) {
  const activeClasses = 'bg-rm-orange text-ink shadow-[2px_2px_0_#1F2528]';
  const idleClasses = 'bg-cream text-ink shadow-[2px_2px_0_rgba(31,37,40,0.25)]';
  return (
    <Link
      href={href}
      className={`inline-block border-[3px] border-ink px-[13px] py-[7px] text-[13px] font-extrabold transition-transform duration-100 hover:translate-x-[1px] hover:translate-y-[1px] ${active ? activeClasses : idleClasses}`}
    >
      {children}
    </Link>
  );
}
