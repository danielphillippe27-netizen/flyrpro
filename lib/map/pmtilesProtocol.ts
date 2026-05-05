'use client';

import mapboxgl from 'mapbox-gl';
import { Protocol } from 'pmtiles';

declare global {
  interface Window {
    __flyrPmtilesProtocol?: Protocol;
  }
}

export function ensurePmtilesProtocolRegistered(): Protocol | null {
  if (typeof window === 'undefined') return null;

  if (window.__flyrPmtilesProtocol) {
    return window.__flyrPmtilesProtocol;
  }

  const protocol = new Protocol();
  const mapboxWithProtocol = mapboxgl as typeof mapboxgl & {
    addProtocol?: (scheme: string, handler: Protocol['tile']) => void;
  };

  if (typeof mapboxWithProtocol.addProtocol !== 'function') {
    console.warn('[PMTiles] mapbox-gl addProtocol is unavailable; direct PMTiles sources cannot render.');
    return null;
  }

  try {
    mapboxWithProtocol.addProtocol('pmtiles', protocol.tile);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already exists|already registered|exists/i.test(message)) {
      console.warn('[PMTiles] Failed to register pmtiles:// protocol:', error);
      return null;
    }
  }

  window.__flyrPmtilesProtocol = protocol;
  return protocol;
}
