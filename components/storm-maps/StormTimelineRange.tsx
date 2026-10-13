'use client';

import type { StormGLSettings } from '@/lib/storm-maps/gl-settings';

type Props = {
  settings: StormGLSettings;
  onChange: (settings: StormGLSettings) => void;
};

export function StormTimelineRange({ settings, onChange }: Props) {
  const selectClass = 'min-w-0 rounded-md border border-white/20 bg-[#0c202c] px-2 py-1 text-[11px] text-white focus-visible:outline focus-visible:outline-[#a9d7d5]';
  return <div className="mb-2 flex flex-wrap items-center gap-2">
    <select aria-label="Weather timeline mode" className={selectClass} value={settings.mode} onChange={event => {
      const mode = event.target.value as StormGLSettings['mode'];
      onChange({ ...settings, mode, ...(mode === 'live' && settings.shade.startsWith('hail-') ? { shade: 'none' as const, hail: true } : {}) });
    }}>
      <option value="live">Live</option>
      <option value="history">Past</option>
      <option value="forecast">Forecast</option>
    </select>
    {settings.mode === 'history' && <select aria-label="Weather timeline history range" className={selectClass} value={settings.historyHours} onChange={event => onChange({ ...settings, historyHours: Number(event.target.value) })}>
      {[6, 12, 24, 72].map(hours => <option key={hours} value={hours}>Past {hours} hours</option>)}
    </select>}
  </div>;
}
