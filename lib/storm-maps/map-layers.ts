'use client';

import mapboxgl from 'mapbox-gl';
import type { StormFeatureProperties, StormMapsProvider } from './types';

export const STORM_RASTER_SOURCE_ID = 'wolfgrid-storm-raster';
export const STORM_RASTER_LAYER_ID = 'wolfgrid-storm-raster-layer';
export const STORM_PRELOAD_SOURCE_ID = 'wolfgrid-storm-preload';
export const STORM_PRELOAD_LAYER_ID = 'wolfgrid-storm-preload-layer';
export const STORM_FEATURE_SOURCE_ID = 'wolfgrid-storm-features';
export const STORM_OUTLOOK_FILL_LAYER_ID = 'wolfgrid-storm-outlook-fill';
export const STORM_OUTLOOK_GLOW_LAYER_ID = 'wolfgrid-storm-outlook-glow';
export const STORM_OUTLOOK_LINE_LAYER_ID = 'wolfgrid-storm-outlook-line';
export const STORM_ALERT_FILL_LAYER_ID = 'wolfgrid-storm-alert-fill';
export const STORM_ALERT_LINE_LAYER_ID = 'wolfgrid-storm-alert-line';
export const STORM_REPORT_LAYER_ID = 'wolfgrid-storm-report-points';

const STORM_LAYER_IDS = [
  'wolfgrid-storm-draw-casing-hot',
  'wolfgrid-storm-draw-casing-cold',
  STORM_REPORT_LAYER_ID,
  STORM_ALERT_LINE_LAYER_ID,
  STORM_ALERT_FILL_LAYER_ID,
  STORM_OUTLOOK_LINE_LAYER_ID,
  STORM_OUTLOOK_GLOW_LAYER_ID,
  STORM_OUTLOOK_FILL_LAYER_ID,
  STORM_RASTER_LAYER_ID,
  STORM_PRELOAD_LAYER_ID,
] as const;

function firstSymbolLayer(map: mapboxgl.Map) {
  return map.getStyle().layers?.find((layer) => layer.type === 'symbol')?.id;
}

function firstDrawLayer(map: mapboxgl.Map) {
  return map.getStyle().layers?.find((layer) => layer.id.startsWith('gl-draw-'))?.id;
}

function stormOverlayBeforeLayer(map: mapboxgl.Map) {
  if (map.getLayer('campaign-territory-overlays-fill')) return 'campaign-territory-overlays-fill';
  return firstDrawLayer(map) || firstSymbolLayer(map);
}

export function removeStormMapLayers(map: mapboxgl.Map) {
  for (const layerId of STORM_LAYER_IDS) {
    if (map.getLayer(layerId)) map.removeLayer(layerId);
  }
  if (map.getSource(STORM_FEATURE_SOURCE_ID)) map.removeSource(STORM_FEATURE_SOURCE_ID);
  if (map.getSource(STORM_RASTER_SOURCE_ID)) map.removeSource(STORM_RASTER_SOURCE_ID);
  if (map.getSource(STORM_PRELOAD_SOURCE_ID)) map.removeSource(STORM_PRELOAD_SOURCE_ID);
}

export function preloadAdjacentStormRaster(map: mapboxgl.Map, tileUrl: string, provider: StormMapsProvider) {
  const existing = map.getSource(STORM_PRELOAD_SOURCE_ID) as mapboxgl.RasterTileSource | undefined;
  if (existing) existing.setTiles([tileUrl]);
  else {
    map.addSource(STORM_PRELOAD_SOURCE_ID, {
      type: 'raster',
      tiles: [tileUrl],
      tileSize: 256,
      minzoom: 1,
      maxzoom: 12,
      scheme: provider === 'iem' ? 'tms' : 'xyz',
    });
  }
  if (!map.getLayer(STORM_PRELOAD_LAYER_ID)) {
    map.addLayer({
      id: STORM_PRELOAD_LAYER_ID,
      type: 'raster',
      source: STORM_PRELOAD_SOURCE_ID,
      paint: { 'raster-opacity': 0.001 },
    }, stormOverlayBeforeLayer(map));
  }
}

export function removeStormPreload(map: mapboxgl.Map) {
  if (map.getLayer(STORM_PRELOAD_LAYER_ID)) map.removeLayer(STORM_PRELOAD_LAYER_ID);
  if (map.getSource(STORM_PRELOAD_SOURCE_ID)) map.removeSource(STORM_PRELOAD_SOURCE_ID);
}

