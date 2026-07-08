export default function NotFound() {
  return (
    <div className="mx-auto my-5 max-w-[560px] border-[3px] border-dashed border-ink bg-cream-raised px-7 py-14 text-center">
      <div className="mb-3 font-head text-[40px] uppercase leading-[0.9]">Crickets.</div>
      <p className="mb-5 font-semibold text-ink-muted">That page wandered off. Try the homepage, or see what's on the calendar.</p>
      <div className="flex flex-wrap justify-center gap-3">
        <a href="/" className="inline-block border-[3px] border-ink bg-rm-orange px-5 py-3 text-sm font-extrabold uppercase tracking-[0.04em] text-ink no-underline shadow-[4px_4px_0_#1F2528] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0_#1F2528]">
          Home
        </a>
        <a href="/events" className="inline-block border-[3px] border-ink bg-cream px-5 py-3 text-sm font-extrabold uppercase tracking-[0.04em] text-ink no-underline shadow-[4px_4px_0_#1F2528] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0_#1F2528]">
          All events
        </a>
      </div>
    </div>
  );
}
