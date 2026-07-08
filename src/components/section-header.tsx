import Link from 'next/link';

interface SectionHeaderProps {
  eyebrow?: string;
  eyebrowColor?: string;
  title: string;
  seeAllHref?: string;
}

export function SectionHeader({ eyebrow, eyebrowColor = '#C9366B', title, seeAllHref }: SectionHeaderProps) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        {eyebrow && (
          <span className="mb-1.5 block text-xs font-extrabold uppercase tracking-[0.16em]" style={{ color: eyebrowColor }}>
            {eyebrow}
          </span>
        )}
        <h2 className="font-head text-[clamp(26px,3.6vw,44px)] uppercase leading-[0.9]">{title}</h2>
      </div>
      {seeAllHref && (
        <Link href={seeAllHref} className="border-b-[3px] border-rm-orange text-[13px] font-extrabold uppercase tracking-[0.04em] text-ink no-underline hover:text-rm-orange">
          See all →
        </Link>
      )}
    </div>
  );
}
