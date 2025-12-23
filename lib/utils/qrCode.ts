import QRCode from 'qrcode';

/**
 * Generate a QR code as a data URL
 * 
 * @param url - The URL to encode in the QR code
 * @param size - The size (width/height) of the QR code in pixels
 * @returns Promise resolving to a data URL string
 */
export async function generateQrDataUrl(
  url: string,
  size: number
): Promise<string> {
  try {
    const dataUrl = await QRCode.toDataURL(url, {
      width: size,
      margin: 1,
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
    });
    return dataUrl;
  } catch (error) {
    console.error('Error generating QR code:', error);
    throw new Error('Failed to generate QR code');
  }
}






