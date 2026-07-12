'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { buildFacetHref } from './facet-href';
import type { SearchParams } from './search-params';

const COORD_DECIMAL_PLACES = 3;
const GEOLOCATION_TIMEOUT_MS = 10_000;
const LOCATION_UNAVAILABLE_MESSAGE = 'Location unavailable';

/** Rounds to ~110m precision — enough for a useful sort, not enough to be a shareable precise location (Decision: URL-state coords). */
function roundCoordinate(value: number): number {
  return Number(value.toFixed(COORD_DECIMAL_PLACES));
}

interface NearMeButtonProps {
  params: SearchParams;
  active: boolean;
}

/** The one genuinely-client control on `/events`: requests geolocation ONLY on click, never on mount; nothing is persisted beyond the URL. */
export function NearMeButton({ params, active }: NearMeButtonProps) {
  const router = useRouter();
  const [isLocating, setIsLocating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  function navigateToPosition(position: GeolocationPosition) {
    setIsLocating(false);
    const lat = roundCoordinate(position.coords.latitude);
    const lng = roundCoordinate(position.coords.longitude);
    router.push(buildFacetHref(params, { sort: 'near', lat: String(lat), lng: String(lng) }));
  }

  function handleGeolocationError() {
    setIsLocating(false);
    setNotice(LOCATION_UNAVAILABLE_MESSAGE);
  }

  function handleClick() {
    if (!('geolocation' in navigator)) {
      setNotice(LOCATION_UNAVAILABLE_MESSAGE);
      return;
    }
    setNotice(null);
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(navigateToPosition, handleGeolocationError, {
      timeout: GEOLOCATION_TIMEOUT_MS,
    });
  }

  const activeClasses = 'bg-rm-orange text-ink shadow-[2px_2px_0_#1F2528]';
  const idleClasses = 'bg-cream text-ink shadow-[2px_2px_0_rgba(31,37,40,0.25)]';

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={isLocating}
        className={`inline-block whitespace-nowrap border-[3px] border-ink px-[13px] py-[7px] text-[13px] font-extrabold transition-transform duration-100 hover:translate-x-[1px] hover:translate-y-[1px] disabled:opacity-60 ${active ? activeClasses : idleClasses}`}
      >
        {isLocating ? 'Locating…' : 'Near Me'}
      </button>
      {notice && (
        <span role="status" className="text-[12px] font-semibold text-ink-muted">
          {notice}
        </span>
      )}
    </span>
  );
}
