import { boundaryInsertionIndex } from './boundary-insertion';

type Position = [number, number];
type DrawFeature = {
  id: string;
  type: string;
  coordinates: Position[][];
  setCoordinates(rings: Position[][]): void;
  updateCoordinate(path: string, lng: number, lat: number): void;
  toGeoJSON(): GeoJSON.Feature<GeoJSON.Polygon>;
};
type DrawEvent = {
  lngLat: { lng: number; lat: number };
  featureTarget?: { properties: { meta?: string; coord_path?: string } };
};
type Context = {
  map: { dragPan: { isEnabled(): boolean; enable(): void; disable(): void }; doubleClickZoom: { enable(): void } };
  getFeature(id: string): DrawFeature | undefined;
  getSelected(): DrawFeature[];
  changeMode(mode: string, options?: Record<string, unknown>): void;
  deleteFeature(ids: string[], options?: { silent: boolean }): void;
  updateUIClasses(options: { mouse: string }): void;
  activateUIButton(): void;
  fire(event: string, data: unknown): void;
};
// Mapbox Draw's extension API uses different state and event types for each hook.
// Keep the untyped library boundary here; the snapping and geometry below are typed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Modes = Record<string, Record<string, (this: any, ...args: any[]) => any>>;
type DrawingState = { polygon: DrawFeature; dragIndex?: number; dragPanWasEnabled?: boolean; moved?: boolean };

