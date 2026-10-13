export type MapStylePreset = 'standard' | 'whiteOut' | 'blackOps' | 'satellite' | 'stormIntelligence' | 'cleanLight';

export const MAP_STYLE_PRESET_META: Record<
  MapStylePreset,
  { label: string; description: string }
> = {
  stormIntelligence: {
    label: 'Storm Intelligence',
    description: 'Atmospheric Streets V10 globe with graphite land and an electric-blue horizon. Follows appearance changes.',
  },
  cleanLight: {
    label: 'Clean Light',
    description: 'Airy Streets V10 globe with pale blue water and soft slate labels. Follows appearance changes.',
  },
  standard: {
    label: 'Standard',
    description: 'Uses White Out in light mode and the default WolfGrid dark map in dark mode.',
  },
  whiteOut: {
    label: 'White Out',
    description: 'Bright stripped-back light map; dark mode keeps the WolfGrid dark-grey basemap.',
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
