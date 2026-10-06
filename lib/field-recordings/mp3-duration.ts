/** Count every Layer III frame; do not trust client duration or Xing/VBR duration tags. */
export class Mp3DurationVerifier {
  private header = Buffer.alloc(0);
  private skip = 0;
  private footer: Buffer | null = null;
  private terminal = false;
  private seconds = 0;
  private frames = 0;
  private samples = new Map<number, number>();
  push(bytes: Uint8Array) {
    let cursor = 0;
    while (cursor < bytes.length) {
      if (this.skip) { const take = Math.min(this.skip, bytes.length - cursor); cursor += take; this.skip -= take; continue; }
      if (this.terminal) {
        if (bytes.subarray(cursor).some(byte => byte !== 0)) throw new Error('Unexpected MP3 trailing content');
        return;
      }
      const tag = this.header.length >= 3 && this.header.subarray(0, 3).toString('ascii') === 'ID3';
      const required = this.footer || tag ? 10 : 4;
      const take = Math.min(required - this.header.length, bytes.length - cursor);
      this.header = Buffer.concat([this.header, Buffer.from(bytes.subarray(cursor, cursor + take))]); cursor += take;
      if (this.header.length < required) continue;
      if (this.footer) {
        if (!this.header.equals(this.footer)) throw new Error('Invalid ID3 footer');
        this.footer = null; this.header = Buffer.alloc(0); continue;
      }
      const prefix = this.header.subarray(0, 3).toString('ascii');
      if (prefix === 'ID3') {
        if (this.header.length < 10) continue;
        const version = this.header[3], flags = this.header[5];
        const allowed = version === 2 ? 0xc0 : version === 3 ? 0xe0 : version === 4 ? 0xf0 : -1;
        if (allowed === -1 || this.header[4] === 0xff || (flags & ~allowed) !== 0 || this.header.subarray(6, 10).some(byte => byte > 127)) throw new Error('Invalid ID3 header');
        this.skip = this.header.subarray(6, 10).reduce((size, byte) => size * 128 + byte, 0);
        if (version === 4 && (flags & 0x10)) { this.footer = Buffer.from(this.header); this.footer.write('3DI', 0, 'ascii'); }
        this.header = Buffer.alloc(0); continue;
      }
      if (prefix === 'TAG') { this.skip = 124; this.terminal = true; this.header = Buffer.alloc(0); continue; }
      if (this.header.every(byte => byte === 0)) { this.terminal = true; this.header = Buffer.alloc(0); continue; }
      const [a, b, c, d] = this.header;
      const version = (b >> 3) & 3, layer = (b >> 1) & 3, bitrateIndex = c >> 4, sampleIndex = (c >> 2) & 3;
      if (a !== 255 || (b & 0xe0) !== 0xe0 || version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || sampleIndex === 3 || (d & 3) === 2) throw new Error('Unsupported MP3 frame');
      const rates = [44100, 48000, 32000];
      const rate = rates[sampleIndex] / (version === 3 ? 1 : version === 2 ? 2 : 4);
      const high = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
      const low = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
      const bitrate = (version === 3 ? high : low)[bitrateIndex] * 1000;
      const samples = version === 3 ? 1152 : 576;
      const length = Math.floor((version === 3 ? 144 : 72) * bitrate / rate) + ((c >> 1) & 1);
      this.seconds += samples / rate;
      if (length < 4 || this.seconds > 18000.001) throw new Error('MP3 duration exceeds supported limit');
      this.samples.set(rate, (this.samples.get(rate) ?? 0) + samples); this.frames++;
      this.skip = length - 4; this.header = Buffer.alloc(0);
    }
  }
  finish(): number {
    if (this.skip || this.footer || (this.header.length && this.header.some(byte => byte !== 0)) || this.frames === 0) throw new Error('Incomplete MP3 audio');
    const milliseconds = Math.ceil([...this.samples].reduce((seconds, [rate, samples]) => seconds + samples / rate, 0) * 1000);
    if (milliseconds < 1 || milliseconds > 18000000) throw new Error('Invalid MP3 duration');
    return milliseconds;
  }
}
