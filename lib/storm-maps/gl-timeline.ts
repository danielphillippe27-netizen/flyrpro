import type { MapboxMapController } from '@xweather/mapsgl';

export function resetStormTimeline(
  controller: Pick<MapboxMapController, 'timeline' | 'removeWeatherLayer'>,
  layers: Set<string>,
  range: { start: Date; end: Date },
  current: Date,
) {
  controller.timeline.pause();
  // Cached sources retain their previous animation range. Dispose them before
  // seeking into a different range, otherwise MapsGL can throw a RangeError.
  for (const id of layers) controller.removeWeatherLayer(id);
  layers.clear();
  controller.timeline.clear();
  controller.timeline.endDate = range.end;
  controller.timeline.startDate = range.start;
  // MapsGL truncates range endpoints to whole seconds. Read them back before seeking.
  const start = controller.timeline.startDate.getTime();
  const end = controller.timeline.endDate.getTime();
  controller.timeline.goToDate(new Date(Math.min(end, Math.max(start, Math.floor(current.getTime() / 1000) * 1000))));
}
