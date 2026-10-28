import { NextRequest, NextResponse } from 'next/server';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveCachedTileUser, ensureCachedCampaignAccess, getCachedPmtilesArchive } from '@/app/api/campaigns/_utils/tile-cache';
import { readCanonicalTileArtifact } from '@/lib/services/CanonicalTileArtifacts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const privateHeaders = { 'Cache-Control': 'private, max-age=3600', Vary: 'Authorization, Cookie' };

export async function GET(request: NextRequest, context: { params: Promise<{ campaignId: string; revision: string; tile: string[] }> }) {
  const { campaignId, revision, tile } = await context.params;
  const user = await resolveCachedTileUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const db = createAdminClient();
  if (!await ensureCachedCampaignAccess(db, campaignId, user.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  try {
    const artifact = await readCanonicalTileArtifact(db, campaignId, revision);
    if (!artifact) return NextResponse.json({ error: 'Geometry revision not found' }, { status: 404 });
    if (tile.length === 1 && tile[0] === 'archive') {
      const client = new S3Client({ region: process.env.AWS_REGION || 'us-east-2' });
      const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: artifact.bucket, Key: artifact.archive_key }), { expiresIn: 900 });
      return NextResponse.redirect(url, { status: 307, headers: { 'Cache-Control': 'no-store' } });
    }
    const [z, x, y] = tile.map((part) => Number(part.replace(/\.mvt$/, '')));
    if (tile.length !== 3 || ![z, x, y].every(Number.isInteger) || z < 0 || z > 22 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) {
      return NextResponse.json({ error: 'Invalid tile coordinate' }, { status: 400 });
    }
    const archive = getCachedPmtilesArchive(`s3://${artifact.bucket}/${artifact.archive_key}`);
    const result = await archive.getZxy(z, x, y);
    if (!result) return new NextResponse(null, { status: 204, headers: privateHeaders });
    return new NextResponse(result.data, { headers: { ...privateHeaders, 'Content-Type': 'application/vnd.mapbox-vector-tile', ETag: `"${revision}-${z}-${x}-${y}"` } });
  } catch (error) {
    console.error('[CanonicalTiles] Tile read failed', { campaignId, revision, error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: 'Campaign tile temporarily unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '2' } });
  }
}
