'use client';

import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { MapPin } from './build-map-pins';

/** OpenFreeMap's key-free public style (Decision 6 — no env var, no API key). */
const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
/** Sensible eye-level zoom for a single-venue result set, where there's no bounding box to fit. */
const SINGLE_PIN_ZOOM = 14;
const FIT_BOUNDS_PADDING_PX = 48;

interface EventsMapProps {
  pins: MapPin[];
}

function popupHtml(pin: MapPin): string {
  const eventWord = pin.count === 1 ? 'event' : 'events';
  return `
    <div style="font:600 13px/1.3 system-ui,sans-serif;">
      <div style="font-weight:800;margin-bottom:2px;">${escapeHtml(pin.venueName)}</div>
      <div style="margin-bottom:6px;">${pin.count} ${eventWord}</div>
      <a href="${escapeHtml(pin.href)}" style="color:#c4432b;font-weight:800;text-decoration:underline;">View event →</a>
    </div>
  `;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}

function fitToPins(map: maplibregl.Map, pins: MapPin[]): void {
  if (pins.length === 1) {
    map.setCenter([pins[0].lng, pins[0].lat]);
    map.setZoom(SINGLE_PIN_ZOOM);
    return;
  }
  const bounds = pins.reduce(
    (accumulator, pin) => accumulator.extend([pin.lng, pin.lat]),
    new maplibregl.LngLatBounds([pins[0].lng, pins[0].lat], [pins[0].lng, pins[0].lat]),
  );
  map.fitBounds(bounds, { padding: FIT_BOUNDS_PADDING_PX, maxZoom: 15 });
}

/**
 * Thin MapLibre wrapper — no react wrapper lib (Decision 6). Attribution
 * control is left at its default (ON): OpenFreeMap tiles are OSM-derived and
 * require it (attribution review, filter-bar plan). Pins are plain markers,
 * no clustering — MVP scope is the current result set only (Decision 4).
 */
export function EventsMap({ pins }: EventsMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current || pins.length === 0) return undefined;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE_URL,
      center: [pins[0].lng, pins[0].lat],
      zoom: SINGLE_PIN_ZOOM,
    });

    const markers = pins.map((pin) =>
      new maplibregl.Marker({ color: '#c4432b' })
        .setLngLat([pin.lng, pin.lat])
        .setPopup(new maplibregl.Popup({ offset: 24 }).setHTML(popupHtml(pin)))
        .addTo(map),
    );

    map.on('load', () => fitToPins(map, pins));

    return () => {
      markers.forEach((marker) => marker.remove());
      map.remove();
    };
  }, [pins]);

  return <div ref={containerRef} className="h-full w-full" />;
}
