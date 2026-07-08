'use client';

import { useEffect, useRef, useState } from 'react';
import { STREAMS, type StationKey } from '@/lib/site';

const EQ_DELAYS = [0, 0.15, 0.3, 0.45] as const;
const IDLE_HEIGHTS = [16, 9, 13, 6] as const;
const POLL_MS = 30_000;

interface NowPlaying {
  artist: string;
  title: string;
}

/** Polls /api/now-playing while playing; null when paused, errored, or stale. */
function useNowPlaying(stationKey: StationKey, playing: boolean): NowPlaying | null {
  const [track, setTrack] = useState<NowPlaying | null>(null);
  useEffect(() => {
    if (!playing) {
      setTrack(null);
      return;
    }
    let cancelled = false;
    async function poll() {
      try {
        const response = await fetch(`/api/now-playing?station=${STREAMS[stationKey].slug}`);
        const body = await response.json();
        if (!cancelled) setTrack(body.artist && body.title ? body : null);
      } catch {
        if (!cancelled) setTrack(null);
      }
    }
    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [stationKey, playing]);
  return track;
}

export function MiniPlayer() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [station, setStation] = useState<StationKey>('88Nine');
  const [playing, setPlaying] = useState(false);
  const track = useNowPlaying(station, playing);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
      return;
    }
    audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }

  function switchStation(next: StationKey) {
    const audio = audioRef.current;
    setStation(next);
    if (!audio) return;
    audio.src = STREAMS[next].url;
    audio.load();
    audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t-[3px] border-rm-orange bg-ink">
      {/* Live radio stream, no captions to render */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} src={STREAMS[station].url} preload="none" />
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-3.5 gap-y-2 px-3.5 py-2 sm:flex-nowrap sm:gap-3.5 sm:py-[9px]">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? 'Pause stream' : 'Play stream'}
          className="flex size-11 flex-none items-center justify-center border-[3px] border-rm-orange bg-rm-orange text-lg text-ink shadow-[3px_3px_0_rgba(0,0,0,0.4)] transition-transform duration-100 active:translate-x-[2px] active:translate-y-[2px] sm:size-[46px]"
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <div className="hidden h-[22px] w-[26px] flex-none items-end gap-[3px] sm:flex" aria-hidden>
          {EQ_DELAYS.map((delay, index) => (
            <span
              key={delay}
              className="flex-1 bg-rm-orange"
              style={
                playing
                  ? { animation: `mke-eq 0.7s ease-in-out ${delay}s infinite` }
                  : { height: `${IDLE_HEIGHTS[index]}px` }
              }
            />
          ))}
        </div>
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-rm-orange">
            {playing ? (track ? `Now playing · ${station}` : station) : 'Tap play'}
          </div>
          <div className="truncate text-sm font-bold text-cream">
            {track ? `${track.artist} — ${track.title}` : `${station} · Listen live`}
          </div>
        </div>
        <div className="order-last grid w-full grid-cols-4 border-[3px] border-cream sm:order-none sm:flex sm:w-auto sm:max-w-none">
          {(Object.keys(STREAMS) as StationKey[]).map((key, index) => (
            <button
              key={key}
              type="button"
              onClick={() => switchStation(key)}
              className={`flex min-h-11 items-center justify-center px-1 py-1 text-center text-[10px] font-extrabold uppercase leading-tight tracking-[0.02em] sm:min-h-0 sm:whitespace-nowrap sm:px-3 sm:py-2 sm:text-xs sm:tracking-[0.04em] ${index > 0 ? 'border-l-[3px] border-cream' : ''} ${station === key ? 'bg-rm-orange text-ink' : 'bg-ink text-cream'}`}
            >
              {key}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
