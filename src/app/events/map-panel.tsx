'use client';

import dynamic from 'next/dynamic';
import type { MapPin } from './build-map-pins';

/**
 * `ssr: false` skips prerendering `EventsMap` on the server — required here
 * because maplibre-gl touches browser globals (canvas/WebGL) at module init
 * and would throw during SSR. Per node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md
 * ("Skipping SSR" / the Server Components note), `ssr: false` is not allowed
 * on a `next/dynamic` call made from a Server Component — it has to live in a
 * Client Component, which is this file. `page.tsx` stays a server component
 * and only ever statically imports this thin wrapper; the actual maplibre-gl
 * chunk is fetched by the browser lazily, and only for requests that render
 * this component (i.e. only when `map=1`).
 */
const EventsMap = dynamic(() => import('./events-map').then((mod) => mod.EventsMap), {
  ssr: false,
  loading: () => <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-ink-muted">Loading map…</div>,
});

interface MapPanelProps {
  pins: MapPin[];
}

export function MapPanel({ pins }: MapPanelProps) {
  return (
    <div data-testid="map-panel" className="h-[380px] border-[3px] border-ink bg-cream-raised shadow-[6px_6px_0_#1F2528]">
      <EventsMap pins={pins} />
    </div>
  );
}
