'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import {
  MAP_STYLE_PRESET_META,
  type MapStylePreset,
} from '@/lib/map-styles';

interface MapStyleContextType {
  preset: MapStylePreset;
  setPreset: (preset: MapStylePreset) => void;
}

const MAP_STYLE_STORAGE_KEY = 'flyr-map-style-preset';

const MapStyleContext = createContext<MapStyleContextType | undefined>(undefined);

export function MapStyleProvider({ children }: { children: React.ReactNode }) {
  const [preset, setPresetState] = useState<MapStylePreset>('standard');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const savedPreset = localStorage.getItem(MAP_STYLE_STORAGE_KEY) as MapStylePreset | null;
    if (savedPreset && savedPreset in MAP_STYLE_PRESET_META) {
      setPresetState(savedPreset);
    }
  }, []);

  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem(MAP_STYLE_STORAGE_KEY, preset);
  }, [mounted, preset]);

  const setPreset = (nextPreset: MapStylePreset) => {
    setPresetState(nextPreset);
  };

  return (
    <MapStyleContext.Provider value={{ preset: mounted ? preset : 'standard', setPreset }}>
      {children}
    </MapStyleContext.Provider>
  );
}

export function useMapStyle() {
  const context = useContext(MapStyleContext);
  if (!context) {
    throw new Error('useMapStyle must be used within a MapStyleProvider');
  }
  return context;
}
