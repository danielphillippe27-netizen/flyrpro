'use client';
import { createContext, useContext } from 'react';

/** A saved territory replaces weather imagery while users work on the basemap. */
export const StormTerritoryDisplayContext = createContext(false);
export const useStormTerritoryDisplay = () => useContext(StormTerritoryDisplayContext);
