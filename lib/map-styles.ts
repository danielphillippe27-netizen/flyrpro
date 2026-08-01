'use client';

import mapboxgl from 'mapbox-gl';
import type { Theme } from '@/lib/theme-provider';
export { MAP_STYLE_PRESET_META, type MapStylePreset } from './map-style-presets';
import type { MapStylePreset } from './map-style-presets';

export type MapStyleVersion = 'v11' | 'v12';

type MapStyleConfig = mapboxgl.MapboxOptions['config'];

export type ResolvedMapStyle = {
  key: string;
  style: string;
  config?: MapStyleConfig;
};

const WHITE_OUT_DEFAULT_STYLE = 'mapbox://styles/mapbox/light-v11';
const WHITE_OUT_BACKGROUND = '#f8fafc';
const WHITE_OUT_WATER = '#eaf2f8';
const WHITE_OUT_ROAD_CASING = '#cbd5e1';
const WHITE_OUT_ROAD_PATH = '#d8dee8';
const WHITE_OUT_ROAD_RAIL = '#c5ced9';
const WHITE_OUT_ROAD_SURFACE: mapboxgl.Expression = [
  'match',
  ['get', 'class'],
  ['motorway', 'trunk', 'primary'],
  '#d7e0ea',
  ['secondary', 'tertiary'],
  '#dfe6ee',
  ['motorway_link', 'trunk_link', 'primary_link', 'street', 'street_limited'],
  '#e7ecf2',
  '#edf1f5',
];

export type WhiteOutRoadLayerKind = 'surface' | 'casing' | 'path' | 'rail' | 'label';

export function classifyWhiteOutRoadLayer(layer: {
  id: string;
  type: string;
  'source-layer'?: unknown;
}): WhiteOutRoadLayerKind | null {
  const layerId = layer.id.toLowerCase();
  const sourceLayer = typeof layer['source-layer'] === 'string'
    ? layer['source-layer'].toLowerCase()
    : '';
  const isRoadLayer =
    sourceLayer.includes('road')
    || layerId.includes('road')
    || layerId.includes('street')
    || layerId.includes('motorway');

  if (!isRoadLayer) return null;

  if (layer.type === 'symbol') {
    return layerId.includes('label') || layerId.includes('name') || layerId.includes('shield')
      ? 'label'
      : null;
  }

  if (layer.type !== 'line') return null;
  if (layerId.includes('rail')) return 'rail';
  if (
    layerId.includes('path')
    || layerId.includes('trail')
    || layerId.includes('cycleway')
    || layerId.includes('pedestrian')
    || layerId.includes('steps')
  ) {
    return 'path';
  }
  if (layerId.includes('case') || layerId.includes('casing')) return 'casing';
  return 'surface';
}

const STANDARD_V12_STYLES: Record<Theme, string> = {
  light: process.env.NEXT_PUBLIC_MAPBOX_STYLE_ID_STANDARD_LIGHT || 'mapbox://styles/mapbox/streets-v12',
  dark: process.env.NEXT_PUBLIC_MAPBOX_STYLE_ID_STANDARD_DARK || 'mapbox://styles/mapbox/dark-v11',
};

const STANDARD_V11_STYLES: Record<Theme, string> = {
  light: process.env.NEXT_PUBLIC_MAPBOX_STYLE_ID_LEGACY_LIGHT || 'mapbox://styles/mapbox/streets-v12',
  dark: process.env.NEXT_PUBLIC_MAPBOX_STYLE_ID_LEGACY_DARK || 'mapbox://styles/mapbox/dark-v11',
};

const strippedStyleCache = new Map<string, Record<string, unknown>>();
const styleApplyRevisionByMap = new WeakMap<mapboxgl.Map, number>();

