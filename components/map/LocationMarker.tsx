'use client';

/**
 * Current-location marker for maps: blue center dot, white ring, soft blue outer halo.
 * Matches the standard "my location" pin style (e.g. Google Maps).
 */

const CX = 32;
const CY = 32;
const CENTER_R = 6;
const RING_R = 10;
const HALO_R = 28;

const BLUE = '#4285F4';
const WHITE = '#FFFFFF';
const HALO_BLUE = 'rgba(147, 186, 229, 0.45)';

export interface LocationMarkerProps {
  /** Width/height in pixels. Default 64. */
  size?: number;
  /** Optional className for the root SVG. */
  className?: string;
}

export function LocationMarker({ size = 64, className }: LocationMarkerProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ overflow: 'visible' }}
    >
      <defs>
        <filter id="location-marker-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* Outer halo / accuracy radius — soft, blurred light blue */}
      <circle
        cx={CX}
        cy={CY}
        r={HALO_R}
        fill={HALO_BLUE}
        filter="url(#location-marker-glow)"
      />
      {/* White ring */}
      <circle
        cx={CX}
        cy={CY}
        r={RING_R}
        fill="none"
        stroke={WHITE}
        strokeWidth={3}
      />
      {/* Blue center dot */}
      <circle cx={CX} cy={CY} r={CENTER_R} fill={BLUE} />
    </svg>
  );
}
