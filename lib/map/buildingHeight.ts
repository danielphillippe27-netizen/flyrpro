import type { ExpressionSpecification } from 'mapbox-gl';

export const DEFAULT_BUILDING_EXTRUSION_HEIGHT_METERS = 5.5;
export const MINIMUM_BUILDING_EXTRUSION_HEIGHT_METERS = 5.2;
export const MAXIMUM_BUILDING_EXTRUSION_HEIGHT_METERS = 350;

type BuildingHeightProperties = Record<string, unknown>;

function normalizedToken(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function usesAbsoluteBuildingElevation(properties: BuildingHeightProperties): boolean {
  const source = normalizedToken(properties.source ?? properties.source_id);
  const buildingType = normalizedToken(
    properties.building_type ?? properties.layer ?? properties.feature_class
  );

  // Niagara's BuildingsElev/AVGEaveEle field is an absolute roof elevation,
  // not a structure height above ground.
  return source === 'niagarabuildings' || buildingType === 'buildingselev';
}

export function sanitizeBuildingExtrusionHeightMeters(
  properties: BuildingHeightProperties,
  fallbackHeight = DEFAULT_BUILDING_EXTRUSION_HEIGHT_METERS
): number {
  if (usesAbsoluteBuildingElevation(properties)) return fallbackHeight;

  const rawHeight = finiteNumber(properties.height_m) ?? finiteNumber(properties.height);
  if (
    rawHeight === null ||
    rawHeight <= 0 ||
    rawHeight > MAXIMUM_BUILDING_EXTRUSION_HEIGHT_METERS
  ) {
    return fallbackHeight;
  }

  return Math.max(rawHeight, MINIMUM_BUILDING_EXTRUSION_HEIGHT_METERS);
}

export function getBuildingExtrusionHeightExpression(): ExpressionSpecification {
  const rawHeight = [
    'to-number',
    ['coalesce', ['get', 'height_m'], ['get', 'height']],
    DEFAULT_BUILDING_EXTRUSION_HEIGHT_METERS,
  ];
  const source = [
    'downcase',
    ['to-string', ['coalesce', ['get', 'source'], ['get', 'source_id'], '']],
  ];
  const buildingType = [
    'downcase',
    [
      'to-string',
      ['coalesce', ['get', 'building_type'], ['get', 'layer'], ['get', 'feature_class'], ''],
    ],
  ];

  return [
    'case',
    [
      'any',
      ['==', source, 'niagara_buildings'],
      ['==', buildingType, 'buildingselev'],
      ['<=', rawHeight, 0],
      ['>', rawHeight, MAXIMUM_BUILDING_EXTRUSION_HEIGHT_METERS],
    ],
    DEFAULT_BUILDING_EXTRUSION_HEIGHT_METERS,
    ['max', rawHeight, MINIMUM_BUILDING_EXTRUSION_HEIGHT_METERS],
  ] as ExpressionSpecification;
}