export function ensureStormDrawCasing(map: mapboxgl.Map) {
  const firstDraw = firstDrawLayer(map);
  if (!firstDraw) return;
  for (const variant of ['cold', 'hot'] as const) {
    const source = `mapbox-gl-draw-${variant}`;
    const id = `wolfgrid-storm-draw-casing-${variant}`;
    if (!map.getSource(source) || map.getLayer(id)) continue;
    map.addLayer({
      id,
      type: 'line',
      source,
      filter: ['any', ['==', '$type', 'Polygon'], ['==', '$type', 'LineString']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': 6, 'line-opacity': 0.95 },
    }, firstDraw);
  }
}

export function upsertStormRaster(
  map: mapboxgl.Map,
  options: { tileUrl: string; provider: StormMapsProvider; opacity: number },
) {
  const existing = map.getSource(STORM_RASTER_SOURCE_ID) as mapboxgl.RasterTileSource | undefined;
  if (existing) {
    existing.setTiles([options.tileUrl]);
  } else {
    map.addSource(STORM_RASTER_SOURCE_ID, {
      type: 'raster',
      tiles: [options.tileUrl],
      tileSize: 256,
      minzoom: 1,
      maxzoom: 12,
      scheme: options.provider === 'iem' ? 'tms' : 'xyz',
    });
  }
  if (!map.getLayer(STORM_RASTER_LAYER_ID)) {
    map.addLayer(
      {
        id: STORM_RASTER_LAYER_ID,
        type: 'raster',
        source: STORM_RASTER_SOURCE_ID,
        paint: {
          'raster-opacity': options.opacity,
          'raster-fade-duration': 320,
          'raster-resampling': 'linear',
        },
      },
      stormOverlayBeforeLayer(map),
    );
  } else {
    map.setPaintProperty(STORM_RASTER_LAYER_ID, 'raster-opacity', options.opacity);
  }
}

export function removeStormRaster(map: mapboxgl.Map) {
  if (map.getLayer(STORM_RASTER_LAYER_ID)) map.removeLayer(STORM_RASTER_LAYER_ID);
  if (map.getSource(STORM_RASTER_SOURCE_ID)) map.removeSource(STORM_RASTER_SOURCE_ID);
}

export function upsertStormFeatures(
  map: mapboxgl.Map,
  featureCollection: GeoJSON.FeatureCollection<GeoJSON.Geometry, StormFeatureProperties>,
) {
  const existing = map.getSource(STORM_FEATURE_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
  if (existing) existing.setData(featureCollection);
  else map.addSource(STORM_FEATURE_SOURCE_ID, { type: 'geojson', data: featureCollection });

  const beforeLayerId = stormOverlayBeforeLayer(map);
  const outlookColor: mapboxgl.Expression = [
    'match', ['get', 'riskLevel'],
    1, '#22d3ee',
    2, '#facc15',
    3, '#fb923c',
    4, '#d946ef',
    '#8b5cf6',
  ];
  if (!map.getLayer(STORM_OUTLOOK_FILL_LAYER_ID)) {
    map.addLayer(
      {
        id: STORM_OUTLOOK_FILL_LAYER_ID,
        type: 'fill',
        source: STORM_FEATURE_SOURCE_ID,
        filter: ['==', ['get', 'kind'], 'outlook'],
        paint: {
          'fill-color': outlookColor,
          'fill-opacity': [
            'interpolate', ['linear'], ['coalesce', ['get', 'riskLevel'], 1],
            1, 0.12,
            4, 0.3,
          ],
        },
      },
      beforeLayerId,
    );
  }
  if (!map.getLayer(STORM_OUTLOOK_GLOW_LAYER_ID)) {
    map.addLayer(
      {
        id: STORM_OUTLOOK_GLOW_LAYER_ID,
        type: 'line',
        source: STORM_FEATURE_SOURCE_ID,
        filter: ['==', ['get', 'kind'], 'outlook'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': outlookColor,
          'line-width': ['interpolate', ['linear'], ['zoom'], 4, 6, 12, 13],
          'line-opacity': 0.16,
          'line-blur': 4,
        },
      },
      beforeLayerId,
    );
  }
  if (!map.getLayer(STORM_OUTLOOK_LINE_LAYER_ID)) {
    map.addLayer(
      {
        id: STORM_OUTLOOK_LINE_LAYER_ID,
        type: 'line',
        source: STORM_FEATURE_SOURCE_ID,
        filter: ['==', ['get', 'kind'], 'outlook'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': outlookColor,
          'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1.75, 12, 4],
          'line-opacity': 0.95,
          'line-dasharray': [1.2, 0.8],
        },
      },
      beforeLayerId,
    );
  }
  if (!map.getLayer(STORM_ALERT_FILL_LAYER_ID)) {
    map.addLayer(
      {
        id: STORM_ALERT_FILL_LAYER_ID,
        type: 'fill',
        source: STORM_FEATURE_SOURCE_ID,
        filter: ['==', ['get', 'kind'], 'alert'],
        paint: {
          'fill-color': [
            'match', ['get', 'category'],
            'tornado', '#d946ef',
            'thunderstorm', '#f59e0b',
            'hail', '#a855f7',
            'flood', '#3b82f6',
            'winter', '#22d3ee',
            '#64748b',
          ],
          'fill-opacity': 0.18,
        },
      },
      beforeLayerId,
    );
  }
  if (!map.getLayer(STORM_ALERT_LINE_LAYER_ID)) {
    map.addLayer(
      {
        id: STORM_ALERT_LINE_LAYER_ID,
        type: 'line',
        source: STORM_FEATURE_SOURCE_ID,
        filter: ['==', ['get', 'kind'], 'alert'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': [
            'match', ['get', 'category'],
            'tornado', '#e879f9',
            'thunderstorm', '#fbbf24',
            'hail', '#c084fc',
            'flood', '#60a5fa',
            'winter', '#67e8f9',
            '#94a3b8',
          ],
          'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1.5, 12, 3],
          'line-opacity': 0.95,
          'line-dasharray': [2, 1],
        },
      },
      beforeLayerId,
    );
  }
  if (!map.getLayer(STORM_REPORT_LAYER_ID)) {
    map.addLayer(
      {
        id: STORM_REPORT_LAYER_ID,
        type: 'circle',
        source: STORM_FEATURE_SOURCE_ID,
        filter: ['==', ['get', 'kind'], 'report'],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 3, 12, 7],
          'circle-color': '#fb7185',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.5,
          'circle-opacity': 0.9,
        },
      },
      beforeLayerId,
    );
  }
}

