interface MarqueeProps {
  text: string;
}

/** Duplicated span + translateX(-50%) loop = seamless ticker (mockup pattern). */
export function Marquee({ text }: MarqueeProps) {
  const strip = `${text}  ///  `;
  return (
    <div className="overflow-hidden whitespace-nowrap border-b-[3px] border-ink bg-ink">
      <div className="inline-block animate-[mke-marquee_26s_linear_infinite] py-[7px]">
        <span className="font-head text-[13px] tracking-[0.06em] text-rm-orange">{strip.repeat(4)}</span>
        <span className="font-head text-[13px] tracking-[0.06em] text-rm-orange">{strip.repeat(4)}</span>
      </div>
    </div>
  );
}
