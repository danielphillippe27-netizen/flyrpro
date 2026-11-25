/**
 * Publish reviewed Canadian hail maps prepared by backfill-canadian-mrms-hail.py.
 * DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config scripts/publish-canadian-mrms-hail.ts <directory> <from> <through> --publish
 */
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { createAdminClient } from '../lib/supabase/server';
import { MRMS_HAIL_ZONE_METHOD } from '../lib/storm-maps/intelligence/geometry';
import { canadianMrmsHailStoragePath, mrmsHailOverlay } from '../lib/storm-maps/intelligence/mrms-hail-overlay';
import { eventReferenceSchema, type StormEvent } from '../lib/storm-maps/intelligence/model';

type Zone = {
  event_key: string;
  minimum_mm: number;
  geometry: GeoJSON.MultiPolygon;
  source_resolution_m: number;
  estimation_method: string;
  source_updated_at: string;
  validated: boolean;
  license_verified: boolean;
};
type PreparedMap = { event: StormEvent; image: string; sourceUrl: string; zones: Zone[] };

async function main() {
  const [directory, lower, upper, operation] = process.argv.slice(2);
  if (!directory || !z.iso.date().safeParse(lower).success || !z.iso.date().safeParse(upper).success ||
      lower > upper || (operation != null && operation !== '--publish')) {
    throw Error('Choose the prepared directory and inclusive start and end dates. Add --publish to upload.');
  }
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')) as {
    entries: PreparedMap[]; failures: Record<string, string>;
  };
  if (Object.keys(manifest.failures).length) throw Error('Review failed NOAA dates before publication.');
  const entries = manifest.entries.filter(({ event }) => {
    const day = event.key.split(':')[3];
    return day >= lower && day <= upper;
  });
  if (!entries.length || entries.length > 400 || new Set(entries.map(entry => entry.event.key)).size !== entries.length) {
    throw Error('Choose up to 400 unique maps prepared for the requested dates.');
  }
  const files = await Promise.all(entries.map(async ({ event, image, sourceUrl, zones }) => {
    const path = canadianMrmsHailStoragePath(event.key);
    const source = new URL(sourceUrl);
    const reference = { key: event.key, title: event.title, hazard: event.hazard, source: event.source,
      sourceId: event.sourceId, start: event.start, end: event.end };
    if (!path || path.split('/').at(-1) !== image || event.source !== 'noaa-mrms' || event.hazard !== 'hail' ||
        !eventReferenceSchema.safeParse(reference).success || !mrmsHailOverlay(event.key, event.hailMap) ||
        source.origin !== 'https://noaa-mrms-pds.s3.amazonaws.com' || !source.pathname.startsWith('/CONUS/MESH_Max_1440min_00.50/') ||
        zones.length < 2 || zones.length > 4 || !zones.some(zone => zone.minimum_mm === 25.4) ||
        zones.some(zone => zone.event_key !== event.key || zone.geometry.type !== 'MultiPolygon' || !zone.geometry.coordinates.length ||
          zone.estimation_method !== MRMS_HAIL_ZONE_METHOD || zone.source_resolution_m !== 1000 ||
          !zone.validated || !zone.license_verified || Date.parse(zone.source_updated_at) !== Date.parse(event.end))) {
      throw Error(`Invalid prepared NOAA map for ${event.key}.`);
    }
    const file = join(directory, 'images', image);
    const { size } = await stat(file);
    if (size < 8 || size > 2_000_000) throw Error(`Unexpected PNG size for ${event.key}.`);
    return { file, size, path };
  }));
  const bytes = files.reduce((sum, file) => sum + file.size, 0);
  if (bytes > 80_000_000) throw Error('Publish a smaller batch of up to 80 MB.');

  if (operation === '--publish') {
    const admin = createAdminClient();
    for (let i = 0; i < entries.length; i += 3) {
      await Promise.all(entries.slice(i, i + 3).map(async ({ event, sourceUrl, zones }, offset) => {
        const { file, path } = files[i + offset];
        const image = await readFile(file);
        if (image.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw Error(`Invalid PNG for ${event.key}.`);
        const upload = await admin.storage.from('storm-archive').upload(path, image, { contentType: 'image/png', upsert: true });
        if (upload.error) throw upload.error;
        const row = {
          event_key: event.key, provider_event_id: event.sourceId, hazard: event.hazard, source: event.source,
          event_start: event.start, event_end: event.end, source_updated_at: event.end,
          metadata: { ...event, radarSourceUrl: sourceUrl },
        };
        // The event is a foreign key for the zones. Stage new rows outside the public list until their zones exist.
        const staged = await admin.from('storm_events').upsert(
          { ...row, source: 'noaa-mrms-staging' }, { onConflict: 'event_key', ignoreDuplicates: true },
        );
        if (staged.error) throw staged.error;
        const bands = await admin.from('storm_severity_zones').upsert(zones, { onConflict: 'event_key,minimum_mm' });
        if (bands.error) throw bands.error;
        const saved = await admin.from('storm_events').upsert(row, { onConflict: 'event_key' });
        if (saved.error) throw saved.error;
      }));
      if (i % 30 === 0 || i + 3 >= entries.length) console.log(`Published ${Math.min(i + 3, entries.length)}/${entries.length} maps`);
    }
  }
  console.log(JSON.stringify({ from: lower, through: upper, maps: entries.length, bytes, published: operation === '--publish' }));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
