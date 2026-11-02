import assert from 'node:assert/strict';
import { recordCampaignReplay } from '../recordCampaignReplay';

let render: (() => void) | undefined;
let tracksStopped = 0;
let downloads = 0;
let drawn = 0;
let nextFrame = 0;
let latestRecorder: FakeRecorder;
const context = { drawImage: () => { drawn++; }, fillRect() {}, fillText() {}, font: '', fillStyle: '' };
class FakeCanvas {
  width = 1000;
  height = 1000;
  getContext() { return context; }
  captureStream() { return { getTracks: () => [{ stop: () => { tracksStopped++; } }] }; }
}
class FakeRecorder {
  static isTypeSupported(type: string) { return type === 'video/webm'; }
  mimeType = 'video/webm';
  state = 'inactive';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { latestRecorder = this; }
  start() { this.state = 'recording'; queueMicrotask(() => this.ondataavailable?.({ data: new Blob(['video']) })); }
  stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['video']) }); this.onstop?.(); }
}
Object.assign(globalThis, {
  HTMLCanvasElement: FakeCanvas,
  MediaRecorder: FakeRecorder,
  requestAnimationFrame: () => ++nextFrame,
  cancelAnimationFrame: () => {},
  setTimeout: () => 0,
  document: { createElement: (tag: string) => tag === 'canvas' ? new FakeCanvas() : { click: () => { downloads++; } } },
});
const map = {
  getCanvas: () => new FakeCanvas(),
  on: (_event: string, callback: () => void) => { render = callback; },
  off: () => { render = undefined; },
  triggerRepaint: () => { render?.(); },
};
async function main() {
const recording = recordCampaignReplay(map as never, '© Mapbox');
await recording.ready;
assert.equal(drawn, 1, 'records the rendered map');
recording.stop(true);
recording.stop(true);
assert.equal(downloads, 1, 'downloads only once');
assert.equal(tracksStopped, 1, 'releases the capture stream');
assert.equal(render, undefined, 'removes the map render listener');
const cancelled = recordCampaignReplay(map as never, '© Mapbox');
const cancelledReady = cancelled.ready.catch(() => {});
cancelled.stop(false);
await cancelledReady;
assert.equal(downloads, 1, 'cancelling does not download');
assert.equal(tracksStopped, 2, 'cancelling releases the capture stream');
let failureMessage = '';
const failed = recordCampaignReplay(map as never, '© Mapbox', (error) => { failureMessage = error.message; });
await failed.ready;
latestRecorder.onerror?.();
assert.match(failureMessage, /stopped unexpectedly/);
assert.equal(downloads, 1, 'encoder failures do not download incomplete video');
assert.equal(tracksStopped, 3, 'encoder failures release the capture stream');
console.log('Campaign replay recording lifecycle passed');
class FailingRecorder extends FakeRecorder {
  constructor() { super(); throw new Error('encoder unavailable'); }
}
Object.assign(globalThis, { MediaRecorder: FailingRecorder });
assert.throws(() => recordCampaignReplay(map as never, '© Mapbox'), /encoder unavailable/);
assert.equal(tracksStopped, 4, 'releases the stream if the encoder cannot start');

}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
