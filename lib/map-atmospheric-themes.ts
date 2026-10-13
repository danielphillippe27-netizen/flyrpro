import type { StyleSpecification, Expression } from 'mapbox-gl';

export const ATMOSPHERIC_STYLE_URL = 'mapbox://styles/mapbox/streets-v10';
export type AtmosphericTheme = 'dark' | 'light';

export const ATMOSPHERIC_PALETTES = {
  dark: {
    land: '#171C22', water: '#101B26', building: '#242C35', park: '#1D302B',
    road: '#414B57', majorRoad: '#65717F', casing: '#252E38', border: '#4A5563',
    label: '#DBE3EC', secondaryLabel: '#9EADBD', halo: '#171C22',
    atmosphere: '#556F91', glow: '#2979DD', space: '#05080E', stars: 0.035,
  },
  light: {
    land: '#FAFBFC', water: '#EAF4FA', building: '#E8ECF0', park: '#EDF5ED',
    road: '#E1E6EC', majorRoad: '#C9D2DC', casing: '#F1F3F6', border: '#DDE3EA',
    label: '#526173', secondaryLabel: '#788697', halo: '#FAFBFC',
    atmosphere: '#E6F2FC', glow: '#C6E3FA', space: '#EDF6FD', stars: 0,
  },
} as const;

/** Transform only hosted basemap layers, before campaign layers are attached. */
export function createAtmosphericStyle(base: StyleSpecification, theme: AtmosphericTheme): StyleSpecification {
  const style = JSON.parse(JSON.stringify(base)) as StyleSpecification;
  const p = ATMOSPHERIC_PALETTES[theme];
  style.name = theme === 'dark' ? 'WolfGrid Storm Intelligence' : 'WolfGrid Clean Light';
  style.transition = { duration: 350, delay: 0 };
  style.projection = { name: 'globe' };
  style.fog = {
    color: p.atmosphere, 'high-color': p.glow, 'space-color': p.space,
    'horizon-blend': 0.035, 'star-intensity': p.stars,
    range: [1, 10],
  };
  style.metadata = { ...(style.metadata as Record<string, unknown> | undefined), 'wolfgrid:atmospheric': true };
  for (const layer of style.layers) {
    const token = `${layer.id} ${'source-layer' in layer ? layer['source-layer'] : ''}`.toLowerCase();
    const water = /water/.test(token);
    const building = /building/.test(token);
    const park = /park|wood|forest|grass|natural/.test(token);
    const road = /road|street|motorway|bridge|tunnel/.test(token);
    const border = /admin|boundary/.test(token);
    if (layer.type === 'background') {
      layer.paint = { ...layer.paint, 'background-color': p.land };
    } else if (layer.type === 'fill') {
      const color = water ? p.water : building ? p.building : park ? p.park : p.land;
      layer.paint = { ...layer.paint, 'fill-color': color, 'fill-outline-color': color };
      delete layer.paint['fill-pattern'];
      // Streets V10 uses shared landuse polygons for parks and other uses.
      if (/landuse|landcover/.test(token)) {
        layer.paint['fill-color'] = ['match', ['get', 'class'],
          ['park', 'wood', 'grass', 'scrub', 'national_park', 'pitch'], p.park, p.land] as Expression;
      }
    } else if (layer.type === 'fill-extrusion' && building) {
      layer.paint = { ...layer.paint, 'fill-extrusion-color': p.building };
    } else if (layer.type === 'line') {
      const color = water ? p.water : border ? p.border : road
        ? /case|casing/.test(token) ? p.casing : ['match', ['get', 'class'],
          ['motorway', 'trunk', 'primary'], p.majorRoad, p.road] as Expression
        : p.border;
      layer.paint = { ...layer.paint, 'line-color': color, 'line-opacity': border ? 0.65 : 0.9 };
      delete layer.paint['line-pattern'];
    } else if (layer.type === 'symbol') {
      layer.paint = { ...layer.paint, 'text-color': /poi|water|road/.test(token) ? p.secondaryLabel : p.label,
        'text-halo-color': p.halo, 'text-halo-width': 1, 'text-halo-blur': 0.3 };
      if (/poi|transit/.test(token)) {
        layer.paint['icon-opacity'] = 0.35;
      }
    }
  }
  return style;
}
