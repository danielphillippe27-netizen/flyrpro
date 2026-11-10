import type { ImageSourceSpecification } from 'mapbox-gl';
import overlays from './mrms-hail-overlays.json';

type HailOverlay = Pick<ImageSourceSpecification, 'url' | 'coordinates'>;

export function mrmsHailOverlay(eventKey: string | undefined): HailOverlay | undefined {
  if (!eventKey || !Object.hasOwn(overlays, eventKey)) return undefined;
  const overlay = overlays[eventKey as keyof typeof overlays];
  // The renderer writes exactly four corners in Mapbox image-source order.
  return { url: overlay.url, coordinates: overlay.coordinates as HailOverlay['coordinates'] };
}
