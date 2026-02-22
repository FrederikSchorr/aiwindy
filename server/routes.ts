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

const METEOROLOGIST_SYSTEM_PROMPT = `Du bist ein erfahrener Meteorologe und Segelwetter-Experte. Du schreibst fundierte, lebendige Wetteranalysen in einem professionellen aber verständlichen Stil — wie ein erfahrener Skipper, der seinem Crew die Wetterlage am Morgen-Briefing erklärt.

STRUKTUR DEINER ANALYSE (immer diese 4 Kapitel, nummeriert):

## 1. Die Großwetterlage
Analysiere die synoptische Lage über Europa. Beschreibe bildhaft und konkret:
- Wo liegen die Hochs und Tiefs? Nenne geschätzte Kerndrücke (z.B. "ein kräftiges Hoch mit ca. 1027 hPa über dem Balkan").
- Was blockiert was? (z.B. "Das Hoch blockiert atlantische Tiefs und drückt sie nach Norden")
- Wo fließt kalte/warme Luft hin? Beschreibe Kaltluft-Zungen oder Warmluft-Vorstöße anhand der 850hPa-Temperaturkarte ("In der Temperaturkarte auf 1500m Höhe siehst du eine markante blau-violette Fläche im Nordosten — dort fließt polare Kaltluft südwärts")
- Zugrichtung: Wie entwickelt sich die Lage in den nächsten 2-3 Tagen?

## 2. Wo stecken die Fronten?
Erkläre die Frontensituation mit Bezug auf die KNMI-Frontenkarte:
- Wo verläuft die Frontalzone? (z.B. "Die eigentliche Frontalzone verläuft aktuell weit nördlich über Schottland und Skandinavien")
- Gibt es Kalt-/Warmfronten in der Nähe des Ortes?
- Wo liegt die Luftmassengrenze? (z.B. "Der Übergangsbereich zwischen milder Mittelmeerluft und kalter Kontinentalluft verläuft über Polen")
- Gibt es okkludierte Fronten oder Wellenstörungen?

## 3. Fokus [ORTSNAME] — Speziell für Segler
Die lokale Analyse mit konkreten Zahlen aus den Wetterdaten:
- **Aktuelles Wetter:** Temperatur, Bewölkung, Sicht, Luftdruck
- **Wind:** Richtung, Stärke in Knoten UND Beaufort, Böen. Entwicklung über den Tag.
- **Seegang:** Wellenhöhe, Wellenperiode, Dünung falls verfügbar
- **Lokale Windphänomene:** Bora, Mistral, Meltemi, Föhn, Tramontana, Land-/Seewind-Zirkulation, thermische Winde an Seen — was ist relevant und warum?
- **WICHTIG:** Warnungen hervorheben! Wenn lokale Windsysteme (Bora, Mistral etc.) gefährlich werden können, klar warnen. Beispiel: "Die Bora kann in exponierten Lagen 35-55 kt erreichen — auch wenn es in der geschützten Bucht von Punat ruhig aussieht!"
- Bezug auf die lokale Windkarte nehmen ("Im lokalen ALADIN/ICON-D2-Modell siehst du...")

## 4. Segelempfehlung & Ausblick
Konkrete Handlungsempfehlung für Segler:
- Ist heute ein guter Segeltag? Für wen? (Anfänger, Fortgeschrittene, Regatta)
- Welche Tageszeit ist am besten/gefährlichsten?
- Was ändert sich morgen und übermorgen?
- Gibt es ein Wetterfenster das man nutzen sollte?
- Konkreter Rat (z.B. "Perfekt für einen Nachmittags-Schlag, aber vor 16 Uhr zurück im Hafen sein — der Wind dreht auf NE und frischt auf")

STIL-REGELN:
- Deutsch, professionell aber lebendig — wie ein erfahrener Skipper spricht
- Beziehe dich direkt auf die angezeigten Karten ("In der 850hPa-Karte siehst du...", "Die KNMI-Frontenkarte zeigt...", "Im lokalen Windmodell erkennst du...")
- Nutze konkrete Zahlen aus den Daten, aber halluziniere KEINE Werte die nicht in den Daten stehen
- Wenn du unsicher bist, sage es ehrlich ("Die Daten deuten auf... aber Vorsicht, das kann sich schnell ändern")
- Verwende Markdown für übersichtliche Formatierung
- Windangaben immer in Knoten UND Beaufort (z.B. "12 kt / 4 Bft")
- Bei Druckangaben hPa verwenden`;

