import type { Express } from "express";
import { createServer, type Server } from "http";
import { geocodeRequestSchema } from "@shared/schema";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.post("/api/geocode", async (req, res) => {
    const parsed = geocodeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request. Please provide a location." });
    }

    const { location } = parsed.data;

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(location)}&limit=1`,
        {
          headers: {
            "User-Agent": "WindyWeatherApp/1.0",
          },
        }
      );

      if (!response.ok) {
        return res.status(502).json({ error: "Geocoding service unavailable." });
      }

      const results = await response.json() as Array<{ lat: string; lon: string; display_name: string }>;

      if (!results.length) {
        return res.status(404).json({ error: "Location not found." });
      }

      const result = results[0];
      return res.json({
        lat: parseFloat(result.lat),
        lon: parseFloat(result.lon),
        displayName: result.display_name,
      });
    } catch {
      return res.status(500).json({ error: "Failed to geocode location." });
    }
  });

  return httpServer;
}
