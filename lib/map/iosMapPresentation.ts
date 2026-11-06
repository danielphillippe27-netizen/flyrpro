import type { ExpressionSpecification, FillExtrusionLayerSpecification } from 'mapbox-gl';

// MapTheme.configureExtrusionDepth and DiamondGeometryProvider on iOS.
export const IOS_BUILDING_LAYOUT: FillExtrusionLayerSpecification['layout'] = { 'fill-extrusion-edge-radius': 0.6 };
export const IOS_BUILDING_DEPTH: FillExtrusionLayerSpecification['paint'] = {
  'fill-extrusion-vertical-gradient': true,
  'fill-extrusion-cast-shadows': true,
  'fill-extrusion-ambient-occlusion-intensity': 0.32,
  'fill-extrusion-emissive-strength': 0.12,
  'fill-extrusion-rounded-roof': false,
};
export const IOS_ADDRESS_LAYOUT: FillExtrusionLayerSpecification['layout'] = { 'fill-extrusion-edge-radius': 0.2 };
export const IOS_ADDRESS_DEPTH: FillExtrusionLayerSpecification['paint'] = {
  ...IOS_BUILDING_DEPTH,
  'fill-extrusion-emissive-strength': 0.08,
  'fill-extrusion-rounded-roof': true,
};
export const IOS_ADDRESS_HEIGHT: ExpressionSpecification = ['max', ['to-number', ['coalesce',
  ['feature-state', 'height_m'], ['get', 'height_m'], ['feature-state', 'height'], ['get', 'height'], 3], 3], 3];
export const IOS_ADDRESS_BASE: ExpressionSpecification = ['max', ['to-number', ['coalesce', ['feature-state', 'min_height'], ['get', 'min_height'], 0], 0], 0];

export function iosParcelPaint(selected: ExpressionSpecification, active: ExpressionSpecification) {
  const value = (yes: number, no: number) => ['case', selected, yes, no];
  const statusValue = (yes: number, no: number, selection: number) => ['case', selected, selection, active, yes, no];
  return {
    fillOpacity: ['interpolate', ['linear'], ['zoom'], 0, value(.42, .12), 12, value(.42, .12),
      14, value(.42, .06), 15.2, value(.42, .10), 17.4, statusValue(.18, .12, .42), 20, statusValue(.14, .08, .42)] as ExpressionSpecification,
    lineOpacity: ['interpolate', ['linear'], ['zoom'], 0, value(1, .65), 12, value(1, .7),
      14, value(1, .46), 15.2, value(1, .48), 17.4, statusValue(.9, .62, 1), 20, statusValue(.82, .5, 1)] as ExpressionSpecification,
    lineWidth: ['interpolate', ['linear'], ['zoom'], 0, value(1.4, .42), 12, value(1.65, .36),
      13.5, value(1.82, .38), 15, value(1.95, .45), 16.8, value(2.16, .85), 19, value(2.6, 1.2), 24, value(3.2, 1.3)] as ExpressionSpecification,
  };
}

/** Keep parcel overlays below homes even when tiles attach after the buildings. */
export function parcelInsertionLayer(layers: { id: string; type: string }[]): string | undefined {
  return layers.find(layer => layer.type === 'fill-extrusion' ||
    /(?:townhome|townhouse|building-unit|canonical-units)/.test(layer.id))?.id;
}
