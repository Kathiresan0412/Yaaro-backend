import { Router } from "express";
import { env } from "../config/env";
import { requireAuth } from "../middleware/auth.middleware";

export const spotifyRouter = Router();

spotifyRouter.use(requireAuth);

let cachedToken: { token: string; expiresAt: number } | null = null;

async function spotifyAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.token;
  }

  if (!env.spotifyClientId || !env.spotifyClientSecret) {
    return null;
  }

  const credentials = Buffer.from(`${env.spotifyClientId}:${env.spotifyClientSecret}`).toString("base64");
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });

  const payload = (await response.json()) as { access_token?: string; expires_in?: number; error?: string };

  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error || "Spotify token request failed.");
  }

  cachedToken = {
    token: payload.access_token,
    expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
  };

  return cachedToken.token;
}

spotifyRouter.get("/spotify/search", async (req, res, next) => {
  try {
    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";

    if (query.length < 2) {
      return res.status(400).json({ success: false, message: "Search query must be at least 2 characters." });
    }

    const token = await spotifyAccessToken();

    if (!token) {
      return res.status(503).json({
        success: false,
        message: "Spotify search is not configured. Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET.",
      });
    }

    const params = new URLSearchParams({
      q: query,
      type: "track",
      limit: "10",
      market: "US",
    });

    const response = await fetch(`https://api.spotify.com/v1/search?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = (await response.json()) as {
      tracks?: {
        items?: Array<{
          id: string;
          name: string;
          preview_url: string | null;
          artists: Array<{ name: string }>;
          album: { images: Array<{ url: string; width: number | null; height: number | null }> };
          external_urls?: { spotify?: string };
        }>;
      };
      error?: { message?: string };
    };

    if (!response.ok) {
      throw new Error(payload.error?.message || "Spotify search failed.");
    }

    res.json({
      success: true,
      tracks: (payload.tracks?.items ?? []).map((track) => ({
        id: track.id,
        name: track.name,
        artist: track.artists.map((artist) => artist.name).join(", "),
        previewUrl: track.preview_url,
        albumArtUrl: track.album.images[0]?.url ?? null,
        spotifyUrl: track.external_urls?.spotify ?? null,
      })),
    });
  } catch (error) {
    next(error);
  }
});