export function removeStormFeatures(map: mapboxgl.Map) {
  for (const layerId of [
    STORM_REPORT_LAYER_ID,
    STORM_ALERT_LINE_LAYER_ID,
    STORM_ALERT_FILL_LAYER_ID,
    STORM_OUTLOOK_LINE_LAYER_ID,
    STORM_OUTLOOK_GLOW_LAYER_ID,
    STORM_OUTLOOK_FILL_LAYER_ID,
  ]) {
    if (map.getLayer(layerId)) map.removeLayer(layerId);
  }
  if (map.getSource(STORM_FEATURE_SOURCE_ID)) map.removeSource(STORM_FEATURE_SOURCE_ID);
}

export function bindStormFeaturePopups(map: mapboxgl.Map) {
  const layerIds = [STORM_OUTLOOK_FILL_LAYER_ID, STORM_ALERT_FILL_LAYER_ID, STORM_REPORT_LAYER_ID].filter((id) => map.getLayer(id));
  if (layerIds.length === 0) return () => {};
  let activePopup: mapboxgl.Popup | null = null;

  const handleClick = (event: mapboxgl.MapLayerMouseEvent) => {
    const properties = event.features?.[0]?.properties as StormFeatureProperties | undefined;
    if (!properties) return;
    const root = document.createElement('div');
    root.className = 'space-y-1 p-1 text-sm text-slate-950';
    const title = document.createElement('strong');
    title.textContent = properties.headline || properties.event;
    root.appendChild(title);
    const meta = document.createElement('p');
    meta.className = 'text-xs text-slate-600';
    meta.textContent = `${properties.provider.toUpperCase()}${properties.experimental ? ' · EXPERIMENTAL' : ''}${properties.magnitude ? ` · ${properties.magnitude}` : ''}`;
    root.appendChild(meta);
    if (properties.kind === 'outlook') {
      const metrics = document.createElement('p');
      metrics.className = 'text-xs font-medium text-violet-700';
      metrics.textContent = [
        properties.riskLevel ? `Risk ${properties.riskLevel}` : null,
        properties.hailSizeCm ? `${properties.hailSizeCm} cm hail` : null,
        properties.gustKph ? `${properties.gustKph} km/h gusts` : null,
      ].filter(Boolean).join(' · ');
      if (metrics.textContent) root.appendChild(metrics);
    }
    if (properties.description) {
      const description = document.createElement('p');
      description.className = 'max-w-72 text-xs leading-relaxed text-slate-700';
      description.textContent = properties.description.slice(0, 420);
      root.appendChild(description);
    }
    activePopup?.remove();
    activePopup = new mapboxgl.Popup({ closeButton: true, maxWidth: '340px' })
      .setLngLat(event.lngLat)
      .setDOMContent(root)
      .addTo(map);
  };
  const handleEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
  const handleLeave = () => { map.getCanvas().style.cursor = ''; };
  map.on('click', layerIds, handleClick);
  map.on('mouseenter', layerIds, handleEnter);
  map.on('mouseleave', layerIds, handleLeave);
  return () => {
    map.off('click', layerIds, handleClick);
    map.off('mouseenter', layerIds, handleEnter);
    map.off('mouseleave', layerIds, handleLeave);
    map.getCanvas().style.cursor = '';
    activePopup?.remove();
    activePopup = null;
  };
}
