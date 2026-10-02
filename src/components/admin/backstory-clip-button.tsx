'use client';

import { Button } from '@/components/ui/button';
import { useEpisodeAudio } from './backstory-episode-audio';

/** Jumps the page's episode player to one line and plays just that line; keep listening with the player bar. */
export function ClipButton({ startMs, endMs, label, text = 'Play line' }: { startMs: number; endMs: number; label: string; text?: string }) {
  const { playFrom } = useEpisodeAudio();
  return (
    <Button type="button" size="sm" variant="outline" onClick={() => playFrom(startMs, endMs)} aria-label={`Play ${label}`} data-action="hear">
      ▶ {text}
    </Button>
  );
}
