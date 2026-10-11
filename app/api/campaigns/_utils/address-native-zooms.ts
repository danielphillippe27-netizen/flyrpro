import { getCachedPmtilesArchive } from './tile-cache';
import { type CampaignSnapshotRow, resolveArtifactUrl } from '@/lib/diamond/geometry';

/** Source maxzoom is the archive's native max; clients overzoom its last tile.
 * Layer visibility can continue beyond it. Older snapshots can have stale zooms. */
export async function resolveAddressNativeZooms(
  snapshot: CampaignSnapshotRow,
  key: string,
  readHeader = async (url: string) => getCachedPmtilesArchive(url).getHeader()
) {
  const header = await readHeader(await resolveArtifactUrl(snapshot, key));
  return { minzoom: header.minZoom, maxzoom: header.maxZoom };
}
