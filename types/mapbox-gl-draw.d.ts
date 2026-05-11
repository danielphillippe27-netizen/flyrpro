declare module '@mapbox/mapbox-gl-draw' {
  import type { IControl, Map } from 'mapbox-gl';

  type DrawMode =
    | 'draw_line_string'
    | 'draw_polygon'
    | 'draw_point'
    | 'simple_select'
    | 'direct_select'
    | string;

  type DrawFeatureCollection = GeoJSON.FeatureCollection;

  type DrawOptions = {
    displayControlsDefault?: boolean;
    controls?: Record<string, boolean>;
    defaultMode?: DrawMode;
    styles?: Array<Record<string, unknown>>;
  };

  export default class MapboxDraw implements IControl {
    constructor(options?: DrawOptions);
    onAdd(map: Map): HTMLElement;
    onRemove(map: Map): void;
    add(feature: GeoJSON.Feature | GeoJSON.FeatureCollection): string[];
    delete(ids: string | string[]): this;
    deleteAll(): this;
    getAll(): DrawFeatureCollection;
    set(featureCollection: DrawFeatureCollection): string[];
    changeMode(mode: DrawMode, options?: Record<string, unknown>): this;
  }
}
