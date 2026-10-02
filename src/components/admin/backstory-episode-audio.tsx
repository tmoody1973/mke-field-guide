'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { clock, directAudioUrl } from '@/lib/backstory-review';

interface EpisodeAudio {
  playing: boolean;
  timeMs: number;
  durationMs: number;
  error: string | null;
  /** Jump to a moment and play; stops by itself at untilMs when given (a quote or a speaker's line). */
  playFrom: (startMs: number, untilMs?: number) => void;
  toggle: () => void;
  seek: (ms: number) => void;
}

const Context = createContext<EpisodeAudio | null>(null);

export function useEpisodeAudio(): EpisodeAudio {
  const audio = useContext(Context);
  if (!audio) throw new Error('useEpisodeAudio must be used inside EpisodeAudioProvider');
  return audio;
}

/** One audio element for the whole review page: every Hear-it button and the scrub bar drive it. */
export function EpisodeAudioProvider({ src, children }: { src: string; children: ReactNode }) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const stopAt = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [timeMs, setTimeMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => ref.current?.pause(), []);

  const play = (el: HTMLAudioElement) =>
    el.play().catch(() => setError("Couldn't play the audio. An ad or tracker blocker may be blocking it."));

  const value: EpisodeAudio = {
    playing, timeMs, durationMs, error,
    playFrom(startMs, untilMs) {
      const el = ref.current;
      if (!el) return;
      stopAt.current = untilMs ?? null;
      el.currentTime = startMs / 1000;
      void play(el);
    },
    toggle() {
      const el = ref.current;
      if (!el) return;
      stopAt.current = null;
      if (el.paused) void play(el);
      else el.pause();
    },
    seek(ms) {
      if (ref.current) ref.current.currentTime = ms / 1000;
    },
  };

  return (
    <Context.Provider value={value}>
      <audio
        ref={ref}
        src={directAudioUrl(src)}
        preload="metadata"
        onPlay={() => { setPlaying(true); setError(null); }}
        onPause={() => setPlaying(false)}
        onLoadedMetadata={(e) => setDurationMs(e.currentTarget.duration * 1000)}
        onTimeUpdate={(e) => {
          const ms = e.currentTarget.currentTime * 1000;
          setTimeMs(ms);
          if (stopAt.current !== null && ms >= stopAt.current) {
            stopAt.current = null;
            e.currentTarget.pause();
          }
        }}
        onError={() => { setPlaying(false); setError("Couldn't load the audio. An ad or tracker blocker may be blocking it."); }}
      />
      {children}
    </Context.Provider>
  );
}

/** Play/pause, a scrub bar and ±10 seconds, in the page's sticky bottom bar. */
export function EpisodePlayerBar() {
  const { playing, timeMs, durationMs, error, toggle, seek } = useEpisodeAudio();
  const nudge = (deltaMs: number) => seek(Math.min(durationMs, Math.max(0, timeMs + deltaMs)));
  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      <Button type="button" size="sm" onClick={toggle} aria-label={playing ? 'Pause episode' : 'Play episode'}>
        {playing ? '❚❚ Pause' : '▶ Play'}
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={() => nudge(-10_000)} aria-label="Back 10 seconds">−10s</Button>
      <input
        type="range" min={0} max={Math.max(1, Math.round(durationMs))} step={1000} value={Math.round(timeMs)}
        onChange={(e) => seek(Number(e.currentTarget.value))}
        aria-label="Episode position" aria-valuetext={`${clock(timeMs)} of ${clock(durationMs)}`}
        className="min-w-40 flex-1 accent-ink"
      />
      <Button type="button" size="sm" variant="outline" onClick={() => nudge(10_000)} aria-label="Forward 10 seconds">+10s</Button>
      <span className="whitespace-nowrap text-sm tabular-nums text-ink">{clock(timeMs)} / {clock(durationMs)}</span>
      {error ? <span role="alert" className="text-sm text-rm-red">{error}</span> : null}
    </div>
  );
}
