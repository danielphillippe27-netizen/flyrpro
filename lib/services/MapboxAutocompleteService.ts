/**
 * Mapbox Autocomplete Service
 * Provides address autocomplete functionality using Mapbox Geocoding API v5
 */

export interface AddressSuggestion {
  id: string;
  title: string;
  subtitle: string;
  coordinate: {
    latitude: number;
    longitude: number;
  };
}

export interface UserLocation {
  lat: number;
  lng: number;
}

interface MapboxFeature {
  id: string;
  type: string;
  place_type: string[];
  relevance: number;
  properties: {
    accuracy?: string;
    address?: string;
  };
  text: string;
  place_name: string;
  center: [number, number]; // [longitude, latitude]
  context?: Array<{
    id: string;
    text: string;
    short_code?: string;
  }>;
  address?: string;
}

interface MapboxResponse {
  type: string;
  query: string[];
  features: MapboxFeature[];
  attribution: string;
}

export class MapboxAutocompleteService {
  private static readonly BASE_URL = 'https://api.mapbox.com/geocoding/v5/mapbox.places';

  /**
   * Search for address suggestions using Mapbox Geocoding API
   * @param query - Search query string (minimum 3 characters recommended)
   * @param proximity - Optional user location to bias results
   * @param signal - Optional AbortSignal for request cancellation
   * @returns Promise<AddressSuggestion[]>
   */
  static async searchAddresses(
    query: string,
    proximity?: UserLocation,
    signal?: AbortSignal
  ): Promise<AddressSuggestion[]> {
    const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

    if (!mapboxToken) {
      throw new Error('Mapbox token not configured. Set NEXT_PUBLIC_MAPBOX_TOKEN environment variable.');
    }

    // Encode query for URL
    const encodedQuery = encodeURIComponent(query);

    // Build query parameters
    const params = new URLSearchParams({
      access_token: mapboxToken,
      types: 'address',
      autocomplete: 'true',
      fuzzyMatch: 'true',
      limit: '8',
      country: 'US,CA',
      language: 'en',
    });

    // Add proximity if provided
    if (proximity) {
      params.append('proximity', `${proximity.lng},${proximity.lat}`);
    }

    const url = `${this.BASE_URL}/${encodedQuery}.json?${params.toString()}`;

    try {
      const response = await fetch(url, { signal });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Mapbox API error: ${response.status} - ${errorText}`);
      }

      const data: MapboxResponse = await response.json();

      // Map features to AddressSuggestion format
      return data.features.map((feature) => this.parseFeature(feature));
    } catch (error) {
      // Re-throw AbortError without modification (caller handles cancellation)
      if (error instanceof Error && error.name === 'AbortError') {
        throw error;
      }

      // Wrap other errors
      if (error instanceof Error) {
        throw error;
      }

      throw new Error('Unknown error occurred while searching addresses');
    }
  }

  /**
   * Parse a Mapbox feature into AddressSuggestion format
   */
  private static parseFeature(feature: MapboxFeature): AddressSuggestion {
    // Extract house number (prefer feature.address, then properties.address, then parse from place_name)
    const houseNumber = feature.address || feature.properties?.address || this.extractHouseNumber(feature.place_name);

    // Build title: house number + street name
    const streetName = feature.text || '';
    const title = houseNumber && streetName
      ? `${houseNumber} ${streetName}`.trim()
      : feature.place_name;

    // Extract subtitle from context (city, region, postcode)
    const subtitle = this.extractSubtitle(feature);

    // Extract coordinates (Mapbox returns [lng, lat])
    const [longitude, latitude] = feature.center;

    return {
      id: feature.id,
      title,
      subtitle,
      coordinate: {
        latitude,
        longitude,
      },
    };
  }

  /**
   * Extract house number from place_name using regex
   * Matches numbers at the start, supports "12A", "5900B", etc.
   */
  private static extractHouseNumber(placeName: string): string | null {
    const match = placeName.match(/^\s*(\d+[A-Za-z]?)\b/);
    return match ? match[1].trim() : null;
  }

  /**
   * Extract subtitle (city, region, postal code) from feature context
   */
  private static extractSubtitle(feature: MapboxFeature): string {
    if (!feature.context || feature.context.length === 0) {
      // Fallback: try to extract from place_name
      // Format is usually: "Address, City, State ZIP, Country"
      const parts = feature.place_name.split(',').slice(1); // Skip first part (address)
      if (parts.length >= 2) {
        return parts.slice(0, 2).join(',').trim();
      }
      return '';
    }

    // Extract city/place
    const city = feature.context.find(
      (ctx) => ctx.id.startsWith('place.') || ctx.id.startsWith('locality.')
    )?.text;

    // Extract region/state
    const region = feature.context.find(
      (ctx) => ctx.id.startsWith('region.')
    )?.text;

    // Extract postal code
    const postcode = feature.context.find(
      (ctx) => ctx.id.startsWith('postcode.')
    )?.text;

    // Build subtitle: prefer city + postcode, fallback to region
    const parts: string[] = [];
    if (city) parts.push(city);
    if (postcode) parts.push(postcode);
    if (parts.length === 0 && region) parts.push(region);

    return parts.join(', ').trim();
  }
}
