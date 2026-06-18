'use client';

import type { AnyLayer, StyleSpecification } from 'mapbox-gl';
import { getMapboxToken } from '@/lib/mapbox';

type DemoMapVariant = 'light' | 'dark';
type MutablePaint = Record<string, unknown>;

const BASE_STYLES: Record<DemoMapVariant, string> = {
  light: 'mapbox://styles/mapbox/light-v11',
  dark: 'mapbox://styles/mapbox/dark-v11',
};
const WHITE_OUT_STYLE = 'mapbox://styles/mapbox/light-v11';
const WHITE_OUT_BACKGROUND = '#f8fafc';
const WHITE_OUT_WATER = '#eef1f4';

const styleCache = new Map<DemoMapVariant, StyleSpecification>();
let whiteOutStyleCache: StyleSpecification | null = null;

function toStylesApiUrl(styleUrl: string, accessToken: string) {
  const match = styleUrl.match(/^mapbox:\/\/styles\/([^/]+)\/([^/?#]+)$/);
  if (!match) return null;
  const [, username, styleId] = match;
  return `https://api.mapbox.com/styles/v1/${username}/${styleId}?access_token=${encodeURIComponent(accessToken)}`;
}

function cloneStyle(style: StyleSpecification): StyleSpecification {
  if (typeof structuredClone === 'function') {
    return structuredClone(style);
  }

  return JSON.parse(JSON.stringify(style)) as StyleSpecification;
}

function layerSourceLayer(layer: AnyLayer) {
  const sourceLayer = (layer as { 'source-layer'?: unknown })['source-layer'];
  return typeof sourceLayer === 'string' ? sourceLayer.toLowerCase() : '';
}

export function findDemoBuildingLayerId(style: StyleSpecification): string | null {
  const layers = style.layers ?? [];
  const buildingLayer = layers.find((layer) => {
    const layerId = layer.id.toLowerCase();
    const sourceLayer = layerSourceLayer(layer);
    return (
      (layer.type === 'fill' || layer.type === 'fill-extrusion')
      && (layerId.includes('building') || sourceLayer.includes('building'))
    );
  });

  return buildingLayer?.id ?? null;
}

function hideLabelLayer(layer: AnyLayer) {
  if (layer.type !== 'symbol') return false;

  const id = layer.id.toLowerCase();
  return (
    id.includes('label')
    || id.includes('poi')
    || id.includes('road')
    || id.includes('place')
    || id.includes('settlement')
    || id.includes('airport')
    || id.includes('transit')
  );
}

function flattenStyleValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(flattenStyleValue).join(' ');
  if (value && typeof value === 'object') {
    return Object.entries(value)
      .map(([key, entry]) => `${key} ${flattenStyleValue(entry)}`)
      .join(' ');
  }
  return '';
}

function isAddressNumberToken(value: string) {
  return (
    value.includes('housenum')
    || value.includes('house-num')
    || value.includes('house num')
    || value.includes('housenumber')
    || value.includes('house-number')
    || value.includes('house number')
    || value.includes('house_number')
    || value.includes('house_no')
    || value.includes('street_number')
    || value.includes('street-number')
    || value.includes('street number')
    || value.includes('addr:housenumber')
    || value.includes('addr_housenumber')
    || value.includes('address-number')
    || value.includes('address number')
    || value.includes('address_number')
    || value.includes('building-number')
    || value.includes('building number')
    || value.includes('building_number')
  );
}

function isBaseAddressNumberLayer(layer: AnyLayer) {
  if (layer.type !== 'symbol') return false;
  const layerId = layer.id.toLowerCase();
  return isAddressNumberToken(layerId) || isAddressNumberToken(flattenStyleValue(layer).toLowerCase());
}

function applyWhiteOutOverrides(style: StyleSpecification) {
  style.layers = (style.layers ?? []).map((layer) => {
    const nextLayer = layer as AnyLayer;
    const id = nextLayer.id.toLowerCase();
    const sourceLayer = layerSourceLayer(nextLayer);
    const isWater = id.includes('water') || sourceLayer.includes('water');
    const paint = ((nextLayer.paint ??= {}) as MutablePaint);

    if (nextLayer.type === 'background') {
      paint['background-color'] = WHITE_OUT_BACKGROUND;
      paint['background-opacity'] = 1;
      return nextLayer;
    }

    if (isWater && nextLayer.type === 'fill') {
      paint['fill-color'] = WHITE_OUT_WATER;
      paint['fill-outline-color'] = WHITE_OUT_WATER;
      return nextLayer;
    }

    if (isWater && nextLayer.type === 'line') {
      paint['line-color'] = WHITE_OUT_WATER;
      paint['line-opacity'] = 0.9;
      return nextLayer;
    }

    if (isBaseAddressNumberLayer(nextLayer)) {
      nextLayer.layout = {
        ...(nextLayer.layout ?? {}),
        visibility: 'none',
      };
    }

    return nextLayer;
  }) as StyleSpecification['layers'];
}

function applyLightOverrides(layer: AnyLayer) {
  const id = layer.id.toLowerCase();
  const sourceLayer = layerSourceLayer(layer);
  const paint = ((layer.paint ??= {}) as MutablePaint);

  if (layer.type === 'background') {
    paint['background-color'] = '#d9d5cb';
    paint['background-opacity'] = 1;
    return;
  }

  if (layer.type === 'fill') {
    if (id.includes('water') || sourceLayer.includes('water')) {
      paint['fill-color'] = '#cfcabe';
      paint['fill-outline-color'] = '#cfcabe';
      paint['fill-opacity'] = 1;
      return;
    }

    if (id.includes('building') || sourceLayer.includes('building')) {
      paint['fill-color'] = '#cfcabe';
      paint['fill-outline-color'] = '#c8c2b3';
      paint['fill-opacity'] = 0.46;
      return;
    }

    if (
      id.includes('land')
      || id.includes('landuse')
      || id.includes('park')
      || id.includes('national-park')
    ) {
      paint['fill-color'] = '#d9d5cb';
      paint['fill-opacity'] = 1;
    }
    return;
  }

  if (layer.type === 'fill-extrusion' && (id.includes('building') || sourceLayer.includes('building'))) {
    paint['fill-extrusion-color'] = '#cfcabe';
    paint['fill-extrusion-opacity'] = 0.36;
    return;
  }

  if (layer.type === 'line') {
    if (id.includes('road') || id.includes('street') || sourceLayer.includes('road')) {
      paint['line-color'] = '#0c0c0a';
      paint['line-opacity'] = 0.2;
      paint['line-width'] = ['interpolate', ['linear'], ['zoom'], 10, 0.25, 16, 1.2];
      return;
    }

    if (id.includes('admin') || id.includes('boundary') || sourceLayer.includes('boundary')) {
      paint['line-color'] = '#0c0c0a';
      paint['line-opacity'] = 0.16;
    }
  }
}

function applyDarkOverrides(layer: AnyLayer) {
  const id = layer.id.toLowerCase();
  const sourceLayer = layerSourceLayer(layer);
  const paint = ((layer.paint ??= {}) as MutablePaint);

  if (layer.type === 'background') {
    paint['background-color'] = '#0c0c0a';
    paint['background-opacity'] = 1;
    return;
  }

  if (layer.type === 'fill') {
    if (id.includes('water') || sourceLayer.includes('water')) {
      paint['fill-color'] = '#050505';
      paint['fill-outline-color'] = '#050505';
      return;
    }

    if (id.includes('building') || sourceLayer.includes('building')) {
      paint['fill-color'] = '#141414';
      paint['fill-outline-color'] = '#181818';
      paint['fill-opacity'] = 0.5;
      return;
    }

    paint['fill-color'] = '#0c0c0a';
    paint['fill-opacity'] = 1;
    return;
  }

  if (layer.type === 'fill-extrusion' && (id.includes('building') || sourceLayer.includes('building'))) {
    paint['fill-extrusion-color'] = '#141414';
    paint['fill-extrusion-opacity'] = 0.45;
    return;
  }

  if (layer.type === 'line') {
    if (id.includes('road') || id.includes('street') || id.includes('motorway') || sourceLayer.includes('road')) {
      paint['line-color'] = '#4c4c4c';
      paint['line-opacity'] = 0.95;
      return;
    }

    if (id.includes('admin') || id.includes('boundary') || sourceLayer.includes('boundary')) {
      paint['line-color'] = '#232323';
      paint['line-opacity'] = 0.8;
      return;
    }

    paint['line-color'] = '#1a1a1a';
    paint['line-opacity'] = 0.8;
  }
}

function applyDemoOverrides(style: StyleSpecification, variant: DemoMapVariant) {
  style.layers = (style.layers ?? []).map((layer) => {
    const nextLayer = layer as AnyLayer;

    if (hideLabelLayer(nextLayer)) {
      nextLayer.layout = {
        ...(nextLayer.layout ?? {}),
        visibility: 'none',
      };
    }

    if (variant === 'light') {
      applyLightOverrides(nextLayer);
    } else {
      applyDarkOverrides(nextLayer);
    }

    return nextLayer;
  }) as StyleSpecification['layers'];
}

export async function getDemoMapStyle(variant: DemoMapVariant): Promise<StyleSpecification> {
  const cached = styleCache.get(variant);
  if (cached) {
    return cloneStyle(cached);
  }

  const accessToken = getMapboxToken();
  const apiUrl = toStylesApiUrl(BASE_STYLES[variant], accessToken);
  if (!accessToken || !apiUrl) {
    throw new Error('Mapbox access token is required for demo map style loading.');
  }

  const response = await fetch(apiUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch demo map style: ${response.status}`);
  }

  const style = (await response.json()) as StyleSpecification;
  const buildingLayerId = findDemoBuildingLayerId(style);
  if (!buildingLayerId) {
    throw new Error('Demo map style does not include a queryable building layer.');
  }

  applyDemoOverrides(style, variant);
  styleCache.set(variant, style);
  return cloneStyle(style);
}

export async function getDemoWhiteOutMapStyle(): Promise<StyleSpecification> {
  if (whiteOutStyleCache) {
    return cloneStyle(whiteOutStyleCache);
  }

  const accessToken = getMapboxToken();
  const apiUrl = toStylesApiUrl(WHITE_OUT_STYLE, accessToken);
  if (!accessToken || !apiUrl) {
    throw new Error('Mapbox access token is required for demo whiteOut style loading.');
  }

  const response = await fetch(apiUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch demo whiteOut map style: ${response.status}`);
  }

  const style = (await response.json()) as StyleSpecification;
  const buildingLayerId = findDemoBuildingLayerId(style);
  if (!buildingLayerId) {
    throw new Error('Demo whiteOut map style does not include a queryable building layer.');
  }

  applyWhiteOutOverrides(style);
  whiteOutStyleCache = style;
  return cloneStyle(style);
}
