import type mapboxgl from 'mapbox-gl';

/** Record the Mapbox canvas as a portrait video. DOM controls are deliberately excluded. */
export function recordCampaignReplay(map: mapboxgl.Map, attribution: string, onError?: (error: Error) => void) {
  if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) {
    throw new Error('This browser cannot record map videos. Try a current version of Safari or Chrome.');
  }
  const mapCanvas = map.getCanvas();
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1920;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not prepare the video canvas.');
  const stream = canvas.captureStream(30);
  const mimeType = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']
    .find((type) => MediaRecorder.isTypeSupported(type));
  let recorder: MediaRecorder;
  try {
    recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    throw error;
  }
  const chunks: BlobPart[] = [];
  let frame = 0;
  let lastDrawAt = -Infinity;
  let lastRepaintAt = -Infinity;
  let disposed = false;
  let readySettled = false;
  const stopControl: { stop?: (download: boolean) => void } = {};
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const readyTimeout = setTimeout(() => {
    if (!readySettled) {
      readySettled = true;
      rejectReady(new Error('The video encoder did not start. Try another browser.'));
    }
  }, 15000);
  recorder.ondataavailable = (event) => {
    if (!event.data.size) return;
    chunks.push(event.data);
    if (!readySettled) {
      readySettled = true;
      clearTimeout(readyTimeout);
      resolveReady();
    }
  };
  recorder.onerror = () => {
    const error = new Error('The video encoder stopped unexpectedly.');
    if (!readySettled) {
      readySettled = true;
      clearTimeout(readyTimeout);
      rejectReady(error);
    } else {
      onError?.(error);
      stopControl.stop?.(false);
    }
  };
  const render = () => {
    if (disposed) return;
    const now = performance.now();
    if (now - lastDrawAt < 1000 / 30) return;
    if (!mapCanvas.width || !mapCanvas.height) return;
    lastDrawAt = now;
    const scale = Math.max(canvas.width / mapCanvas.width, canvas.height / mapCanvas.height);
    const width = mapCanvas.width * scale;
    const height = mapCanvas.height * scale;
    context.drawImage(mapCanvas, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
    // Map providers require attribution in exported images and video.
    context.font = '20px sans-serif';
    const text = attribution || '© Mapbox © OpenStreetMap';
    context.fillStyle = 'rgba(255,255,255,0.85)';
    context.fillRect(0, canvas.height - 36, canvas.width, 36);
    context.fillStyle = '#111';
    context.fillText(text, 10, canvas.height - 11, canvas.width - 20);
  };
  const requestRender = () => {
    if (disposed) return;
    const now = performance.now();
    if (now - lastRepaintAt >= 1000 / 30) {
      lastRepaintAt = now;
      map.triggerRepaint();
    }
    frame = requestAnimationFrame(requestRender);
  };
  map.on('render', render);
  try {
    recorder.start(200);
    requestRender();
  } catch (error) {
    disposed = true;
    clearTimeout(readyTimeout);
    map.off('render', render);
    stream.getTracks().forEach((track) => track.stop());
    throw error;
  }
  stopControl.stop = (download: boolean) => {
      if (disposed) return;
      disposed = true;
      clearTimeout(readyTimeout);
      if (!readySettled) {
        readySettled = true;
        rejectReady(new Error('Video recording was cancelled.'));
      }
      cancelAnimationFrame(frame);
      map.off('render', render);
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        if (!download || !chunks.length) return;
        const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `wolfgrid-replay.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      };
      if (recorder.state !== 'inactive') recorder.stop();
      else stream.getTracks().forEach((track) => track.stop());
  };
  return { ready, stop: stopControl.stop };
}
