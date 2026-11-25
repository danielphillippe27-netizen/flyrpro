'use client';
import { createContext } from 'react';
import type { StormCountry } from './storm-countries';
export const StormCountryContext=createContext<{country:StormCountry;setCountry:(country:StormCountry)=>void}|null>(null);
