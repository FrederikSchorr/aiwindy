import type { Express } from "express";
import { createServer, type Server } from "http";
import { geocodeRequestSchema } from "@shared/schema";
import type { ForecastHour } from "@shared/schema";
import OpenAI from "openai";
import multer from "multer";
import exifParser from "exif-parser";
import fs from "fs";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const gemini = new GoogleGenerativeAI(process.env.AI_INTEGRATIONS_GEMINI_API_KEY || "");

function getRegionalModelFallback(lat: number, lon: number): { model: string; label: string; zoom: number } {
  if (lat >= 47 && lat <= 55.5 && lon >= 5 && lon <= 16) {
    return { model: "iconD2", label: "ICON-D2 (2.2km)", zoom: 8 };
  }
  if (lat >= 43 && lat <= 52 && lon >= 10 && lon <= 25) {
    return { model: "czeAladin", label: "ALADIN", zoom: 7 };
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
- "czeAladin" = ALADIN - Tschechien, Slowakei, Ungarn, Kroatien, Slowenien, Serbien, Adria
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

Das "label" soll den Modellnamen und Auflösung enthalten, z.B. "ICON-D2 (2.2km)", "ALADIN" oder "Meteoblue (lokal)". Schreibe NIEMALS "Czech" oder "Aladin Czech" — nur "ALADIN".`;

async function getRegionalModelAI(lat: number, lon: number, displayName: string): Promise<{ model: string; label: string; zoom: number }> {
  try {
    const result = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: MODEL_SELECTION_PROMPT },
        { role: "user", content: `Ort: ${displayName}\nKoordinaten: ${lat.toFixed(4)}°N, ${lon.toFixed(4)}°E\n\nWähle das beste Windmodell.` },
      ],
      max_completion_tokens: 256,
      temperature: 0,
    });

    const text = result.choices[0]?.message?.content?.trim() || "";
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
  } catch (e) {
    console.error("AI model selection failed:", e instanceof Error ? e.message : e);
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

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchMeteonews(): Promise<string> {
  try {
    const res = await fetch("https://meteonews.at/de/Allgemeine_Lage/K33/Europa", {
      headers: { "User-Agent": "WindyWeatherApp/1.0", "Accept": "text/html" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return "";
    const html = await res.text();
    const bodyMatch = html.match(/<div[^>]*class="[^"]*forecast[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
      || html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
      || html.match(/<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (bodyMatch) {
      return stripHtml(bodyMatch[1]).slice(0, 2000);
    }
    const plainText = stripHtml(html);
    const startIdx = plainText.indexOf("Allgemeine Lage");
    if (startIdx >= 0) {
      return plainText.slice(startIdx, startIdx + 2000);
    }
    return plainText.slice(0, 2000);
  } catch (e) {
    console.error("Meteonews fetch failed:", e);
    return "";
  }
}

const REGIONAL_FORECAST_SERVICES: Record<string, { forecastUrl: string; label: string; warningUrl: string; warningLabel: string }> = {
  HR: {
    forecastUrl: "https://meteo.hr/prognoze.php?section=prognoze_model&param=3d",
    label: "DHMZ Kroatien",
    warningUrl: "https://meteo.hr/naslovnica-upozorenja.php?lang=en&tab=upozorenja",
    warningLabel: "DHMZ Warnungen",
  },
  DE: {
    forecastUrl: "https://www.dwd.de/DWD/wetter/wv_allg/deutschland/text/vhdl13_dwoh.html",
    label: "DWD Deutschland",
    warningUrl: "https://www.dwd.de/DE/wetter/warnungen_gemeinden/warnWetter_node.html",
    warningLabel: "DWD Warnungen",
  },
  AT: {
    forecastUrl: "https://www.zamg.ac.at/cms/de/wetter/wetterlage",
    label: "GeoSphere Austria",
    warningUrl: "https://warnungen.zamg.at/wsapp/de/alle",
    warningLabel: "GeoSphere Warnungen",
  },
  IT: {
    forecastUrl: "https://www.meteoam.it/it/previsione-italia",
    label: "MeteoAM Italien",
    warningUrl: "https://www.meteoam.it/it/avvisi-meteo",
    warningLabel: "MeteoAM Warnungen",
  },
  FR: {
    forecastUrl: "https://meteofrance.com/previsions-meteo-france",
    label: "Météo-France",
    warningUrl: "https://vigilance.meteofrance.fr/fr",
    warningLabel: "Météo-France Vigilance",
  },
  GR: {
    forecastUrl: "https://emy.gr/en/forecast/greece",
    label: "EMY Griechenland",
    warningUrl: "https://emy.gr/en/warnings",
    warningLabel: "EMY Warnungen",
  },
  SI: {
    forecastUrl: "https://meteo.arso.gov.si/met/sl/weather/forecast/",
    label: "ARSO Slowenien",
    warningUrl: "https://meteo.arso.gov.si/met/sl/warning/",
    warningLabel: "ARSO Warnungen",
  },
  ME: {
    forecastUrl: "https://www.meteo.co.me/misc.php?text=117",
    label: "ZHMS Montenegro",
    warningUrl: "https://www.meteo.co.me/misc.php?text=117&seession=",
    warningLabel: "ZHMS Warnungen",
  },
  GB: {
    forecastUrl: "https://www.metoffice.gov.uk/weather/forecast/uk",
    label: "Met Office UK",
    warningUrl: "https://www.metoffice.gov.uk/weather/warnings-and-advice/uk-warnings",
    warningLabel: "Met Office Warnungen",
  },
  NL: {
    forecastUrl: "https://www.knmi.nl/nederland-nu/weer/verwachtingen",
    label: "KNMI Niederlande",
    warningUrl: "https://www.knmi.nl/nederland-nu/weer/waarschuwingen",
    warningLabel: "KNMI Warnungen",
  },
  ES: {
    forecastUrl: "https://www.aemet.es/es/eltiempo/prediccion/espana",
    label: "AEMET Spanien",
    warningUrl: "https://www.aemet.es/es/eltiempo/prediccion/avisos",
    warningLabel: "AEMET Warnungen",
  },
  PT: {
    forecastUrl: "https://www.ipma.pt/en/otempo/prev.am.geral/",
    label: "IPMA Portugal",
    warningUrl: "https://www.ipma.pt/en/otempo/prev.am.geral/",
    warningLabel: "IPMA Warnungen",
  },
  TR: {
    forecastUrl: "https://www.mgm.gov.tr/en/forecast-cities.aspx",
    label: "MGM Türkei",
    warningUrl: "https://www.mgm.gov.tr/en/forecast-warnings.aspx",
    warningLabel: "MGM Warnungen",
  },
  DK: {
    forecastUrl: "https://www.dmi.dk/vejr/",
    label: "DMI Dänemark",
    warningUrl: "https://www.dmi.dk/vejr/varsler/",
    warningLabel: "DMI Warnungen",
  },
  SE: {
    forecastUrl: "https://www.smhi.se/vader",
    label: "SMHI Schweden",
    warningUrl: "https://www.smhi.se/vader/varningar-och-meddelanden",
    warningLabel: "SMHI Warnungen",
  },
  NO: {
    forecastUrl: "https://www.yr.no/en",
    label: "Yr.no Norwegen",
    warningUrl: "https://www.yr.no/en/content/1-72837/meteorological",
    warningLabel: "Yr.no Warnungen",
  },
  PL: {
    forecastUrl: "https://meteo.imgw.pl/",
    label: "IMGW Polen",
    warningUrl: "https://meteo.imgw.pl/dyn/",
    warningLabel: "IMGW Warnungen",
  },
  CH: {
    forecastUrl: "https://www.meteoswiss.admin.ch/home/weather/forecasts.html",
    label: "MeteoSchweiz",
    warningUrl: "https://www.meteoswiss.admin.ch/home/weather/warnings.html",
    warningLabel: "MeteoSchweiz Warnungen",
  },
};

function getRegionalService(countryCode: string): typeof REGIONAL_FORECAST_SERVICES["HR"] | undefined {
  return REGIONAL_FORECAST_SERVICES[countryCode];
}

async function fetchRegionalWeatherReport(countryCode: string, lat: number, lon: number): Promise<string> {
  const service = REGIONAL_FORECAST_SERVICES[countryCode];
  if (!service) return "";

  try {
    const res = await fetch(service.forecastUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "de,en;q=0.9",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return "";
    const html = await res.text();
    const text = stripHtml(html);
    return text.slice(0, 3000);
  } catch (e) {
    console.error(`Regional forecast fetch failed for ${countryCode} (${lat.toFixed(2)},${lon.toFixed(2)}):`, e);
    return "";
  }
}

async function fetchRegionalWarnings(countryCode: string): Promise<string> {
  const service = REGIONAL_FORECAST_SERVICES[countryCode];
  if (!service) return "";

  try {
    const res = await fetch(service.warningUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "de,en;q=0.9",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return "";
    const html = await res.text();
    const text = stripHtml(html);
    return text.slice(0, 2000);
  } catch (e) {
    console.error(`Regional warnings fetch failed for ${countryCode}:`, e);
    return "";
  }
}

async function classifyMessage(message: string, hasActiveLocation: boolean): Promise<{ type: "ANALYSE" | "CHAT" | "UNCLEAR"; location?: string }> {
  try {
    const result = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: `Klassifiziere die Benutzernachricht in eine von drei Kategorien:

ANALYSE <Ortsname> — wenn der Benutzer nach Wetterlage/Segelbedingungen an einem konkreten Ort fragt, oder einfach nur einen Ortsnamen/See/Insel/Hafen/Küste eingibt. Beispiele:
- "Punat" → ANALYSE Punat
- "Wie ist das Wetter in Split?" → ANALYSE Split
- "Segeln am Gardasee" → ANALYSE Gardasee
- "Rovinj, Kroatien" → ANALYSE Rovinj, Kroatien
- "Wetterlage Elba" → ANALYSE Elba

CHAT — wenn der Benutzer eine allgemeine Frage zu Wetter, Meteorologie, Wolken, Segeln stellt, die KEINEN konkreten Wetterbericht erfordert, ODER eine Rückfrage zu einer laufenden Analyse stellt. Beispiele:
- "Was sind Cumulonimbus-Wolken?" → CHAT
- "Wie entsteht die Bora?" → CHAT
- "Erkläre die Douglas-Skala" → CHAT
- "Wird der Wind stärker?" → CHAT (Rückfrage)
- "Wie sieht es morgen aus?" → CHAT (Rückfrage)

UNCLEAR — wenn nicht klar ist ob ein Ort gemeint ist, oder die Nachricht mehrdeutig ist. Beispiele:
- "Wetter" → UNCLEAR
- "Wie ist es dort?" → UNCLEAR (ohne aktiven Ort)
- "Segeln" → UNCLEAR

${hasActiveLocation ? "Es ist bereits ein Ort aktiv im System." : "Es ist KEIN Ort aktiv."}

Antworte NUR mit der Kategorie (und bei ANALYSE dem Ortsnamen). Nichts anderes.`,
        },
        { role: "user", content: message },
      ],
      max_completion_tokens: 64,
      temperature: 0,
    });
    const text = result.choices[0]?.message?.content?.trim() || "";
    if (text.startsWith("ANALYSE")) {
      const location = text.replace("ANALYSE", "").trim();
      return { type: "ANALYSE", location: location || undefined };
    }
    if (text === "UNCLEAR") {
      return { type: "UNCLEAR" };
    }
    return { type: "CHAT" };
  } catch (e) {
    console.error("Message classification failed:", e instanceof Error ? e.message : e);
    return { type: "CHAT" };
  }
}

async function geocodeLocation(locationName: string): Promise<{
  lat: number; lon: number; displayName: string;
  regionalModel: string; regionalModelLabel: string; regionalModelZoom: number;
  countryCode?: string;
} | null> {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(locationName)}&limit=1`,
      { headers: { "User-Agent": "WindyWeatherApp/1.0" } }
    );
    if (!response.ok) return null;

    const results = await response.json() as Array<{ lat: string; lon: string; display_name: string }>;
    if (!results.length) return null;

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

    return {
      lat, lon,
      displayName: result.display_name,
      regionalModel: regional.model,
      regionalModelLabel: regional.label,
      regionalModelZoom: regional.zoom,
      countryCode,
    };
  } catch {
    return null;
  }
}

