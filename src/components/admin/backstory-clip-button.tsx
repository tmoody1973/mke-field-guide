'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

/** Plays one line of the episode in the site's button style, and stops itself at the line's end. */
export function ClipButton({ audioUrl, startMs, endMs, label, text = 'Play line' }: {
  audioUrl: string; startMs: number; endMs: number; label: string; text?: string;
}) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => () => audio.current?.pause(), []);

  function toggle() {
    if (playing) {
      audio.current?.pause();
      return;
    }
    // Created on first press, so a page with a dozen speakers downloads nothing until someone listens.
    const el = audio.current ?? new Audio(audioUrl);
    audio.current = el;
    el.ontimeupdate = () => {
      if (el.currentTime * 1000 >= endMs) el.pause();
    };
    el.onpause = () => setPlaying(false);
    el.onplay = () => setPlaying(true);
    el.currentTime = startMs / 1000;
    void el.play().catch(() => setPlaying(false));
  }

  return (
    <Button type="button" size="sm" variant="outline" onClick={toggle} aria-label={`${playing ? 'Stop' : 'Play'} ${label}`} data-action="hear">
      {playing ? '■ Stop' : `▶ ${text}`}
    </Button>
  );
}
