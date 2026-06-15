/**
 * Geocoding service using OpenStreetMap Nominatim (free, no API key).
 * Resolves city/country strings to latitude/longitude coordinates.
 *
 * Used as a fallback when the mobile app sends a city name without coordinates
 * (e.g., the user typed "Mallavi, Sri Lanka" which may not have GPS-level
 * resolution on the client).
 */

interface GeocodingResult {
  latitude: number;
  longitude: number;
  city: string;
  country: string;
  displayName: string;
}

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";

/**
 * Forward geocode: city + country → lat/lng.
 * Returns null if the location cannot be resolved.
 */
export async function geocodeCity(
  city: string,
  country: string,
): Promise<GeocodingResult | null> {
  const query = country ? `${city}, ${country}` : city;

  try {
    const url = new URL(`${NOMINATIM_BASE}/search`);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "1");
    url.searchParams.set("addressdetails", "1");

    const response = await fetch(url.toString(), {
      headers: {
        "User-Agent": "YaaroBackend/1.0",
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      console.warn(`[Geocoding] HTTP ${response.status} for "${query}"`);
      return null;
    }

    const results = (await response.json()) as Array<Record<string, unknown>>;
    if (!results.length) {
      console.warn(`[Geocoding] No results for "${query}"`);
      return null;
    }

    const first = results[0];
    const lat = parseFloat(String(first.lat));
    const lng = parseFloat(String(first.lon));

    if (isNaN(lat) || isNaN(lng)) return null;

    const address = first.address as Record<string, string> | undefined;
    const resolvedCity =
      address?.city ?? address?.town ?? address?.village ?? address?.hamlet ?? city;
    const resolvedCountry = address?.country ?? country;

    return {
      latitude: lat,
      longitude: lng,
      city: resolvedCity,
      country: resolvedCountry,
      displayName: String(first.display_name ?? query),
    };
  } catch (error) {
    console.error(`[Geocoding] Error geocoding "${query}":`, error);
    return null;
  }
}
