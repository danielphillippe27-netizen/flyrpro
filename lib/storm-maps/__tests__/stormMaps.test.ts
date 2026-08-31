import assert from 'node:assert/strict';
import { aggregationHoursForLayer, isProviderAllowedForLayer, isStormRasterLayerId, mapGradientForLayer, providerForLayer, tomorrowFieldForLayer } from '../catalog';
import { buildTomorrowUrl, ecccOutlookLayersForBbox, normalizeEcccFeature, normalizeEcccOutlookFeature, normalizeIemReport, normalizeNoaaFeature, radarTimesFromCapabilities, xyzToWebMercatorBbox } from '../providers';
import { isApprovedStormTileTime, stormTileIntersectsCoverage } from '../tile-policy';
import { issueStormMapsTileToken, verifyStormMapsTileToken } from '../token';
import fixtures from './fixtures/provider-fixtures.json';

const originalSecret = process.env.STORM_MAPS_SIGNING_SECRET;
process.env.STORM_MAPS_SIGNING_SECRET = 'storm-maps-test-secret-with-sufficient-entropy';

try {
  const now = Date.parse('2026-08-30T12:34:56.000Z');
  const approvedTiles = [
    'iem:radar:now',
    'iem:radar:m55m',
    'eccc:radar:2026-08-30T12:24:00.000Z',
    'tomorrow:temperature:2026-08-31T12:00:00.000Z',
    'tomorrow:hailProbability:now',
  ];
  const issued = issueStormMapsTileToken('workspace-a', approvedTiles, now);
  const payload = verifyStormMapsTileToken(issued.token, now + 14 * 60_000);
  assert.equal(payload?.workspaceId, 'workspace-a');
  assert.equal(payload?.issuedAt, Math.floor(now / 1000));
  assert.equal(verifyStormMapsTileToken(issued.token, now + 15 * 60_000), null, 'token expires at 15 minutes');

  const tampered = `${issued.token.slice(0, -1)}${issued.token.endsWith('a') ? 'b' : 'a'}`;
  assert.equal(verifyStormMapsTileToken(tampered, now), null, 'tampered tokens are rejected');
  const otherWorkspaceToken = issueStormMapsTileToken('workspace-b', approvedTiles, now);
  assert.notEqual(issued.token, otherWorkspaceToken.token, 'tokens are scoped to a workspace');
  const expandedCatalogueTiles = Array.from({ length: 100 }, (_, index) => `tomorrow:hailProbability:frame-${index}`);
  const expandedToken = issueStormMapsTileToken('workspace-a', expandedCatalogueTiles, now);
  assert.equal(verifyStormMapsTileToken(expandedToken.token, now)?.approvedTiles.length, 100, 'expanded paid catalogue fits the signed manifest token');

  assert.equal(isStormRasterLayerId('radar'), true);
  assert.equal(isStormRasterLayerId('not-a-layer'), false);
  assert.equal(providerForLayer('radar', 'eccc'), 'eccc');
  assert.equal(providerForLayer('temperature', 'iem'), 'tomorrow');
  assert.equal(providerForLayer('accumulation1h', 'iem'), 'iem');
  assert.equal(providerForLayer('accumulation24h', 'eccc'), 'tomorrow');
  assert.equal(isProviderAllowedForLayer('eccc', 'temperature'), false);
  assert.equal(isProviderAllowedForLayer('iem', 'accumulation24h'), true);
  assert.equal(tomorrowFieldForLayer('lightning'), 'lightningFlashRateDensity');
  assert.equal(tomorrowFieldForLayer('hailBinary'), 'hailBinary');
  assert.equal(tomorrowFieldForLayer('hailProbability'), 'hailProbability');
  assert.equal(tomorrowFieldForLayer('hailSize'), 'hailSize');
  assert.match(mapGradientForLayer('hailSize') || '', /f472b6/);
  assert.equal(isProviderAllowedForLayer('tomorrow', 'hailProbability'), true);
  assert.equal(aggregationHoursForLayer('accumulation24h'), 24);

  const tomorrowFutureUrl = buildTomorrowUrl({
    provider: 'tomorrow', layerId: 'temperature', time: '2026-08-31T12:00:00Z', z: 8, x: 73, y: 92,
  }, 'test-key');
  assert.match(tomorrowFutureUrl, /2026-08-31T12:00:00Z\.png/, 'Tomorrow.io requires raw ISO separators in map paths');
  assert.doesNotMatch(new URL(tomorrowFutureUrl).pathname, /%3A/i);
  const tomorrowAggregateUrl = buildTomorrowUrl({
    provider: 'tomorrow', layerId: 'accumulation6h', time: '2026-08-31T12:00:00Z', z: 8, x: 73, y: 92,
  }, 'test-key');
  assert.match(tomorrowAggregateUrl, /aggregate\/tile\/sum\/2026-08-31T12:00:00Z\/2026-08-31T18:00:00Z/);
  assert.doesNotMatch(new URL(tomorrowAggregateUrl).pathname, /%3A/i);

  assert.equal(isApprovedStormTileTime('iem', 'radar', 'now', approvedTiles), true);
  assert.equal(isApprovedStormTileTime('iem', 'radar', 'm55m', approvedTiles), true);
  assert.equal(isApprovedStormTileTime('iem', 'radar', 'm04m', approvedTiles), false);
  assert.equal(isApprovedStormTileTime('eccc', 'radar', '2026-08-30T12:24:00.000Z', approvedTiles), true);
  assert.equal(isApprovedStormTileTime('eccc', 'radar', '2026-08-30T10:00:00.000Z', approvedTiles), false);
  assert.equal(isApprovedStormTileTime('tomorrow', 'temperature', '2026-08-31T12:00:00.000Z', approvedTiles), true);
  assert.equal(isApprovedStormTileTime('tomorrow', 'temperature', '2026-08-30T14:00:00.000Z', approvedTiles), false);
  assert.equal(isApprovedStormTileTime('tomorrow', 'accumulation6h', '2026-08-30T13:00:00.000Z', approvedTiles), false);
  assert.equal(isApprovedStormTileTime('tomorrow', 'hailProbability', 'now', approvedTiles), true);

  assert.deepEqual(ecccOutlookLayersForBbox([-80.2, 43.2, -78.8, 43.9]), ['Thunderstorm-Outlook_ON']);
  assert.deepEqual(ecccOutlookLayersForBbox([-124, 48.5, -122, 50]), ['Thunderstorm-Outlook_BC-YT']);
  assert.deepEqual(ecccOutlookLayersForBbox([-98, 31, -96, 33]), []);

  const worldTopLeft = xyzToWebMercatorBbox(1, 0, 0);
  assert.ok(Math.abs(worldTopLeft[0] + 20037508.342789244) < 0.001);
  assert.ok(Math.abs(worldTopLeft[1]) < 0.001);
  assert.ok(Math.abs(worldTopLeft[2]) < 0.001);
  assert.ok(Math.abs(worldTopLeft[3] - 20037508.342789244) < 0.001);

  // Toronto is tile 73/92 at z8 in XYZ; IEM requests carry the TMS-flipped y.
  assert.equal(stormTileIntersectsCoverage('eccc', 8, 73, 92), true);
  assert.equal(stormTileIntersectsCoverage('iem', 8, 73, 255 - 92), true);
  assert.equal(stormTileIntersectsCoverage('tomorrow', 8, 128, 128), false, 'tiles outside Canada/U.S. are rejected');

  const ecccTimes = radarTimesFromCapabilities(fixtures.ecccCapabilities);
  assert.equal(ecccTimes.length, 11);
  assert.equal(ecccTimes.at(-1), '2026-08-30T12:30:00.000Z');
  const noaa = normalizeNoaaFeature(fixtures.noaaAlert as GeoJSON.Feature<GeoJSON.Geometry, Record<string, unknown>>);
  assert.equal(noaa.properties.category, 'tornado');
  assert.equal(noaa.properties.severity, 'extreme');
  const eccc = normalizeEcccFeature(fixtures.ecccAlert as GeoJSON.Feature<GeoJSON.Geometry, Record<string, unknown>>);
  assert.equal(eccc.properties.category, 'thunderstorm');
  assert.equal(eccc.properties.provider, 'eccc');
  const outlook = normalizeEcccOutlookFeature(
    fixtures.ecccOutlook as GeoJSON.Feature<GeoJSON.Geometry, Record<string, unknown>>,
    'Thunderstorm-Outlook_ON',
  );
  assert.equal(outlook.properties.kind, 'outlook');
  assert.equal(outlook.properties.category, 'hail');
  assert.equal(outlook.properties.hailSizeCm, 2.5);
  assert.equal(outlook.properties.gustKph, 90);
  assert.equal(outlook.properties.riskLevel, 3);
  assert.equal(outlook.properties.experimental, true);
  const iem = normalizeIemReport(fixtures.iemReport as GeoJSON.Feature<GeoJSON.Geometry, Record<string, unknown>>);
  assert.equal(iem.properties.kind, 'report');
  assert.equal(iem.properties.magnitude, '1.50 INCH');

  console.log('Storm Maps policy, token, hail catalogue, ECCC outlook, and coordinate tests passed');
} finally {
  if (originalSecret === undefined) delete process.env.STORM_MAPS_SIGNING_SECRET;
  else process.env.STORM_MAPS_SIGNING_SECRET = originalSecret;
}
