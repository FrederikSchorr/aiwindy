import type { Express } from "express";
import { createServer, type Server } from "http";
import { geocodeRequestSchema } from "@shared/schema";
import type { ForecastHour } from "@shared/schema";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  httpOptions: {
    apiVersion: "",
    baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
  },
});

function getRegionalModelFallback(lat: number, lon: number): { model: string; label: string; zoom: number } {
  if (lat >= 47 && lat <= 55.5 && lon >= 5 && lon <= 16) {
    return { model: "iconD2", label: "ICON-D2 (2.2km)", zoom: 8 };
  }
  if (lat >= 43 && lat <= 52 && lon >= 10 && lon <= 25) {
    return { model: "czeAladin", label: "ALADIN (Czech)", zoom: 7 };
  }
  if (lat >= 41 && lat <= 51.5 && lon >= -5.5 && lon <= 10) {
    return { model: "aromeHd", label: "AROME-HD (1.25km)", zoom: 8 };
  }
  if (lat >= 49 && lat <= 61 && lon >= -11 && lon <= 2) {
    return { model: "ukv", label: "UKV (Met Office)", zoom: 7 };
  }
  return { model: "iconEu", label: "ICON-EU (7km)", zoom: 6 };
}

const MODEL_SELECTION_PROMPT = `Du bist ein Meteorologie-Experte. Wähle das BESTE hochauflösende Windmodell für den gegebenen Ort auf Windy.com.

VERFÜGBARE MODELLE (Windy product parameter):
- "iconD2" = ICON-D2 (2.2km) - Deutschland, Österreich, Schweiz, Tschechien, Benelux
- "czeAladin" = ALADIN Czech - Tschechien, Slowakei, Ungarn, Kroatien, Slowenien, Serbien, Adria
- "aromeHd" = AROME-HD (1.25km) - Frankreich, Korsika  
- "arome" = AROME (2.5km) - Frankreich erweitert
- "ukv" = UKV Met Office - Großbritannien, Irland
- "mblue" = Meteoblue - global verfügbar, gut für Binnengewässer und Seen
- "iconEu" = ICON-EU (7km) - ganz Europa (Fallback)
- "gfs" = GFS - global (niedrige Auflösung)

ENTSCHEIDUNGSKRITERIEN (in dieser Priorität):
1. SEEN und BINNENGEWÄSSER (Neusiedler See, Bodensee, Gardasee, Balaton, Plattensee, Ammersee, Chiemsee, Genfer See, Zürichsee, etc.): IMMER "mblue" verwenden! Meteoblue modelliert lokale See-Thermik und Seewind am besten.
2. Adriatische Küste (Kroatien, Slowenien, Montenegro, Albanien): "czeAladin" wegen Bora, lokale Windphänomene
3. Frankreich, Korsika: "aromeHd" (höchste Auflösung 1.25km)
4. Deutschland, Österreich (NICHT an Seen), Schweiz: "iconD2" (2.2km)
5. UK, Irland: "ukv"
6. Sonstiges Europa: "iconEu"
7. Der Zoom-Level sollte die lokale Situation gut zeigen (8-9 für Seen und hochauflösende Modelle, 7 für regionale, 6 für europäische)

Antworte NUR mit einem JSON-Objekt, KEINE weiteren Erklärungen:
{"model": "...", "label": "...", "zoom": 8}

Das "label" soll den Modellnamen und Auflösung enthalten, z.B. "ICON-D2 (2.2km)" oder "Meteoblue (lokal)"`;

async function getRegionalModelAI(lat: number, lon: number, displayName: string): Promise<{ model: string; label: string; zoom: number }> {
  try {
    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{
        role: "user",
        parts: [{ text: `Ort: ${displayName}\nKoordinaten: ${lat.toFixed(4)}°N, ${lon.toFixed(4)}°E\n\nWähle das beste Windmodell.` }],
      }],
      config: {
        systemInstruction: MODEL_SELECTION_PROMPT,
        maxOutputTokens: 8192,
        temperature: 0,
      },
    });

    let text = "";
    try { text = result.text?.trim() || ""; } catch {}
    if (!text) {
      try { text = (result as any).candidates?.[0]?.content?.parts?.[0]?.text?.trim() || ""; } catch {}
    }
    const jsonMatch = text.match(/\{[^}]+\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const validModels = ["iconD2", "czeAladin", "aromeHd", "arome", "ukv", "mblue", "iconEu", "gfs"];
      if (parsed.model && validModels.includes(parsed.model) && parsed.label) {
        return {
          model: parsed.model,
          label: parsed.label,
          zoom: Math.min(Math.max(parsed.zoom || 7, 4), 10),
        };
      }
    }
  } catch (e: any) {
    console.error("AI model selection failed:", e?.message || e);
  }
  return getRegionalModelFallback(lat, lon);
}

