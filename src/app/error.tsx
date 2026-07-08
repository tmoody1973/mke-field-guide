'use client';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto my-16 max-w-[560px] border-[3px] border-dashed border-ink bg-cream-raised px-7 py-14 text-center">
      <div className="mb-3 font-head text-[40px] uppercase leading-[0.9]">Well, that skipped.</div>
      <p className="mb-5 font-semibold text-ink-muted">Something went sideways on our end. Give it another spin.</p>
      <button
        type="button"
        onClick={reset}
        className="inline-block border-[3px] border-ink bg-rm-orange px-5 py-3 text-sm font-extrabold uppercase tracking-[0.04em] text-ink shadow-[4px_4px_0_#1F2528] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0_#1F2528]"
      >
        Try again
      </button>
    </div>
  );
}