function getKnmiChartTime(): string {
  const now = new Date();
  const utcHour = now.getUTCHours();
  return utcHour >= 12 ? "12" : "00";
}

const GENERAL_CHAT_PROMPT = `Du bist ein erfahrener Meteorologe und Segelexperte. Du beantwortest allgemeine Fragen zu Wetter, Meteorologie, Wolken, Wind, Segeln und verwandten Themen.

STIL:
- Deutsch, sachlich-professionell
- Bullet-Points wo sinnvoll
- Emojis sparsam zur Strukturierung
- Konkret und hilfreich, keine Floskeln
- Bei Segelfragen: praktische Tipps aus Segler-Perspektive
- Kurz und prägnant antworten, nicht übermäßig lang`;

const ANALYSIS_SYSTEM_PROMPT = `Du bist ein Meteorologe und Segelwetter-Experte. Erstelle eine strukturierte Segelwetteranalyse in genau 6 Abschnitten.

WICHTIG: Schreibe die Abschnitte EXAKT mit diesen Überschriften (## N. Titel) — die Überschriften steuern die Kartendarstellung!

## 1. Luftmassen
- Fasse die europäische Wetterdynamik in 1-2 prägnanten Sätzen/Bullets zusammen
- Basierend auf dem METEONEWS-TEXT (falls vorhanden) und den Wetterdaten
- Gib die Quelle meteonews.at in Klammern an wenn verfügbar
- Beschreibe dominierende Druckgebilde, Luftmassengrenzen, 850hPa-Situation

## 2. Fronten
- Basierend auf dem meteonews-Text, den Wetterdaten und dem Zielort
- Fasse die regional relevanten Fronten in 1-2 Bullets zusammen
- Welche Fronten beeinflussen die Region? Zugweg?

## 3. Wind & Welle
- Basierend auf dem REGIONALEN WETTERBERICHT (falls vorhanden) und den Wetterdaten
- Beschreibe relevante Windsysteme und Windstärken für die nächsten 12h in 1-2 Bullets
- Bora, Maestral, Meltemi, Mistral, thermische Winde — was ist relevant?
- Windangaben: kt / Bft
- Seezustand auf Douglas-Skala für die nächsten 12h (falls Seedaten vorhanden)
- Gib die Quelle des regionalen Wetterberichts an

## 4. Wolken & Regen
- Basierend auf dem regionalen Wetterbericht und den Wetterdaten
- Beschreibe Bewölkung, Niederschlag, Gewitterrisiko für die nächsten 12h in 1-2 Bullets

## 5. Prognose
- Kurzer Ausblick auf die nächsten 2-3 Tage in 1-2 Bullets
- Tendenz: besser/schlechter/stabil?

## 6. Wetterwarnung
- Basierend auf dem regionalen Wetterbericht
- Aktive Warnungen oder "Keine aktuellen Wetterwarnungen"
- Bei Warnungen: konkrete Werte und Zeitfenster
- Gib die Quelle des regionalen Warndienstes an

STIL-REGELN:
- Deutsch, sachlich-professionell, KEINE Begrüßung, KEINE Floskeln
- Bullet-Point-Stil, Fließtext minimieren
- Jeder Abschnitt: maximal 1-3 Bullets, KURZ und PRÄGNANT
- Emojis sparsam: 💨 Wind, 🌊 Welle, ☀️ Sonne, ☁️ Wolken, 🌧️ Regen, ⚠️ Warnung, ⛈️ Gewitter
- Konkrete Zahlen aus den Daten, KEINE halluzinierten Werte
- Windangaben: kt / Bft
- Druckangaben: hPa

ABSCHLUSS:
"---\n**Rückfragen?** Gerne zu Details, Routenplanung oder Zeitfenstern."`;


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
      const geocoded = await geocodeLocation(location);
      if (!geocoded) {
        return res.status(404).json({ error: "Location not found." });
      }

      const service = geocoded.countryCode ? getRegionalService(geocoded.countryCode) : undefined;

      return res.json({
        ...geocoded,
        warningUrl: service?.warningUrl,
        warningLabel: service?.warningLabel,
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

  const upload = multer({
    dest: "/tmp/uploads",
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "video/mp4", "video/quicktime", "video/webm"];
      cb(null, allowed.includes(file.mimetype));
    },
  });

  const PHOTO_ANALYSIS_PROMPT = `Du bist ein Meteorologe und Wolkenexperte. Analysiere dieses Foto/Bild auf meteorologisch relevante Inhalte.

AUFGABE:
1. Prüfe ob das Bild meteorologisch relevant ist (Himmel, Wolken, Wasser, Wetterstimmung)
2. Falls JA — analysiere detailliert:

## ☁️ Wolkenanalyse
- **Wolkentyp(en):** Exakte Klassifikation (z.B. Cumulus congestus, Cumulonimbus, Cirrus uncinus, Altocumulus lenticularis, Stratocumulus, etc.)
- **Wolkenhöhe:** Geschätzte Höhe in Metern und Kategorie (tief/mittel/hoch)
- **Bedeckungsgrad:** In Okta (0-8) oder Prozent

## 🌤️ Wetterlage
- **Aktuelle Situation:** Was zeigt das Bild über die aktuelle Wetterlage?
- **Typische Drucklage:** Welche synoptische Situation erzeugt diese Wolkenformationen?

## ⛵ Vorboten & Prognose
- **Wetterentwicklung:** Wofür sind diese Wolken Vorboten? Was kommt wahrscheinlich als nächstes?
- **Zeitrahmen:** In welchem Zeitraum ist mit Veränderung zu rechnen?
- **Relevanz für Segler:** Warnsignale, Windentwicklung, Gewitter-Risiko

3. Falls NEIN (kein meteorologisch relevantes Bild): Sag kurz, dass das Bild keinen Himmel/Wolken/Wetter zeigt und bitte um ein Foto vom Himmel oder Horizont.

STIL: Deutsch, sachlich-professionell, mit Emojis zur Strukturierung. Bullet-Points bevorzugen.`;

  app.post("/api/upload", upload.single("photo"), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "Keine Datei hochgeladen" });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    if (req.socket) req.socket.setNoDelay(true);

    const sendSSE = (data: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const filePath = req.file.path;
      const fileBuffer = fs.readFileSync(filePath);
      const isVideo = req.file.mimetype.startsWith("video/");

      sendSSE({ status: isVideo ? "📹 Video empfangen — analysiere..." : "📷 Foto empfangen — analysiere Metadaten..." });

      let exifLocation: { lat: number; lon: number } | null = null;
      let exifTime: string | null = null;

      if (!isVideo && (req.file.mimetype === "image/jpeg" || req.file.mimetype === "image/png")) {
        try {
          const parser = exifParser.create(fileBuffer);
          const exifData = parser.parse();
          const tags = exifData.tags;

          if (tags.GPSLatitude && tags.GPSLongitude) {
            exifLocation = {
              lat: tags.GPSLatitude as number,
              lon: tags.GPSLongitude as number,
            };
          }

          if (tags.DateTimeOriginal) {
            const ts = tags.DateTimeOriginal as number;
            exifTime = new Date(ts * 1000).toLocaleString("de-DE", { timeZone: "Europe/Berlin" });
          }
        } catch (e) {
          console.log("EXIF parsing failed (non-critical):", e);
        }
      }

      let metadataInfo = "";
      if (exifLocation) {
        sendSSE({ status: `📍 GPS gefunden: ${exifLocation.lat.toFixed(4)}°N, ${exifLocation.lon.toFixed(4)}°E` });
        metadataInfo += `\nGPS-Koordinaten aus EXIF: ${exifLocation.lat.toFixed(4)}°N, ${exifLocation.lon.toFixed(4)}°E`;

        const geocoded = await geocodeLocation(`${exifLocation.lat},${exifLocation.lon}`);
        if (geocoded) {
          sendSSE({ location: geocoded });
          sendSSE({ status: `📍 Ort: **${geocoded.displayName.split(",")[0]}** — Karten aktualisiert` });
          metadataInfo += `\nOrt: ${geocoded.displayName}`;
        }
      }

      if (exifTime) {
        sendSSE({ status: `🕐 Aufnahmezeitpunkt: ${exifTime}` });
        metadataInfo += `\nAufnahmezeitpunkt: ${exifTime}`;
      }

      if (!exifLocation && !exifTime && !isVideo) {
        sendSSE({ status: "ℹ️ Keine GPS/Zeit-Metadaten im Bild gefunden" });
      }

      const currentLocation = req.body?.currentLocation ? JSON.parse(req.body.currentLocation) : null;
      let locationContext = "";
      if (currentLocation) {
        locationContext = `\nAktueller aktiver Ort im System: ${currentLocation.displayName} (${currentLocation.lat}°N, ${currentLocation.lon}°E)`;
      }
      if (metadataInfo) {
        locationContext += `\nBild-Metadaten: ${metadataInfo}`;
      }

      const systemPrompt = PHOTO_ANALYSIS_PROMPT + (locationContext ? `\n\nKONTEXT:${locationContext}` : "");

      if (isVideo) {
        sendSSE({ status: "🔍 Analysiere Video mit Gemini KI..." });

        const base64Video = fileBuffer.toString("base64");
        const videoPrompt = systemPrompt.replace("Foto/Bild", "Video").replace("dieses Bild", "dieses Video") + "\n\nBesonders beachten bei Videos:\n- Wolkenbewegung und -entwicklung über die Zeit\n- Wellenmuster und Windstärke auf dem Wasser\n- Veränderungen in Lichtverhältnissen und Sichtweite\n- Dynamische Wetterphänomene (ziehende Fronten, aufbauende Konvektion)";

        const geminiModel = gemini.getGenerativeModel(
          { model: "gemini-2.5-flash" },
          { baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL }
        );

        const result = await geminiModel.generateContentStream({
          contents: [{
            role: "user",
            parts: [
              { inlineData: { mimeType: req.file!.mimetype, data: base64Video } },
              { text: "Analysiere dieses Video meteorologisch. Achte besonders auf Bewegungen und zeitliche Entwicklungen." },
            ],
          }],
          systemInstruction: { role: "user", parts: [{ text: videoPrompt }] },
        });

        for await (const chunk of result.stream) {
          const text = chunk.text();
          if (text) {
            sendSSE({ content: text });
          }
        }
      } else {
        sendSSE({ status: "🔍 Analysiere Bild mit KI..." });

        const base64Image = fileBuffer.toString("base64");

        const imageMessages: OpenAI.ChatCompletionMessageParam[] = [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: {
                  url: `data:${req.file!.mimetype};base64,${base64Image}`,
                  detail: "high",
                },
              },
              {
                type: "text",
                text: "Analysiere dieses Bild meteorologisch.",
              },
            ],
          },
        ];

        const stream = await openai.chat.completions.create({
          model: "gpt-4.1",
          messages: imageMessages,
          max_completion_tokens: 4096,
          temperature: 0.3,
          stream: true,
        });

        for await (const chunk of stream) {
          const text = chunk.choices?.[0]?.delta?.content;
          if (text) {
            sendSSE({ content: text });
          }
        }
      }

      sendSSE({ done: true });
      res.end();

      try { fs.unlinkSync(filePath); } catch {}
    } catch (error) {
      console.error("Upload analysis error:", error);
      if (res.headersSent) {
        sendSSE({ error: "Fehler bei der Bildanalyse" });
        res.end();
      } else {
        res.status(500).json({ error: "Failed to analyze image" });
      }
      try { if (req.file) fs.unlinkSync(req.file.path); } catch {}
    }
  });

  app.post("/api/chat", async (req, res) => {
    const { message, history, currentLocation } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message required" });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    if (req.socket) req.socket.setNoDelay(true);

    const sendSSE = (data: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const hasActiveLocation = !!currentLocation;
      const classification = await classifyMessage(message, hasActiveLocation);

      if (classification.type === "CHAT") {
        const chatHistory = (history || []).map((m: { role: string; content: string }) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

        let userContent = message;
        let systemPrompt = GENERAL_CHAT_PROMPT;
        if (currentLocation) {
          const weatherContext = await fetchWeatherContext(currentLocation.lat, currentLocation.lon, currentLocation.displayName);
          userContent = `${message}\n\n--- WETTERDATEN für ${currentLocation.displayName} (${currentLocation.lat.toFixed(2)}°N, ${currentLocation.lon.toFixed(2)}°E) ---\n${weatherContext}`;
          systemPrompt = GENERAL_CHAT_PROMPT + `\n\nWICHTIG: Es ist ein Ort aktiv (${currentLocation.displayName}). Wenn die Frage sich auf diesen Ort bezieht, beantworte sie mit den vorhandenen Wetterdaten. Antworte kurz und präzise.`;
        }

        const msgs: OpenAI.ChatCompletionMessageParam[] = [
          { role: "system", content: systemPrompt },
          ...chatHistory,
          { role: "user", content: userContent },
        ];

        const stream = await openai.chat.completions.create({
          model: "gpt-4.1",
          messages: msgs,
          max_completion_tokens: 2048,
          temperature: 0.3,
          stream: true,
        });

        for await (const chunk of stream) {
          const text = chunk.choices?.[0]?.delta?.content;
          if (text) {
            sendSSE({ content: text });
          }
        }

        sendSSE({ done: true });
        res.end();
        return;
      }

      if (classification.type === "UNCLEAR") {
        sendSSE({ content: "Welchen Ort meinst du? Nenne mir einen konkreten Ort, Hafen oder See — z.B. \"Punat\", \"Gardasee\" oder \"Split\"." });
        sendSSE({ done: true });
        res.end();
        return;
      }

      if (!classification.location) {
        sendSSE({ content: "Welchen Ort meinst du? Nenne mir einen konkreten Ort, Hafen oder See — z.B. \"Punat\", \"Gardasee\" oder \"Split\"." });
        sendSSE({ done: true });
        res.end();
        return;
      }

      const geocoded = await geocodeLocation(classification.location);
      if (!geocoded) {
        sendSSE({ content: `Den Ort \"${classification.location}\" konnte ich leider nicht finden. Bitte versuche einen anderen Namen oder schreibe den Ort ausführlicher, z.B. \"Split in Kroatien\" oder \"Elba, Italien\".` });
        sendSSE({ done: true });
        res.end();
        return;
      }

      sendSSE({ location: geocoded });

      const countryCode = geocoded.countryCode || "";
      const service = getRegionalService(countryCode);
      const locationShort = geocoded.displayName.split(",")[0].trim();
      const knmiTime = getKnmiChartTime();

      const windUrl = `https://www.windy.com/-wind-${geocoded.regionalModel}?${geocoded.regionalModel},${geocoded.lat.toFixed(3)},${geocoded.lon.toFixed(3)},${Math.min(geocoded.regionalModelZoom + 2, 14)}`;
      const cloudsUrl = `https://www.windy.com/-Wolken-clouds?${geocoded.regionalModel},clouds,${geocoded.lat.toFixed(3)},${geocoded.lon.toFixed(3)},${geocoded.regionalModelZoom}`;
      const meteogramUrl = `https://www.windy.com/${geocoded.lat.toFixed(3)}/${geocoded.lon.toFixed(3)}`;

      const sectionConfigs = [
        {
          id: "luftmassen", title: "1. Luftmassen",
          mapType: "windy", mapConfig: { lat: 51, lon: 0, overlay: "temp", product: "ecmwf", level: "850h", zoom: 4 },
          sourceLabel: "Temperatur 1.500m ECMWF windy.com", sourceUrl: "https://www.windy.com/-temp-850h?ecmwf,51.000,0.000,4",
        },
        {
          id: "fronten", title: "2. Fronten",
          mapType: "knmi", mapConfig: {},
          sourceLabel: `KNMI ${knmiTime} UTC`, sourceUrl: "https://www.knmi.nl/nederland-nu/weer/waarschuwingen-en-verwachtingen/weerkaarten",
        },
        {
          id: "wind", title: "3. Wind & Welle",
          mapType: "windy", mapConfig: { lat: geocoded.lat, lon: geocoded.lon, overlay: "wind", product: geocoded.regionalModel, level: "surface", zoom: geocoded.regionalModelZoom },
          sourceLabel: `Wind ${locationShort} ${geocoded.regionalModelLabel} windy.com`, sourceUrl: windUrl,
          regionalServiceLabel: service?.label || null, regionalServiceUrl: service?.forecastUrl || null,
        },
        {
          id: "wolken", title: "4. Wolken & Regen",
          mapType: "windy", mapConfig: { lat: geocoded.lat, lon: geocoded.lon, overlay: "clouds", product: geocoded.regionalModel, level: "surface", zoom: geocoded.regionalModelZoom },
          sourceLabel: `Wolken ${locationShort} ${geocoded.regionalModelLabel} windy.com`, sourceUrl: cloudsUrl,
        },
        {
          id: "prognose", title: "5. Prognose",
          mapType: "windy", mapConfig: { lat: geocoded.lat, lon: geocoded.lon, overlay: "wind", product: geocoded.regionalModel, level: "surface", zoom: geocoded.regionalModelZoom, forecast: true },
          sourceLabel: `Meteogram ${locationShort} ${geocoded.regionalModelLabel} windy.com`, sourceUrl: meteogramUrl,
        },
        {
          id: "warnung", title: "6. Wetterwarnung",
          mapType: "none", mapConfig: {},
          sourceLabel: service?.warningLabel || null, sourceUrl: service?.warningUrl || null,
        },
      ];

      const [weatherContext, meteonewsText, regionalReport, warningsText] = await Promise.all([
        fetchWeatherContext(geocoded.lat, geocoded.lon, geocoded.displayName),
        fetchMeteonews(),
        countryCode ? fetchRegionalWeatherReport(countryCode, geocoded.lat, geocoded.lon) : Promise.resolve(""),
        countryCode ? fetchRegionalWarnings(countryCode) : Promise.resolve(""),
      ]);

      const dataContext = `
ORT: ${geocoded.displayName} (${geocoded.lat.toFixed(4)}°N, ${geocoded.lon.toFixed(4)}°E)
Ortskurzname: ${locationShort}
Regionales Windmodell: ${geocoded.regionalModelLabel}
Regionaler Wetterdienst: ${service?.label || "nicht verfügbar"}

--- METEONEWS ALLGEMEINE LAGE EUROPA (Quelle: meteonews.at) ---
${meteonewsText || "(nicht verfügbar)"}

--- REGIONALER WETTERBERICHT (Quelle: ${service?.label || "nicht verfügbar"}) ---
${regionalReport || "(nicht verfügbar - verwende nur Open-Meteo Daten)"}

--- REGIONALE WARNUNGEN (Quelle: ${service?.warningLabel || "nicht verfügbar"}) ---
${warningsText || "(keine Warnungsdaten verfügbar)"}

--- OPEN-METEO WETTERDATEN ---
${weatherContext}
`;

      const chatHistory = (history || []).map((m: { role: string; content: string }) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

      const msgs: OpenAI.ChatCompletionMessageParam[] = [
        { role: "system", content: ANALYSIS_SYSTEM_PROMPT },
        ...chatHistory,
        { role: "user", content: `Erstelle Segelwetteranalyse für ${locationShort}.\n\n${dataContext}` },
      ];

      const stream = await openai.chat.completions.create({
        model: "gpt-4.1",
        messages: msgs,
        max_completion_tokens: 4096,
        temperature: 0.3,
        stream: true,
      });

      let accumulated = "";
      const emittedSections = new Set<number>();

      for await (const chunk of stream) {
        const text = chunk.choices?.[0]?.delta?.content;
        if (text) {
          accumulated += text;

          for (let n = 1; n <= 6; n++) {
            if (!emittedSections.has(n)) {
              const pattern = new RegExp(`##\\s*${n}[.):\\s]`);
              if (pattern.test(accumulated)) {
                emittedSections.add(n);
                sendSSE({ section: sectionConfigs[n - 1] });
              }
            }
          }

          sendSSE({ content: text });
        }
      }

      sendSSE({ done: true });
      res.end();
    } catch (error) {
      console.error("Chat error:", error);
      if (res.headersSent) {
        sendSSE({ error: "Fehler bei der Wetteranalyse" });
        res.end();
      } else {
        res.status(500).json({ error: "Failed to process chat message" });
      }
    }
  });

  return httpServer;
}
