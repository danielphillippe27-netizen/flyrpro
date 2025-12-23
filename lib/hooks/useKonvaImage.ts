import { useEffect, useState } from 'react';

/**
 * Custom hook to load an image for use with Konva
 * 
 * @param url - The image URL to load
 * @returns The HTML Image element or null if not loaded yet
 */
export function useKonvaImage(url: string): HTMLImageElement | null {
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!url) {
      setImage(null);
      return;
    }

    let cancelled = false;
    const img = new window.Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      if (!cancelled) {
        setImage(img);
      }
    };

    img.onerror = () => {
      console.error('Failed to load image:', url);
      if (!cancelled) {
        setImage(null);
      }
    };

    img.src = url;

    return () => {
      cancelled = true;
    };
  }, [url]);

  return image;
}






