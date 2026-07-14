export type MapStylePreset = 'standard' | 'whiteOut' | 'blackOps' | 'satellite';

export const MAP_STYLE_PRESET_META: Record<
  MapStylePreset,
  { label: string; description: string }
> = {
  standard: {
    label: 'Standard',
    description: 'Uses the default WolfGrid light and dark map styles.',
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
