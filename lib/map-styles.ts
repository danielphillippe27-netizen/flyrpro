'use client';

import mapboxgl from 'mapbox-gl';
import type { Theme } from '@/lib/theme-provider';

export type MapStylePreset = 'standard' | 'whiteOut' | 'blackOps' | 'satellite';
export type MapStyleVersion = 'v11' | 'v12';

type MapStyleConfig = Record<string, unknown>;

export type ResolvedMapStyle = {
  key: string;
  style: string;
  config?: MapStyleConfig;
};

export const MAP_STYLE_PRESET_META: Record<
  MapStylePreset,
  { label: string; description: string }
> = {
  standard: {
    label: 'Standard',
    description: 'Uses the default FLYR light and dark map styles.',
  },
  whiteOut: {
    label: 'White Out',
    description: 'Bright stripped-back basemap that avoids the Standard building footprint bleed-through.',
  },
  blackOps: {
    label: 'Black Out',
    description: 'Dark stripped-back basemap that keeps campaign houses readable without Standard footprint outlines.',
  },
  satellite: {
    label: 'Satellite',
    description: 'Satellite imagery with street labels for checking real-world context.',
  },
};

const STANDARD_V12_STYLES: Record<Theme, string> = {
  light: 'mapbox://styles/fliper27/cml6z0dhg002301qo9xxc08k4',
  dark: 'mapbox://styles/fliper27/cml6zc5pq002801qo4lh13o19',
};

const STANDARD_V11_STYLES: Record<Theme, string> = {
  light: 'mapbox://styles/mapbox/streets-v11',
  dark: 'mapbox://styles/mapbox/dark-v11',
};

const strippedStyleCache = new Map<string, Record<string, unknown>>();

export function resolveMapStyle(
  preset: MapStylePreset,
  theme: Theme,
  version: MapStyleVersion,
): ResolvedMapStyle {
  if (preset === 'whiteOut') {
    return {
      key: 'whiteOut:classic:light',
      style: 'mapbox://styles/mapbox/light-v11',
    };
  }

  if (preset === 'blackOps') {
    return {
      key: 'blackOps:classic:dark',
      style: 'mapbox://styles/mapbox/dark-v11',
    };
  }

  if (preset === 'satellite') {
    return {
      key: 'satellite:streets:v12',
      style: 'mapbox://styles/mapbox/satellite-streets-v12',
    };
  }

  const style = version === 'v12' ? STANDARD_V12_STYLES[theme] : STANDARD_V11_STYLES[theme];
  return {
    key: `standard:${version}:${theme}`,
    style,
  };
}

function shouldStripBuildingsFromPreset(resolvedStyle: ResolvedMapStyle) {
  return (
    resolvedStyle.key.startsWith('whiteOut:')
    || resolvedStyle.key.startsWith('blackOps:')
  );
}

