import mapboxgl from 'mapbox-gl';
import { recordCampaignReplay } from '../../lib/map/recordCampaignReplay';

declare global { interface Window { runReplayFixture(token: string): Promise<void> } }
window.runReplayFixture = async (token: string) => {
  mapboxgl.accessToken = token;
  const map = new mapboxgl.Map({
    container: 'map', center: [0, 0], zoom: 14, attributionControl: false,
    style: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#ececec' } }] },
  });
  await new Promise<void>((resolve) => map.once('load', resolve));
  map.addSource('homes', { type: 'geojson', data: {
    type: 'FeatureCollection', features: [{ type: 'Feature', id: 1, properties: {}, geometry: {
      type: 'Polygon', coordinates: [[[-0.003, -0.003], [0.003, -0.003], [0.003, 0.003], [-0.003, 0.003], [-0.003, -0.003]]],
    } }],
  } });
  map.addLayer({ id: 'homes', type: 'fill', source: 'homes', paint: {
    'fill-color': ['case', ['boolean', ['feature-state', 'visited'], false], '#22c55e', '#f87171'],
  } });
  await new Promise<void>((resolve) => map.once('idle', resolve));
  const recording = recordCampaignReplay(map, '© Mapbox © OpenStreetMap');
  await recording.ready;
  setTimeout(() => {
    map.setFeatureState({ source: 'homes', id: 1 }, { visited: true });
    map.easeTo({ center: [0.0002, 0], zoom: 14.4, duration: 800 });
  }, 700);
  setTimeout(() => recording.stop(true), 2000);
};
