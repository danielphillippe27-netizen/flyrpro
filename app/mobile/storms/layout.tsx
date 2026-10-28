import type { Viewport } from 'next';
import type { ReactNode } from 'react';

// Map gestures zoom the map, never the surrounding native campaign controls.
export const viewport: Viewport = {
  width: 'device-width', initialScale: 1, maximumScale: 1, userScalable: false, viewportFit: 'cover',
};
export default function StormsLayout({ children }: { children: ReactNode }) { return children; }
