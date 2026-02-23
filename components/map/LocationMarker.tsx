'use client';

/**
 * Current-location marker for maps: blue center dot with white outline only.
 */

const CX = 32;
const CY = 32;
const CENTER_R = 6;
const RING_R = 10;

const BLUE = '#4285F4';
const WHITE = '#FFFFFF';

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
