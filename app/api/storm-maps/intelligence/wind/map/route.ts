import { windDisplayPyramid } from '@/lib/storm-maps/intelligence/wind-archive-rendering';
import sharp from 'sharp';
import { windCountryCell } from '@/lib/storm-maps/intelligence/wind-country-mask';
import { NextRequest, NextResponse } from 'next/server';
import { stormContext, stormError } from '@/lib/storm-maps/intelligence/access';
import { canonicalWindTime, WIND_COUNTRIES, WIND_TILE_SIZE, WIND_ZOOM, windCountry, windGustKPH } from '@/lib/storm-maps/intelligence/wind-archive-format';
import { loadWindArchive } from '@/lib/storm-maps/intelligence/wind-archive-history';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const filteredFrames = new Map<string, Promise<Record<string,string>>>();
const transparent = sharp({ create: { width: 1, height: 1, channels: 4, background: '#00000000' } }).png().toBuffer();
export async function GET(request: NextRequest) {
  const context = await stormContext(request); if ('response' in context) return context.response;
  const params = request.nextUrl.searchParams, country = params.get('country');
  let time;
  try { time = canonicalWindTime(params.get('time') ?? ''); } catch { return NextResponse.json({ error: 'Choose a valid archived hour.' }, { status: 400 }); }
  if (!windCountry(country)) return NextResponse.json({ error: 'Invalid wind region.' }, { status: 400 });
  try {
    if (params.get('sample') === '1') {
      const lonText = params.get('lon'), latText = params.get('lat'), lon = Number(lonText), lat = Number(latText);
      if (lonText == null || latText == null || !Number.isFinite(lon) || !Number.isFinite(lat) || lon < -180 || lon > 180 || lat < -85 || lat > 85) return NextResponse.json({ error: 'Choose a valid map location.' }, { status: 400 });
      const inside = WIND_COUNTRIES[country].bounds.some(([w, s, e, n]) => lon >= w && lon <= e && lat >= s && lat <= n);
      if (!inside) return NextResponse.json({ gustKPH: null, time, message: 'Outside the saved regional coverage.' });
      const bundle = await loadWindArchive(country, time), size = 2 ** WIND_ZOOM;
      const tx = Math.min(size - 1e-9, (lon + 180) / 360 * size), ty = (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * size;
      const x = Math.floor(tx), y = Math.floor(ty), tile = bundle.numericTiles[`${WIND_ZOOM}/${x}/${y}`];
      if (!tile) return NextResponse.json({ gustKPH: null, time, message: 'No saved wind value at this point.' });
      const { data, info } = await sharp(Buffer.from(tile, 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const pixel = (Math.min(511, Math.floor((ty - y) * WIND_TILE_SIZE)) * info.width + Math.min(511, Math.floor((tx - x) * WIND_TILE_SIZE))) * info.channels;
      const byte = windCountryCell(country,Math.floor(tx*512),Math.floor(ty*512))?data[pixel]:0;
      return NextResponse.json({ gustKPH: windGustKPH(byte), lowerBound: byte === 255, time, evidence: 'gridded-wind-estimate', message: byte === 0 ? 'Wind data unavailable at this point.' : 'Estimated regional gust. Local gusts can differ.' }, { headers: { 'Cache-Control': 'private, max-age=300' } });
    }
    const z = Number(params.get('z')), x = Number(params.get('x')), y = Number(params.get('y'));
    if (['z', 'x', 'y'].some(key => !params.has(key)) || ![z, x, y].every(Number.isInteger) || z < 0 || z > WIND_ZOOM || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) return NextResponse.json({ error: 'Invalid map tile.' }, { status: 400 });
    const minimum=Number(params.get('minimum')??'0');
    if(![0,40,60,93.341952,120,160].includes(minimum))return NextResponse.json({error:'Invalid wind threshold.'},{status:400});
    const bundle = await loadWindArchive(country, time);
    const key=`${country}:${time}:${minimum}`;
    let rendering=filteredFrames.get(key);
    {
      if(!rendering){
        if(filteredFrames.size>=2)filteredFrames.delete(filteredFrames.keys().next().value!);
        rendering=windDisplayPyramid(bundle.numericTiles,minimum,country);filteredFrames.set(key,rendering);
        rendering.catch(()=>filteredFrames.delete(key));
      }
    }
    const tiles=await rendering!;
    const png=tiles[`${z}/${x}/${y}`];
    return new NextResponse(new Uint8Array(png ? Buffer.from(png, 'base64') : await transparent), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=3600' } });
  } catch (error) { return stormError(error); }
}
