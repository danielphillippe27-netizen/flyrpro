import type { ImageSourceSpecification } from 'mapbox-gl';
import type { StormEvent } from './model';
import overlays from './mrms-hail-overlays.json';

type HailOverlay = Pick<ImageSourceSpecification, 'url' | 'coordinates'>;

export function mrmsHailStoragePath(eventKey: string): string | null {
  const match = /^noaa-mrms:(ca|us):hail:\d{4}-\d{2}-\d{2}:([A-Z]{2})$/.exec(eventKey);
  if (!match) return null;
  const allowed = match[1] === 'ca'
    ? /^(AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)$/
    : /^(AL|AZ|AR|CA|CO|CT|DC|DE|FL|GA|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)$/;
  if (!allowed.test(match[2])) return null;
  return `noaa-mrms/hail-overlays-v1/${eventKey.replaceAll(':', '-')}.png`;
}

export function mrmsHailOverlay(eventKey: string | undefined, hailMap?: StormEvent['hailMap']): HailOverlay | undefined {
  if (!eventKey) return undefined;
  if (Object.hasOwn(overlays, eventKey)) {
    const overlay = overlays[eventKey as keyof typeof overlays];
    // The renderer writes exactly four corners in Mapbox image-source order.
    return { url: overlay.url, coordinates: overlay.coordinates as HailOverlay['coordinates'] };
  }
  const coordinates = hailMap?.coordinates;
  if (!mrmsHailStoragePath(eventKey) || !Array.isArray(coordinates) || coordinates.length !== 4 ||
      !coordinates.every(pair => Array.isArray(pair) && pair.length === 2 &&
        Number.isFinite(pair[0]) && Math.abs(pair[0]) <= 180 && Number.isFinite(pair[1]) && Math.abs(pair[1]) <= 85)) return undefined;
  return { url: `/storm-maps/hail/archive/${encodeURIComponent(eventKey)}.png`, coordinates };
}
