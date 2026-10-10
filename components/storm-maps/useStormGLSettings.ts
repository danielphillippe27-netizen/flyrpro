'use client';
import { useEffect, useState } from 'react';
import { readStormGLSettings, STRONGEST_STORM_SETTINGS, type StormGLSettings } from '@/lib/storm-maps/gl-settings';
const CHANGE_EVENT = 'wolfgrid-storm-settings-changed';
export function useStormGLSettings(workspaceId: string | null) {
  const [settings, setSettings] = useState<StormGLSettings>(() => ({ ...STRONGEST_STORM_SETTINGS }));
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!workspaceId) { setLoadedFor(null); return; }
    const key = `wolfgrid:storm-gl:v1:${workspaceId}`;
    const load = () => {
      try { setSettings(readStormGLSettings(JSON.parse(localStorage.getItem(key) || 'null'))); }
      catch { setSettings({ ...STRONGEST_STORM_SETTINGS }); }
      setLoadedFor(workspaceId);
    };
    load();
    const changed = (event: Event) => {
      if (event instanceof CustomEvent && event.detail === key) load();
      if (event instanceof StorageEvent && event.key === key) load();
    };
    window.addEventListener(CHANGE_EVENT, changed);
    window.addEventListener('storage', changed);
    return () => { window.removeEventListener(CHANGE_EVENT, changed); window.removeEventListener('storage', changed); };
  }, [workspaceId]);
  useEffect(() => {
    if (!workspaceId || loadedFor !== workspaceId) return;
    const key = `wolfgrid:storm-gl:v1:${workspaceId}`;
    try {
      const value = JSON.stringify(settings);
      if (localStorage.getItem(key) === value) return;
      localStorage.setItem(key, value);
      window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: key }));
    } catch { /* browser storage is optional */ }
  }, [settings, workspaceId, loadedFor]);
  const update = <K extends keyof StormGLSettings>(key: K, value: StormGLSettings[K]) => setSettings((old) => ({ ...old, [key]: value }));
  return { settings, setSettings, update };
}