const WARNING_SERVICES: Record<string, { url: string; label: string }> = {
  HR: { url: "https://meteo.hr/naslovnica-upozorenja.php?lang=en&tab=upozorenja", label: "DHMZ Kroatien" },
  DE: { url: "https://www.dwd.de/DE/wetter/warnungen_gemeinden/warnWetter_node.html", label: "DWD Deutschland" },
  AT: { url: "https://warnungen.zamg.at/wsapp/de/alle", label: "GeoSphere Austria" },
  IT: { url: "https://www.meteoam.it/it/avvisi-meteo", label: "MeteoAM Italien" },
  FR: { url: "https://vigilance.meteofrance.fr/fr", label: "Météo-France" },
  NL: { url: "https://www.knmi.nl/nederland-nu/weer/waarschuwingen", label: "KNMI Niederlande" },
  GB: { url: "https://www.metoffice.gov.uk/weather/warnings-and-advice/uk-warnings", label: "Met Office UK" },
  GR: { url: "http://www.emy.gr/emy/en/warning/warning", label: "EMY Griechenland" },
  SI: { url: "https://meteo.arso.gov.si/met/sl/warning/", label: "ARSO Slowenien" },
  ES: { url: "https://www.aemet.es/es/eltiempo/prediccion/avisos", label: "AEMET Spanien" },
  PT: { url: "https://www.ipma.pt/en/otempo/prev.am.geral/", label: "IPMA Portugal" },
  DK: { url: "https://www.dmi.dk/vejr/varsler/", label: "DMI Dänemark" },
  SE: { url: "https://www.smhi.se/vader/varningar-och-meddelanden", label: "SMHI Schweden" },
  NO: { url: "https://www.yr.no/en/content/1-72837/meteorological", label: "Yr.no Norwegen" },
  ME: { url: "https://www.meteo.co.me/misc.php?text=117&seession=", label: "ZHMS Montenegro" },
  TR: { url: "https://www.mgm.gov.tr/en/forecast-warnings.aspx", label: "MGM Türkei" },
  PL: { url: "https://meteo.imgw.pl/dyn/", label: "IMGW Polen" },
  CH: { url: "https://www.meteoswiss.admin.ch/home/weather/warnings.html", label: "MeteoSchweiz" },
};

function getWarningInfo(countryCode: string): { url: string; label: string } | undefined {
  return WARNING_SERVICES[countryCode];
}

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

      let countryCode: string | undefined;
      try {
        const reverseRes = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=3&addressdetails=1`,
          { headers: { "User-Agent": "WindyWeatherApp/1.0" } }
        );
        if (reverseRes.ok) {
          const reverseData = await reverseRes.json() as { address?: { country_code?: string } };
          countryCode = reverseData.address?.country_code?.toUpperCase();
        }
      } catch {}

      const warningInfo = countryCode ? getWarningInfo(countryCode) : undefined;

      return res.json({
        lat,
        lon,
        displayName: result.display_name,
        regionalModel: regional.model,
        regionalModelLabel: regional.label,
        regionalModelZoom: regional.zoom,
        countryCode,
        warningUrl: warningInfo?.url,
        warningLabel: warningInfo?.label,
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
ANGEZEIGTE KARTEN (die der Benutzer rechts neben dem Chat sieht):
1. Temperatur 850hPa (ca. 1500m Höhe) - ECMWF Modell, Zoom auf Nordatlantik/Europa (zentriert 55°N, 10°W) — zeigt Luftmassen, Kaltluft-Zungen (blau/violett) und Warmluft-Vorstöße (gelb/orange/rot)
2. KNMI Fronten-Analysekarte — zeigt Druckgebilde (H/L mit hPa-Werten), Fronten (Warmfronten rot halb-kreise, Kaltfronten blau Dreiecke, Okklusionen violett), Isobaren
3. Lokales Windmodell: ${regional.label} — hochauflösendes Regionalmodell, zeigt Windfelder (Stärke farbcodiert, Richtung mit Pfeilen) für den Bereich um ${displayName}
4. Windy Vorhersage — Zeitleiste mit Wind, Böen, Temperatur für die nächsten Tage

ORT: ${displayName} (${lat.toFixed(4)}°N, ${lon.toFixed(4)}°E)
Verwende "${displayName.split(",")[0].trim()}" als Ortsnamen in Kapitel 3 (z.B. "## 3. Fokus ${displayName.split(",")[0].trim()} — Speziell für Segler").
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
          maxOutputTokens: 8192,
          temperature: 0.4,
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
