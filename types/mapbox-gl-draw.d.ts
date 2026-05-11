declare module '@mapbox/mapbox-gl-draw' {
  import type mapboxgl from 'mapbox-gl';

  type DrawMode = 'draw_polygon' | 'simple_select' | string;

  export default class MapboxDraw implements mapboxgl.IControl {
    constructor(options?: Record<string, unknown>);
    onAdd(map: mapboxgl.Map): HTMLElement;
    onRemove(map: mapboxgl.Map): void;
    getAll(): GeoJSON.FeatureCollection;
    set(featureCollection: GeoJSON.FeatureCollection): void;
    deleteAll(): void;
    changeMode(mode: DrawMode): void;
  }
}
