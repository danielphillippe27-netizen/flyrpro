import sharp from 'sharp';
import {windRegions,windRegionTile} from './wind-regions';
import { windCountryTileMask } from './wind-country-mask';
import { WIND_COUNTRIES, WIND_TILE_SIZE, WIND_ZOOM, windGustKPH, windPixelColor, type WindCountry } from './wind-archive-format';
const WIND_COLORS = Uint32Array.from(Array.from({ length: 256 }, (_, value) => {
  const [r, g, b, a] = windPixelColor(value); return (r | g << 8 | b << 16 | a << 24) >>> 0;
}));
async function parallel<T>(values: T[], work: (value: T) => Promise<void>, concurrency = 8) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (next < values.length) await work(values[next++]);
  }));
}
export async function windDisplayPyramid(numericTiles: Record<string, string>, minimumKPH = 0, country?: WindCountry) {
  const colors = Uint32Array.from(WIND_COLORS, (color, byte) => (windGustKPH(byte) ?? -1) >= minimumKPH ? color : 0);
  const display: Record<string, Buffer> = {};
  await parallel(Object.entries(numericTiles), async ([key, png]) => {
    const { data, info } = await sharp(Buffer.from(png, 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.width !== WIND_TILE_SIZE || info.height !== WIND_TILE_SIZE) throw Error('Unexpected wind tile dimensions.');
    const rgba = Buffer.alloc(info.width * info.height * 4);
    const pixels = new Uint32Array(rgba.buffer, rgba.byteOffset, info.width * info.height);
    const [,tx,ty]=key.split('/').map(Number);
    const mask=country?windCountryTileMask(country,tx,ty):null;
    for (let i = 0; i < pixels.length; i++) pixels[i] = !mask||mask[i]?colors[data[i * info.channels]]:0;
    display[key] = await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  });
  // Retain low-zoom display tiles too, so old maps never depend on the provider.
  for (let z = WIND_ZOOM - 1; z >= 0; z--) {
    const parents = [...new Set(Object.keys(display).filter(key => key.startsWith(`${z + 1}/`)).map(key => {
      const [, x, y] = key.split('/').map(Number); return `${z}/${Math.floor(x / 2)}/${Math.floor(y / 2)}`;
    }))];
    await parallel(parents, async key => {
      const [, x, y] = key.split('/').map(Number);
      const children: sharp.OverlayOptions[] = [];
      for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) {
        const child = display[`${z + 1}/${2 * x + dx}/${2 * y + dy}`];
        if (child) {
          // Area averaging preserves the footprint; max pooling inflates isolated
          // native cells into large opaque squares at country/world zoom.
          const overview=await sharp(child).resize(256,256,{kernel:'linear'}).png().toBuffer();
          children.push({input:overview,left:dx*256,top:dy*256});
        }
      }
      display[key] = await sharp({ create: { width: 512, height: 512, channels: 4, background: '#00000000' } }).composite(children).png().toBuffer();
    });
  }
  return Object.fromEntries(Object.entries(display).sort(([a], [b]) => a.localeCompare(b)).map(([key, png]) => [key, png.toString('base64')]));
}

/** Index high-wind hours using the same native cells and coverage as selection. */
export async function windArchiveStatistics(tiles: Record<string,string>, country: WindCountry) {
  let maximum=0;
  const names=windRegions(country),maxima=new Uint8Array(names.length+1);
  for (const [key,png] of Object.entries(tiles)) {
    const [,tx,ty]=key.split('/').map(Number);
    const {data,info}=await sharp(Buffer.from(png,'base64')).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const mask=windCountryTileMask(country,tx,ty),regions=windRegionTile(country,tx,ty);
    for(let y=0;y<512;y++){
      const lat=Math.atan(Math.sinh(Math.PI*(1-2*(ty*512+y+.5)/8192)))*180/Math.PI;
      const bounds=WIND_COUNTRIES[country].bounds.filter(([,s,,n])=>lat>=s&&lat<=n);
      if(!bounds.length)continue;
      for(let x=0;x<512;x++){
        const byte=data[(y*512+x)*info.channels];
        if(mask[y*512+x]){if(byte>maximum)maximum=byte;const region=regions[y*512+x];if(region&&byte>maxima[region])maxima[region]=byte;}
      }
    }
  }
  return {maximumGustKPH:windGustKPH(maximum),windRegions:names.flatMap((region,index)=>maxima[index+1]?[{name:region.name,maximumKPH:windGustKPH(maxima[index+1])!}]:[])};
}

export async function windArchiveMaximum(tiles:Record<string,string>,country:WindCountry){return (await windArchiveStatistics(tiles,country)).maximumGustKPH;}
