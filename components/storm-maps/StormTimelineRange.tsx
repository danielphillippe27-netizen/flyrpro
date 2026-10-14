'use client';

import type { StormGLSettings } from '@/lib/storm-maps/gl-settings';

type Props = {
  settings: StormGLSettings;
  onChange: (settings: StormGLSettings) => void;
};

export function StormTimelineRange({ settings, onChange }: Props) {
  return <div className="mb-4 space-y-2">
    <div role="group" aria-label="Weather timeline mode" className="grid grid-cols-3 gap-2">
      {(['live', 'history', 'forecast'] as const).map(mode => <button key={mode} type="button" aria-pressed={settings.mode === mode} onClick={() => onChange({ ...settings, mode, ...(mode === 'live' && settings.shade.startsWith('hail-') ? { shade: 'none' as const, hail: true } : {}) })} className={`rounded-lg border py-2 text-sm ${settings.mode === mode ? 'border-[#0c202c] bg-[#0c202c] text-white' : 'border-slate-300 bg-white text-slate-900'}`}>
        {mode === 'live' ? 'Live' : mode === 'history' ? 'Past' : 'Forecast'}
      </button>)}
    </div>
    {settings.mode === 'history' && <select aria-label="Weather timeline history range" className="w-full rounded-md border border-slate-300 bg-white p-2 text-sm text-slate-900" value={settings.historyHours} onChange={event => onChange({ ...settings, historyHours: Number(event.target.value) })}>
      {[6, 12, 24, 72].map(hours => <option key={hours} value={hours}>Past {hours} hours</option>)}
    </select>}
  </div>;
}
