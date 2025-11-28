/**
 * Nano Banana Pro API Client
 * 
 * Types and helper function for integrating with Nano Banana Pro
 * AI flyer generation service.
 */

export type NanoBananaRequest = {
  orientation: 'horizontal' | 'vertical';
  size: string; // e.g. "8.5x5.5"
  finish: 'glossy' | 'matte';
  campaignType: 'just-listed' | 'just-sold' | 'open-house' | 'farming' | 'service-business';
  address?: string;
  price?: string;
  beds?: number | null;
  baths?: number | null;
  sqft?: number | null;
  cta: string;
  brandColor: string; // hex
  style: 'clean-minimal' | 'bold-color' | 'luxury' | 'modern-gradient';
  tone: 'professional' | 'friendly' | 'high-energy' | 'luxury';
  mediaUrls?: string[]; // optional image URLs
};

export type NanoBananaDesign = {
  id: string;
  imageUrl: string;
  description?: string;
};

export type NanoBananaResponse = {
  designs: NanoBananaDesign[];
};

/**
 * Generate flyer designs using Nano Banana Pro API
 * 
 * @param payload - The flyer generation request payload
 * @returns Promise resolving to the API response with generated designs
 * @throws Error if API key is missing or API call fails
 */
export async function generateNanoBananaFlyers(
  payload: NanoBananaRequest
): Promise<NanoBananaResponse> {
  // 1. Read API key from environment variable
  const apiKey = process.env.NANO_BANANA_API_KEY;

  // 2. Validate API key exists
  if (!apiKey) {
    throw new Error(
      'NANO_BANANA_API_KEY is not configured. Please set it in your environment variables.'
    );
  }

  // 3. Prepare API request
  const apiUrl = 'https://api.nanobanana.pro/v1/generate-flyer';

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    // 4. Handle non-OK responses
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Nano Banana API error (${response.status}): ${errorText || response.statusText}`
      );
    }

    // 5. Parse and return typed response
    const data: NanoBananaResponse = await response.json();

    // Validate response structure
    if (!data.designs || !Array.isArray(data.designs)) {
      throw new Error('Invalid response format from Nano Banana API');
    }

    return data;
  } catch (error) {
    // Re-throw with context if it's not already our error
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Failed to call Nano Banana API: ${String(error)}`);
  }
}