function toStylesApiUrl(styleUrl: string, accessToken: string) {
  const match = styleUrl.match(/^mapbox:\/\/styles\/([^/]+)\/([^/?#]+)$/);
  if (!match) return null;
  const [, username, styleId] = match;
  return `https://api.mapbox.com/styles/v1/${username}/${styleId}?access_token=${encodeURIComponent(accessToken)}`;
}

function cloneStyleObject<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function stripBuildingLayersFromStyle(styleObject: Record<string, unknown>) {
  const nextStyle = cloneStyleObject(styleObject);
  const layers = Array.isArray(nextStyle.layers) ? nextStyle.layers : [];
  nextStyle.layers = layers.filter((layer) => {
    if (!layer || typeof layer !== 'object' || typeof (layer as { id?: unknown }).id !== 'string') {
      return true;
    }

    const layerId = String((layer as { id: string }).id).toLowerCase();
    const sourceLayer =
      typeof (layer as { 'source-layer'?: unknown })['source-layer'] === 'string'
        ? String((layer as { 'source-layer'?: unknown })['source-layer']).toLowerCase()
        : '';

    return !(
      layerId.includes('building')
      || layerId.includes('structure')
      || sourceLayer.includes('building')
    );
  });
  return nextStyle;
}

async function resolveStylePayload(resolvedStyle: ResolvedMapStyle) {
  if (!shouldStripBuildingsFromPreset(resolvedStyle)) {
    return resolvedStyle.style;
  }

  const cached = strippedStyleCache.get(resolvedStyle.key);
  if (cached) {
    return cloneStyleObject(cached);
  }

  const accessToken = mapboxgl.accessToken;
  if (!accessToken) {
    return resolvedStyle.style;
  }

  const apiUrl = toStylesApiUrl(resolvedStyle.style, accessToken);
  if (!apiUrl) {
    return resolvedStyle.style;
  }

  const response = await fetch(apiUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch stripped map style: ${response.status}`);
  }

  const styleObject = (await response.json()) as Record<string, unknown>;
  const strippedStyle = stripBuildingLayersFromStyle(styleObject);
  strippedStyleCache.set(resolvedStyle.key, strippedStyle);
  return cloneStyleObject(strippedStyle);
}

export async function getResolvedMapInitOptions(resolvedStyle: ResolvedMapStyle): Promise<{
  style: string | mapboxgl.StyleSpecification;
  config?: MapStyleConfig;
}> {
  const style = await resolveStylePayload(resolvedStyle);
  if (typeof style === 'string') {
    return resolvedStyle.config ? { style, config: resolvedStyle.config } : { style };
  }

  return { style: style as mapboxgl.StyleSpecification };
}

export function applyResolvedMapStyle(
  map: mapboxgl.Map,
  resolvedStyle: ResolvedMapStyle,
) {
  void resolveStylePayload(resolvedStyle)
    .then((stylePayload) => {
      if (typeof stylePayload === 'string' && resolvedStyle.config) {
        map.setStyle(stylePayload, { config: resolvedStyle.config });
        return;
      }

      map.setStyle(stylePayload as string | mapboxgl.StyleSpecification);
    })
    .catch((error) => {
      console.error('Failed to apply resolved map style:', error);
      if (resolvedStyle.config) {
        map.setStyle(resolvedStyle.style, { config: resolvedStyle.config });
        return;
      }
      map.setStyle(resolvedStyle.style);
    });
}

export function applyPresetVisualTweaks(
  map: mapboxgl.Map,
  resolvedStyle: ResolvedMapStyle,
  options?: {
    preserveLayerIds?: string[];
    preserveLayerPrefixes?: string[];
  },
) {
  if (!resolvedStyle.key.startsWith('blackOps:')) return;

  const style = map.getStyle();
  if (!style?.layers) return;

  for (const layer of style.layers) {
    if (isPreservedLayer(layer.id, options)) continue;

    const lowerLayerId = layer.id.toLowerCase();
    const sourceLayer =
      typeof (layer as { 'source-layer'?: unknown })['source-layer'] === 'string'
        ? String((layer as { 'source-layer'?: unknown })['source-layer']).toLowerCase()
        : '';

    try {
      if (layer.type === 'background') {
        map.setPaintProperty(layer.id, 'background-color', '#050505');
        continue;
      }

      if (layer.type === 'fill') {
        const isWater = lowerLayerId.includes('water') || sourceLayer.includes('water');
        const isRoadCasing = lowerLayerId.includes('road') || sourceLayer.includes('road');
        map.setPaintProperty(layer.id, 'fill-color', isWater ? '#0a0a0a' : isRoadCasing ? '#141414' : '#090909');
        map.setPaintProperty(layer.id, 'fill-outline-color', '#161616');
        continue;
      }

      if (layer.type === 'line') {
        const isRoad =
          lowerLayerId.includes('road')
          || lowerLayerId.includes('street')
          || lowerLayerId.includes('motorway')
          || sourceLayer.includes('road');
        const isBoundary =
          lowerLayerId.includes('boundary')
          || lowerLayerId.includes('admin')
          || sourceLayer.includes('boundary');

        map.setPaintProperty(layer.id, 'line-color', isRoad ? '#4c4c4c' : isBoundary ? '#232323' : '#1a1a1a');
        map.setPaintProperty(layer.id, 'line-opacity', isRoad ? 0.95 : 0.8);
        continue;
      }

      if (layer.type === 'symbol') {
        map.setPaintProperty(layer.id, 'text-color', '#f1f1f1');
        map.setPaintProperty(layer.id, 'text-halo-color', '#000000');
        map.setPaintProperty(layer.id, 'text-halo-width', 1);
        map.setPaintProperty(layer.id, 'icon-color', '#d4d4d4');
        continue;
      }
    } catch {
      // Some layers do not support every paint property; skip safely.
    }
  }
}

function isPreservedLayer(
  layerId: string,
  options?: {
    preserveLayerIds?: string[];
    preserveLayerPrefixes?: string[];
  },
) {
  if (options?.preserveLayerIds?.includes(layerId)) return true;
  return options?.preserveLayerPrefixes?.some((prefix) => layerId.startsWith(prefix)) ?? false;
}

export function isBaseBuildingLayer(
  layer: mapboxgl.AnyLayer,
  options?: {
    preserveLayerIds?: string[];
    preserveLayerPrefixes?: string[];
  },
) {
  if (isPreservedLayer(layer.id, options)) return false;

  const lowerLayerId = layer.id.toLowerCase();
  const sourceLayer =
    typeof (layer as { 'source-layer'?: unknown })['source-layer'] === 'string'
      ? String((layer as { 'source-layer'?: unknown })['source-layer']).toLowerCase()
      : '';

  return (
    lowerLayerId.includes('building')
    || lowerLayerId.includes('structure')
    || sourceLayer.includes('building')
  );
}

export function hideBaseBuildingLayers(
  map: mapboxgl.Map,
  options?: {
    preserveLayerIds?: string[];
    preserveLayerPrefixes?: string[];
  },
) {
  const style = map.getStyle();
  if (!style?.layers) return;

  for (const layer of style.layers) {
    if (!isBaseBuildingLayer(layer, options)) continue;

    try {
      map.setLayoutProperty(layer.id, 'visibility', 'none');
      continue;
    } catch {
      // Fall through to paint-property suppression below.
    }

    try {
      if (layer.type === 'fill' || layer.type === 'fill-extrusion') {
        map.setPaintProperty(layer.id, `${layer.type}-opacity`, 0);
      }

      if (layer.type === 'line') {
        map.setPaintProperty(layer.id, 'line-opacity', 0);
      }

      if (layer.type === 'circle') {
        map.setPaintProperty(layer.id, 'circle-opacity', 0);
        map.setPaintProperty(layer.id, 'circle-stroke-opacity', 0);
      }

      if (layer.type === 'symbol') {
        map.setPaintProperty(layer.id, 'text-opacity', 0);
        map.setPaintProperty(layer.id, 'icon-opacity', 0);
      }
    } catch {
      // Ignore layers that do not expose the matching paint property.
    }

    try {
      map.removeLayer(layer.id);
    } catch {
      // Removing imported/base layers is not always allowed; opacity suppression above is the fallback.
    }
  }
}
