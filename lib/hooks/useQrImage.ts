import { useEffect, useState } from 'react';
import { generateQrDataUrl } from '@/lib/utils/qrCode';

/**
 * Custom hook to generate and load a QR code as an HTML Image element
 * 
 * @param url - The URL to encode in the QR code
 * @param size - The size of the QR code in pixels
 * @returns The HTML Image element or null if not loaded yet
 */
export function useQrImage(url: string, size: number): HTMLImageElement | null {
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!url) {
      setImage(null);
      return;
    }

    let cancelled = false;

    generateQrDataUrl(url, size)
      .then((dataUrl) => {
        if (cancelled) return;
        const img = new window.Image();
        img.onload = () => {
          if (!cancelled) {
            setImage(img);
          }
        };
        img.src = dataUrl;
      })
      .catch((error) => {
        console.error('Failed to generate QR code:', error);
        if (!cancelled) {
          setImage(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [url, size]);

  return image;
}