async function fetchWeatherContext(lat: number, lon: number, displayName: string): Promise<string> {
  const parts: string[] = [];

  try {
    const openMeteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,cloud_cover,pressure_msl,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m&hourly=temperature_2m,precipitation_probability,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant&timezone=auto&forecast_days=5`;
    const meteoRes = await fetch(openMeteoUrl);
    if (meteoRes.ok) {
      const meteoData = await meteoRes.json();
      parts.push(`OPEN-METEO WETTERDATEN für ${displayName} (${lat.toFixed(2)}°N, ${lon.toFixed(2)}°E):\n${JSON.stringify(meteoData.current, null, 2)}`);
      if (meteoData.daily) {
        parts.push(`TAGESVORHERSAGE:\n${JSON.stringify(meteoData.daily, null, 2)}`);
      }
      if (meteoData.hourly) {
        const next24h = {
          time: meteoData.hourly.time?.slice(0, 24),
          temperature_2m: meteoData.hourly.temperature_2m?.slice(0, 24),
          wind_speed_10m: meteoData.hourly.wind_speed_10m?.slice(0, 24),
          wind_gusts_10m: meteoData.hourly.wind_gusts_10m?.slice(0, 24),
          wind_direction_10m: meteoData.hourly.wind_direction_10m?.slice(0, 24),
          pressure_msl: meteoData.hourly.pressure_msl?.slice(0, 24),
          precipitation_probability: meteoData.hourly.precipitation_probability?.slice(0, 24),
        };
        parts.push(`STÜNDLICHE VORHERSAGE (nächste 24h):\n${JSON.stringify(next24h, null, 2)}`);
      }
    }
  } catch (e) {
    console.error("Open-Meteo fetch error:", e);
  }

  try {
    const marineUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&current=wave_height,wave_direction,wave_period,wind_wave_height,wind_wave_direction,swell_wave_height,swell_wave_direction&hourly=wave_height,wave_direction,wave_period,wind_wave_height,swell_wave_height&timezone=auto&forecast_days=3`;
    const marineRes = await fetch(marineUrl);
    if (marineRes.ok) {
      const marineData = await marineRes.json();
      if (marineData.current) {
        parts.push(`MARINE/SEEGANG DATEN:\n${JSON.stringify(marineData.current, null, 2)}`);
      }
    }
  } catch (e) {
    // Marine data not available for inland locations
  }

  return parts.join("\n\n");
}