export function resolveMapStyle(
  preset: MapStylePreset,
  theme: Theme,
  version: MapStyleVersion,
): ResolvedMapStyle {
  // White Out is the light-theme treatment. Never allow it to bleed into a
  // dark workspace, including when an older White Out preference is stored in
  // localStorage. Black Out and satellite remain explicit, theme-independent
  // choices.
  if (theme === 'dark' && (preset === 'standard' || preset === 'whiteOut')) {
    const style = version === 'v12' ? STANDARD_V12_STYLES.dark : STANDARD_V11_STYLES.dark;
    return {
      key: `standard:${version}:dark`,
      style,
    };
  }

  if (preset === 'whiteOut' || preset === 'standard') {
    return {
      key: 'whiteOut:light-v11',
      style: process.env.NEXT_PUBLIC_MAPBOX_STYLE_ID_WHITEOUT || WHITE_OUT_DEFAULT_STYLE,
    };
  }

  if (preset === 'blackOps') {
    return {
      key: 'blackOps:classic:dark',
      style: process.env.NEXT_PUBLIC_MAPBOX_STYLE_ID_BLACKOUT ?? '',
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
  const applyRevision = (styleApplyRevisionByMap.get(map) ?? 0) + 1;
  styleApplyRevisionByMap.set(map, applyRevision);
  const isCurrentStyleRequest = () => styleApplyRevisionByMap.get(map) === applyRevision;
  const setStyleOptions = resolvedStyle.config
    ? {
        config: resolvedStyle.config,
        localFontFamily: undefined,
        localIdeographFontFamily: undefined,
      }
    : undefined;

  void resolveStylePayload(resolvedStyle)
    .then((stylePayload) => {
      // Stripped White Out styles require a network request. If the user
      // switched to dark mode while that request was pending, do not let the
      // older light payload overwrite the newer dark style.
      if (!isCurrentStyleRequest()) return;

      if (typeof stylePayload === 'string' && setStyleOptions) {
        map.setStyle(stylePayload, setStyleOptions);
        return;
      }

      map.setStyle(stylePayload as string | mapboxgl.StyleSpecification);
    })
    .catch((error) => {
      if (!isCurrentStyleRequest()) return;
      console.error('Failed to apply resolved map style:', error);
      if (setStyleOptions) {
        map.setStyle(resolvedStyle.style, setStyleOptions);
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
  if (resolvedStyle.key.startsWith('standard:')) {
    hideBaseBuildingLayers(map, options);
    hideBaseAddressNumberLayers(map, options);
    return;
  }

  if (resolvedStyle.key.startsWith('whiteOut:')) {
    applyWhiteOutVisualTweaks(map, options);
    return;
  }

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

function applyWhiteOutVisualTweaks(
  map: mapboxgl.Map,
  options?: {
    preserveLayerIds?: string[];
    preserveLayerPrefixes?: string[];
  },
) {
  const style = map.getStyle();
  if (!style?.layers) return;

  for (const layer of style.layers) {
    if (isPreservedLayer(layer.id, options)) continue;

    const lowerLayerId = layer.id.toLowerCase();
    const sourceLayer =
      typeof (layer as { 'source-layer'?: unknown })['source-layer'] === 'string'
        ? String((layer as { 'source-layer'?: unknown })['source-layer']).toLowerCase()
        : '';
    const isWater = lowerLayerId.includes('water') || sourceLayer.includes('water');
    const roadLayerKind = classifyWhiteOutRoadLayer(layer);

    try {
      if (layer.type === 'background') {
        map.setPaintProperty(layer.id, 'background-color', WHITE_OUT_BACKGROUND);
        map.setPaintProperty(layer.id, 'background-opacity', 1);
        continue;
      }

      if (isWater && layer.type === 'fill') {
        map.setPaintProperty(layer.id, 'fill-color', WHITE_OUT_WATER);
        map.setPaintProperty(layer.id, 'fill-outline-color', WHITE_OUT_WATER);
        continue;
      }

      if (isWater && layer.type === 'line') {
        map.setPaintProperty(layer.id, 'line-color', WHITE_OUT_WATER);
        map.setPaintProperty(layer.id, 'line-opacity', 0.9);
        continue;
      }

      if (roadLayerKind && roadLayerKind !== 'label' && layer.type === 'line') {
        const lineColor = roadLayerKind === 'casing'
          ? WHITE_OUT_ROAD_CASING
          : roadLayerKind === 'path'
            ? WHITE_OUT_ROAD_PATH
            : roadLayerKind === 'rail'
              ? WHITE_OUT_ROAD_RAIL
              : WHITE_OUT_ROAD_SURFACE;
        map.setPaintProperty(layer.id, 'line-color', lineColor);
        map.setPaintProperty(layer.id, 'line-opacity', roadLayerKind === 'path' ? 0.9 : 1);
        continue;
      }

      if (roadLayerKind === 'label' && layer.type === 'symbol') {
        map.setPaintProperty(layer.id, 'text-color', '#475569');
        map.setPaintProperty(layer.id, 'text-halo-color', '#ffffff');
        map.setPaintProperty(layer.id, 'text-halo-width', 1.25);
        map.setPaintProperty(layer.id, 'text-halo-blur', 0.2);
      }
    } catch {
      // Some imported style layers reject direct mutation.
    }
  }

  hideBaseAddressNumberLayers(map, options);
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

function isBaseAddressNumberLayer(
  layer: mapboxgl.AnyLayer,
  options?: {
    preserveLayerIds?: string[];
    preserveLayerPrefixes?: string[];
  },
) {
  if (layer.type !== 'symbol') return false;
  if (isPreservedLayer(layer.id, options)) return false;

  const lowerLayerId = layer.id.toLowerCase();
  if (isAddressNumberToken(lowerLayerId)) return true;

  return isAddressNumberToken(flattenStyleValue(layer).toLowerCase());
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
    || value.includes('house-no')
    || value.includes('street_number')
    || value.includes('street-number')
    || value.includes('street number')
    || value.includes('street_no')
    || value.includes('street-no')
    || value.includes('addr:housenumber')
    || value.includes('addr_housenumber')
    || value.includes('addressnum')
    || value.includes('address-num')
    || value.includes('address num')
    || value.includes('address-number')
    || value.includes('address number')
    || value.includes('address_number')
    || value.includes('building-number')
    || value.includes('building number')
    || value.includes('building_number')
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

export function hideBaseAddressNumberLayers(
  map: mapboxgl.Map,
  options?: {
    preserveLayerIds?: string[];
    preserveLayerPrefixes?: string[];
  },
) {
  const style = map.getStyle();
  if (!style?.layers) return;

  for (const layer of style.layers) {
    if (!isBaseAddressNumberLayer(layer, options)) continue;

    try {
      map.setLayoutProperty(layer.id, 'visibility', 'none');
      continue;
    } catch {
      // Fall through to opacity suppression below.
    }

    try {
      map.setPaintProperty(layer.id, 'text-opacity', 0);
      map.setPaintProperty(layer.id, 'icon-opacity', 0);
    } catch {
      // Ignore layers that do not expose the matching paint property.
    }
  }
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
