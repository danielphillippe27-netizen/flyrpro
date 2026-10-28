import assert from 'node:assert/strict';
import sharp from 'sharp';
import { windDisplayPyramid } from '../intelligence/wind-archive-collector';
import { windPixelColor, windGustKPH } from '../intelligence/wind-archive-format';
import { windArchiveMaximum,windArchiveStatistics } from '../intelligence/wind-archive-rendering';
async function main() {
  const raw = Buffer.alloc(512 * 512 * 4);
  for (let i = 0; i < 512 * 512; i++) { raw[i * 4] = i < 512 ? 0 : 100; raw[i * 4 + 3] = 255; }
  const numeric = await sharp(raw, { raw: { width: 512, height: 512, channels: 4 } }).png().toBuffer();
  const display = await windDisplayPyramid({ '4/15/9': numeric.toString('base64') });
  assert.deepEqual(Object.keys(display).sort(), ['0/0/0', '1/1/1', '2/3/2', '3/7/4', '4/15/9'].sort());
  const data = await sharp(Buffer.from(display['4/15/9'], 'base64')).raw().toBuffer();
  assert.deepEqual([...data.subarray(0, 4)], [0, 0, 0, 0]);
  assert.deepEqual([...data.subarray(512 * 4, 512 * 4 + 4)], windPixelColor(100));
  const root = await sharp(Buffer.from(display['0/0/0'], 'base64')).raw().toBuffer();
  assert.equal(root[3], 0, 'Unarchived world regions remain transparent');
  assert(root.some((value, index) => index % 4 === 3 && value > 0), 'Country imagery survives all overview levels');
  console.log('PASS: saved numeric wind tiles redraw at native and overview zooms, with correct colors and transparent no-data areas.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });

async function thresholdTest(){
  const raw=Buffer.alloc(512*512*4);
  // A small cell retains its native location; overviews must not exaggerate its area.
  raw[0]=40;raw[3]=255;raw[(3*512+3)*4]=100;raw[(3*512+3)*4+3]=255;
  const png=(await sharp(raw,{raw:{width:512,height:512,channels:4}}).png().toBuffer()).toString('base64');
  const filtered=await windDisplayPyramid({'4/4/5':png},93.341952);
  const native=await sharp(Buffer.from(filtered['4/4/5'],'base64')).raw().toBuffer();
  assert.equal(native[3],0,'below-threshold winds are hidden');
  assert(native[(3*512+3)*4+3]>0,'high-wind cell retained');
  const overview=await sharp(Buffer.from(filtered['0/0/0'],'base64')).raw().toBuffer();
  assert(overview.every((value,index)=>index%4!==3||value<=1),'isolated native cells do not become opaque oversized world-zoom blocks');
  console.log('PASS: threshold hides calmer winds without inflating isolated cells when zoomed out.');
}
thresholdTest().catch(error=>{console.error(error);process.exitCode=1;});

async function countryTest(){
 const {windCountryCell,windCountryTileMask}=await import('../intelligence/wind-country-mask');
 const cell=(lon:number,lat:number)=>[Math.floor((lon+180)/360*8192),Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*8192)];
 for(const [country,lon,lat,inside] of [['CA',-97.14,49.9,true],['US',-97.14,49.9,false],['US',-100,40,true],['US',-149.9,61.2,false],['US',-134.4,58.3,false],['US',-155.6,19.7,true],['US',-124,35,false],['US',-72,33,false],['CA',-100,40,false],['AU',133,-25,true],['AU',160,-25,false]] as const){const [x,y]=cell(lon,lat);assert.equal(windCountryCell(country,x,y),inside);assert.equal(windCountryTileMask(country,Math.floor(x/512),Math.floor(y/512))[(y%512)*512+x%512],inside?1:0);}
 const raw=Buffer.alloc(512*512*4);for(let i=0;i<512*512;i++){raw[i*4]=100;raw[i*4+3]=255;}
 const png=(await sharp(raw,{raw:{width:512,height:512,channels:4}}).png().toBuffer()).toString('base64');
 const highOutside=Buffer.from(raw);const outsideCell=cell(-100,50);highOutside[((outsideCell[1]%512)*512+outsideCell[0]%512)*4]=200;
 const outsidePNG=(await sharp(highOutside,{raw:{width:512,height:512,channels:4}}).png().toBuffer()).toString('base64');
 const tiles={'4/3/5':outsidePNG,'4/3/6':png};
 assert.equal((await windArchiveStatistics(tiles,'US')).windRegions.find(region=>region.name==='Nebraska')?.maximumKPH,windGustKPH(100),'Gust cells are assigned to their actual state');
 assert.equal(await windArchiveMaximum(tiles,'US'),windGustKPH(100),'A stronger gust outside the country cannot rank a saved wind day');
 const result=await windDisplayPyramid(tiles,93.341952,'US');
 const pixels=await sharp(Buffer.from(result['4/3/6'],'base64')).raw().toBuffer();
 const [x,y]=cell(-100,40);assert(pixels[((y%512)*512+x%512)*4+3]>0,'US land remains at its original native pixel');
 const [cx,cy]=cell(-100,50);const canadaPixels=await sharp(Buffer.from(result['4/3/5'],'base64')).raw().toBuffer();assert.equal(canadaPixels[((cy%512)*512+cx%512)*4+3],0,'Canadian land is removed from the US display');
 console.log('PASS: native cell alignment and country masks exclude neighbouring land and ocean.');
}
countryTest().catch(error=>{console.error(error);process.exitCode=1;});
