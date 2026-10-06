import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Mp3DurationVerifier } from '../mp3-duration';
function frame(version = 3, bitrate = 9, sample = 0, padding = 0) {
  const high = [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320];
  const low = [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160];
  const rate = [44100,48000,32000][sample] / (version === 3 ? 1 : version === 2 ? 2 : 4);
  const length = Math.floor((version === 3 ? 144 : 72) * (version === 3 ? high : low)[bitrate] * 1000 / rate) + padding;
  const bytes = Buffer.alloc(length); bytes[0]=255;bytes[1]=0xe0|(version<<3)|3;bytes[2]=(bitrate<<4)|(sample<<2)|(padding<<1);return bytes;
}
function measured(bytes: Buffer, packet = bytes.length) {
  const reader = new Mp3DurationVerifier();
  for(let index=0;index<bytes.length;index+=packet) reader.push(bytes.subarray(index,index+packet));
  return reader.finish();
}
const audio = Buffer.concat(Array.from({length:100},(_,index)=>frame(3, index%2 ? 14 : 9, 0, index%2)));
for(const packet of [1,2,3,4,7,10,127,1024,audio.length]) assert.equal(measured(audio,packet),Math.ceil(115200/44100*1000));
for(const version of [0,2,3]) for(const sample of [0,1,2]) assert.equal(measured(frame(version,9,sample)),Math.ceil((version===3?1152:576)/([44100,48000,32000][sample]/(version===3?1:version===2?2:4))*1000));
const tag = Buffer.from([73,68,51,4,0,0,0,0,0,12]);
assert.equal(measured(Buffer.concat([tag,Buffer.alloc(12),audio]),1),measured(audio));
const header = Buffer.from(tag);header[5]=16;const footer=Buffer.from(header);footer.write('3DI',0,'ascii');
assert.equal(measured(Buffer.concat([header,Buffer.alloc(12),footer,audio]),3),measured(audio));
const v1=Buffer.alloc(128);v1.write('TAG');assert.equal(measured(Buffer.concat([audio,v1,Buffer.alloc(19)]),2),measured(audio));
// Fake duration hints in frame payload do not change full-frame accounting.
const hints=Buffer.from(audio);hints.write('Xing',36,'ascii');hints.writeUInt32BE(1,40);hints.writeUInt32BE(1,44);assert.equal(measured(hints,13),measured(audio));
for(const invalid of [Buffer.alloc(0),tag,Buffer.concat([tag,Buffer.alloc(11)]),Buffer.concat([header,Buffer.alloc(12),Buffer.alloc(10),audio]),audio.subarray(0,audio.length-1),Buffer.concat([audio,Buffer.from([1])]),Buffer.concat([audio,v1,frame()]),Buffer.from([255,251,0,0]),Buffer.from([255,253,144,0]),Buffer.from([255,251,156,0])]) assert.throws(()=>measured(invalid,3));
console.log('Streaming full-frame MP3 duration, variable bitrates, MPEG versions, split headers, ID3 tags and malformed/truncated rejection passed');
// Independent encoder fixtures and macOS AudioToolbox duration estimates avoid relying only on handcrafted headers.
for (const [rate, estimatedSeconds] of [[44100, 1.044875], [22050, 1.071000], [11025, 1.149375]]) {
  const bytes = readFileSync(new URL(`./fixtures/sine-${rate}.mp3`, import.meta.url));
  const actual = measured(bytes, 13);
  assert.ok(Math.abs(actual - estimatedSeconds * 1000) < 2, `Independent MPEG duration mismatch for ${rate}`);
  assert.equal(measured(bytes, 1), actual);
}
console.log('Independent encoded MPEG-1/2/2.5 fixtures agree with AudioToolbox duration estimates');
