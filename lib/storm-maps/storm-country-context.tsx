'use client';
import { createContext } from 'react';
import type { WindCountry } from './intelligence/wind-archive-format';
export const StormCountryContext=createContext<{country:WindCountry;setCountry:(country:WindCountry)=>void}|null>(null);