const METEOROLOGIST_SYSTEM_PROMPT = `Du bist ein erfahrener Meteorologe und Segelwetter-Experte. Du analysierst die europäische Großwetterlage und gibst fundierte Wetterberatung speziell für Segler.

DEINE AUFGABEN:
1. GROSSWETTERLAGE EUROPA: Analysiere die aktuelle Druckverteilung über Europa anhand der bereitgestellten Wetterdaten. Beschreibe Hoch- und Tiefdruckgebiete, deren Position und Zugbahn. Erkläre Warm- und Kaltfronten.

2. LOKALE AUSWIRKUNG: Erkläre wie die Großwetterlage den genannten Ort beeinflusst. Gehe auf lokale Windeffekte ein (z.B. Bora an der Adria, Mistral in Südfrankreich, Meltemi in der Ägäis, Föhn in den Alpen, Tramontana, etc.)

3. SEGELWETTER: Gib eine klare Einschätzung für Segler:
   - Windstärke und -richtung (in Beaufort und Knoten)
   - Seegang und Wellenhöhe falls verfügbar
   - Böigkeit und Windentwicklung
   - Sichtbedingungen
   - Wetterwarnung falls relevant

4. HINWEIS AUF KARTEN: Verweise auf die angezeigten Karten (Temperatur 850hPa, KNMI Frontenkarte, lokales Windmodell) und erkläre was dort zu sehen ist.

REGELN:
- Antworte auf Deutsch
- Keine Halluzinationen! Wenn du unsicher bist, sage das klar
- Basiere deine Analyse nur auf die bereitgestellten Daten
- Gib bei Unsicherheit eine Spanne an statt einer exakten Zahl
- Erwähne relevante regionale Windsysteme
- Formatiere übersichtlich mit Absätzen und Überschriften (Markdown)`;

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
        { headers: { "User-Agent": "WindyWeatherApp/1.0" } }
      );

      if (!response.ok) {
        return res.status(502).json({ error: "Geocoding service unavailable." });
      }

      const results = await response.json() as Array<{ lat: string; lon: string; display_name: string }>;

      if (!results.length) {
        return res.status(404).json({ error: "Location not found." });
      }

      const result = results[0];
      const lat = parseFloat(result.lat);
      const lon = parseFloat(result.lon);
      const regional = await getRegionalModelAI(lat, lon, result.display_name);

      return res.json({
        lat,
        lon,
        displayName: result.display_name,
        regionalModel: regional.model,
        regionalModelLabel: regional.label,
        regionalModelZoom: regional.zoom,
      });
    } catch {
      return res.status(500).json({ error: "Failed to geocode location." });
    }
  });

  app.get("/api/knmi-chart", async (_req, res) => {
    try {
      const now = new Date();
      const utcHour = now.getUTCHours();
      const utcDay = now.getUTCDate();
      const chartHour = utcHour >= 12 ? "12" : "00";
      const dayStr = utcDay.toString().padStart(2, "0");
      const chartUrl = `https://cdn.knmi.nl/knmi/map/page/weer/waarschuwingen_verwachtingen/weerkaarten/AL${dayStr}${chartHour}_large.gif`;

      const chartRes = await fetch(chartUrl);
      if (!chartRes.ok) {
        const fallbackUrl = `https://cdn.knmi.nl/knmi/map/page/weer/waarschuwingen_verwachtingen/weerkaarten/AL${dayStr}00_large.gif`;
        const fallbackRes = await fetch(fallbackUrl);
        if (!fallbackRes.ok) {
          return res.status(502).json({ error: "KNMI chart unavailable" });
        }
        res.setHeader("Content-Type", "image/gif");
        res.setHeader("Cache-Control", "public, max-age=1800");
        const buffer = Buffer.from(await fallbackRes.arrayBuffer());
        return res.send(buffer);
      }

      res.setHeader("Content-Type", "image/gif");
      res.setHeader("Cache-Control", "public, max-age=1800");
      const buffer = Buffer.from(await chartRes.arrayBuffer());
      return res.send(buffer);
    } catch {
      return res.status(500).json({ error: "Failed to fetch KNMI chart" });
    }
  });

  app.post("/api/forecast", async (req, res) => {
    const { lat, lon } = req.body;
    if (!lat || !lon) {
      return res.status(400).json({ error: "lat and lon required" });
    }

    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m&wind_speed_unit=kn&timezone=auto&forecast_days=5`;
      const meteoRes = await fetch(url);
      if (!meteoRes.ok) {
        return res.status(502).json({ error: "Forecast service unavailable" });
      }
      const data = await meteoRes.json();
      const hours: ForecastHour[] = (data.hourly?.time || []).map((t: string, i: number) => ({
        time: t,
        temp: data.hourly.temperature_2m?.[i] ?? 0,
        rain: data.hourly.precipitation?.[i] ?? 0,
        windSpeed: Math.round(data.hourly.wind_speed_10m?.[i] ?? 0),
        windGusts: Math.round(data.hourly.wind_gusts_10m?.[i] ?? 0),
        windDir: data.hourly.wind_direction_10m?.[i] ?? 0,
        weatherCode: data.hourly.weather_code?.[i] ?? 0,
      }));

      return res.json({ hours, timezone: data.timezone || "UTC" });
    } catch {
      return res.status(500).json({ error: "Failed to fetch forecast" });
    }
  });

  app.post("/api/weather-chat", async (req, res) => {
    const { lat, lon, displayName, message, history } = req.body;

    if (!lat || !lon || !displayName) {
      return res.status(400).json({ error: "Location data required" });
    }

    try {
      const weatherContext = await fetchWeatherContext(lat, lon, displayName);
      const regional = getRegionalModelFallback(lat, lon);

      const mapContext = `
ANGEZEIGTE KARTEN:
1. Temperatur 850hPa (ca. 1500m Höhe) - ECMWF Modell - zeigt die Großwetterlage über Europa von Nordatlantik bis Ural
2. KNMI Analyse-Karte - zeigt Druckgebilde, Fronten (Warmfronten rot, Kaltfronten blau, Okklusionen violett) über Europa
3. Lokales Windmodell: ${regional.label} - hochauflösendes Regionalmodell für den Bereich um ${displayName}

Der Benutzer betrachtet gerade die Wetterkarten für: ${displayName} (${lat.toFixed(2)}°N, ${lon.toFixed(2)}°E)
`;

      const chatHistory = (history || []).map((m: { role: string; content: string }) => ({
        role: m.role === "user" ? "user" : "model",
        parts: [{ text: m.content }],
      }));

      const contents = [
        ...chatHistory,
        {
          role: "user",
          parts: [{
            text: `${message}\n\n--- AKTUELLE WETTERDATEN ---\n${weatherContext}\n\n${mapContext}`
          }],
        },
      ];

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const stream = await ai.models.generateContentStream({
        model: "gemini-2.5-flash",
        contents,
        config: {
          systemInstruction: METEOROLOGIST_SYSTEM_PROMPT,
          maxOutputTokens: 4096,
          temperature: 0.3,
        },
      });

      for await (const chunk of stream) {
        const text = chunk.text || "";
        if (text) {
          res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
        }
      }

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (error) {
      console.error("Weather chat error:", error);
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ error: "Fehler bei der Wetteranalyse" })}\n\n`);
        res.end();
      } else {
        res.status(500).json({ error: "Failed to generate weather analysis" });
      }
    }
  });

  return httpServer;
}