export function createCampaignDrawModes(defaults: Modes, options: {
  enabled(): boolean;
  onBusy(busy: boolean): void;
  onError(message: string | null): void;
}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let request: AbortController | undefined;
  let revision = 0;
  const cancel = () => {
    revision++;
    clearTimeout(timer);
    request?.abort();
    request = undefined;
    options.onBusy(false);
  };
  function schedule(context: Context, feature: DrawFeature) {
    cancel();
    if (!options.enabled() || feature.type !== 'Polygon' || !feature.coordinates[0]?.length) return;
    const points = feature.coordinates[0].map(point => [...point] as Position);
    const snapshot = JSON.stringify(points);
    const ownRevision = revision;
    options.onError(null);
    options.onBusy(true);
    timer = setTimeout(async () => {
      const controller = new AbortController();
      request = controller;
      try {
        const response = await fetch('/api/campaigns/boundary-preview', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ points }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
        });
        if (!response.ok) throw new Error('Road snapping unavailable');
        const result = await response.json();
        if (!Array.isArray(result.points) || result.points.length !== points.length ||
          !result.points.every((point: unknown) => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite))) {
          throw new Error('Invalid road points');
        }
        if (ownRevision !== revision || context.getFeature(feature.id) !== feature || JSON.stringify(feature.coordinates[0]) !== snapshot) return;
        feature.setCoordinates([result.points, ...feature.coordinates.slice(1)]);
        context.fire('draw.update', { action: 'change_coordinates', features: [feature.toGeoJSON()] });
      } catch {
        if (ownRevision === revision && !controller.signal.aborted) options.onError('Road snapping unavailable. Move a point to retry.');
      } finally {
        if (ownRevision === revision) { request = undefined; options.onBusy(false); }
      }
    }, 180);
  }
  function insert(context: Context, feature: DrawFeature, event: DrawEvent) {
    const point: Position = [event.lngLat.lng, event.lngLat.lat];
    const ring = [...feature.coordinates[0]];
    ring.splice(boundaryInsertionIndex(point, ring), 0, point);
    feature.setCoordinates([ring, ...feature.coordinates.slice(1)]);
    schedule(context, feature);
  }
  const drawPolygon = {
    ...defaults.draw_polygon,
    onSetup(this: Context) { cancel(); return defaults.draw_polygon.onSetup.call(this); },
    onClick(this: Context, state: DrawingState, event: DrawEvent) {
      if (event.featureTarget?.properties.meta === 'vertex') {
        if (state.polygon.coordinates[0].length >= 3 && !state.moved) {
          this.changeMode('simple_select', { featureIds: [state.polygon.id] });
        }
        return;
      }
      insert(this, state.polygon, event);
    },
    onMouseMove() { /* Only committed pins belong to the campaign boundary. */ },
    onMouseDown(this: Context, state: DrawingState, event: DrawEvent) {
      const properties = event.featureTarget?.properties;
      state.moved = false;
      if (properties?.meta !== 'vertex' || !properties.coord_path) return;
      cancel();
      state.dragIndex = Number(properties.coord_path.split('.')[1]);
      state.dragPanWasEnabled = this.map.dragPan.isEnabled();
      this.map.dragPan.disable();
    },
    onDrag(this: Context, state: DrawingState, event: DrawEvent) {
      if (state.dragIndex === undefined) return;
      state.moved = true;
      state.polygon.updateCoordinate(`0.${state.dragIndex}`, event.lngLat.lng, event.lngLat.lat);
    },
    onMouseUp(this: Context, state: DrawingState) {
      if (state.dragIndex === undefined) return;
      if (state.dragPanWasEnabled) this.map.dragPan.enable();
      state.dragIndex = undefined;
      schedule(this, state.polygon);
    },
    onStop(this: Context, state: DrawingState) {
      this.updateUIClasses({ mouse: 'none' });
      this.map.doubleClickZoom.enable();
      this.activateUIButton();
      if (state.dragPanWasEnabled) this.map.dragPan.enable();
      if (!this.getFeature(state.polygon.id)) { cancel(); return; }
      if (state.polygon.coordinates[0]?.length >= 3) {
        this.fire('draw.create', { features: [state.polygon.toGeoJSON()] });
      } else {
        cancel();
        this.deleteFeature([state.polygon.id], { silent: true });
      }
    },
    toDisplayFeatures(this: Context, state: DrawingState, feature: GeoJSON.Feature, display: (feature: GeoJSON.Feature) => void) {
      if (feature.properties?.id !== state.polygon.id) { display(feature); return; }
      const points = state.polygon.coordinates[0];
      const properties = { ...feature.properties, active: 'true', meta: 'feature' };
      points.forEach((point, index) => display({
        type: 'Feature', properties: { meta: 'vertex', parent: state.polygon.id, coord_path: `0.${index}`, active: 'false' },
        geometry: { type: 'Point', coordinates: point },
      }));
      if (points.length >= 3) display({ ...feature, properties });
      else if (points.length === 2) display({ type: 'Feature', properties, geometry: { type: 'LineString', coordinates: points } });
    },
  };
  const directSelect = {
    ...defaults.direct_select,
    fireUpdate(this: Context) {
      defaults.direct_select.fireUpdate.call(this);
      this.getSelected().forEach(feature => schedule(this, feature));
    },
    clickNoTarget(this: Context, state: { feature: DrawFeature }, event: DrawEvent) { insert(this, state.feature, event); },
    clickActiveFeature(this: Context, state: { feature: DrawFeature }, event: DrawEvent) { insert(this, state.feature, event); },
    onMouseDown(this: Context, state: unknown, event: DrawEvent) {
      cancel();
      defaults.direct_select.onMouseDown.call(this, state, event);
    },
    onMouseUp(this: Context, state: { feature: DrawFeature }) {
      defaults.direct_select.onMouseUp.call(this, state);
      schedule(this, state.feature);
    },
  };
  const simpleSelect = {
    ...defaults.simple_select,
    fireUpdate(this: Context) {
      defaults.simple_select.fireUpdate.call(this);
      this.getSelected().forEach(feature => schedule(this, feature));
    },
    clickAnywhere(this: Context, state: unknown, event: DrawEvent) {
      const [feature] = this.getSelected();
      if (feature?.type === 'Polygon') insert(this, feature, event);
      else defaults.simple_select.clickAnywhere.call(this, state, event);
    },
  };
  return {
    dispose: cancel,
    modes: {
      ...defaults,
      draw_polygon: { ...drawPolygon, onTap: drawPolygon.onClick, onTouchStart: drawPolygon.onMouseDown, onTouchEnd: drawPolygon.onMouseUp },
      direct_select: { ...directSelect, onTouchStart: directSelect.onMouseDown, onTouchEnd: directSelect.onMouseUp },
      simple_select: simpleSelect,
    },
  };
}
