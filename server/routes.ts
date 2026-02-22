import type { Express } from "express";
import { createServer, type Server } from "http";
import { geocodeRequestSchema } from "@shared/schema";
import type { ForecastHour } from "@shared/schema";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

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

const METEOROLOGIST_SYSTEM_PROMPT = `Du bist ein Meteorologe und Segelwetter-Experte. Sachlich, präzise, Bullet-Point-Stil. Keine Begrüßung, keine Floskeln, kein "Moin Crew", direkt zur Sache.

STRUKTUR (immer diese 4 Kapitel, nummeriert):

## 1. Großwetterlage
Synoptische Lage über Europa in Stichpunkten:
- Position und Kerndruck der Hochs/Tiefs (z.B. "Hoch ~1027 hPa über Balkan")
- Blockierende Wirkung, Zugbahnen
- Kaltluft-/Warmluft-Advektionen mit Bezug auf 850hPa-Karte ("850hPa-Karte: markante Kaltluft-Zunge aus NE über Baltikum, -8°C auf 1500m")
- Entwicklungstendenz 2-3 Tage

## 2. Fronten
Frontensituation mit Bezug auf KNMI-Frontenkarte:
- Lage der Frontalzone
- Kalt-/Warmfronten in der Region
- Luftmassengrenze
- Okklusionen, Wellenstörungen

## 3. Lokale Windsysteme [ORTSNAME]
SCHWERPUNKT dieses Kapitels: Regionale und lokale Windphänomene! Das ist der wichtigste Teil.
- **Relevante Windsysteme:** Bora, Jugo/Scirocco, Maestral, Mistral, Meltemi, Tramontana, Föhn, thermische See-/Landwind-Zirkulation, Düseneffekte, Kapeffekte — was davon ist aktuell relevant und warum?
- **Mechanismus kurz erklären:** Warum entsteht der Wind hier? (z.B. "Druckgradient NE-SW über Dinariden → Bora-Lage", "Thermische Konvektion ab Mittag → Maestral")
- **Aktueller Wind:** Richtung, Stärke (kt / Bft), Böen — nur als kurze Zeile
- **Seegang:** Wellenhöhe, Periode — nur als kurze Zeile, falls Daten vorhanden
- **Bezug auf lokale Windkarte** ("Im ALADIN-Modell erkennbar: ...")
- Aktuelles Wetter (Temperatur, Bewölkung) maximal 1-2 Zeilen, nicht mehr

## 4. Wetterwarnungen
- Aktive Warnungen auflisten (Sturmwarnung, Bora-Warnung, Gewitterwarnung etc.)
- Falls keine Warnungen: nur ein kurzer Satz "Keine aktiven Warnungen."
- Bei Warnungen: konkrete Werte (erwartete Böen in kt, Wellenhöhe) und Zeitfenster

STIL-REGELN:
- Deutsch, sachlich-professionell, KEINE informellen Anreden oder Floskeln
- Bullet-Point-Stil bevorzugen, Fließtext minimieren
- AKTIVER KARTENBEZUG: Verweise gezielt auf die rechts angezeigten Karten! Formulierungen wie:
  - "→ In der 850hPa-Karte gut erkennbar: violette Kaltluft-Zunge aus NE..."
  - "→ Auf der KNMI-Frontenkarte: Kaltfront erstreckt sich von..."
  - "→ Im lokalen Windmodell (ICON-D2) sichtbar: Düseneffekt zwischen..."
  - "→ In der Windy-Vorhersage zeigt sich ab morgen..."
  Diese Verweise helfen dem Benutzer, die Analyse mit den Karten abzugleichen.
- Konkrete Zahlen aus den Daten, KEINE halluzinierten Werte
- Windangaben: kt / Bft (z.B. "12 kt / 4 Bft")
- Druckangaben: hPa

ABSCHLUSS (nur bei vollständiger Erstanalyse):
- Am Ende der Analyse IMMER eine kurze Aufforderung an den Benutzer, z.B.:
  "---\n**Rückfragen?** Gerne zu Details, Routenplanung oder Zeitfenstern nachfragen."

RÜCKFRAGEN / FOLLOW-UP:
- Wenn der Benutzer eine Rückfrage stellt: NUR auf die konkrete Frage antworten!
- NICHT den kompletten Wetterbericht wiederholen
- Kurz, präzise, wie ein normales Chat-Gespräch
- Kartenbezug nur wo relevant für die Frage
- Zahlen und Daten aus dem Kontext verwenden`;

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

async function extractLocation(message: string): Promise<string | null> {
  try {
    const result = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: `Extrahiere den geographischen Ortsnamen aus der Benutzernachricht. 
Wenn ein konkreter Ort, Hafen, See, Insel, Küste oder Region genannt wird, gib NUR den Ortsnamen zurück (z.B. "Punat, Kroatien" oder "Gardasee" oder "Elba").
Wenn KEIN Ort genannt wird (z.B. reine Fragen wie "Wird der Wind stärker?" oder "Wann legt sich die Bora?"), antworte mit genau: NONE
Antworte mit NICHTS anderem als dem Ortsnamen oder NONE.`,
        },
        { role: "user", content: message },
      ],
      max_completion_tokens: 64,
      temperature: 0,
    });
    const text = result.choices[0]?.message?.content?.trim() || "";
    if (!text || text === "NONE" || text.length > 100) return null;
    return text;
  } catch (e: any) {
    console.error("Location extraction failed:", e?.message || e);
    return null;
  }
}

async function geocodeLocation(locationName: string): Promise<{
  lat: number; lon: number; displayName: string;
  regionalModel: string; regionalModelLabel: string; regionalModelZoom: number;
  countryCode?: string; warningUrl?: string; warningLabel?: string;
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

    const warningInfo = countryCode ? getWarningInfo(countryCode) : undefined;

    return {
      lat, lon,
      displayName: result.display_name,
      regionalModel: regional.model,
      regionalModelLabel: regional.label,
      regionalModelZoom: regional.zoom,
      countryCode,
      warningUrl: warningInfo?.url,
      warningLabel: warningInfo?.label,
    };
  } catch {
    return null;
  }
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

  app.post("/api/chat", async (req, res) => {
    const { message, history, currentLocation } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message required" });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    try {
      const locationResult = await extractLocation(message);

      let location = currentLocation as { lat: number; lon: number; displayName: string; regionalModel: string; regionalModelLabel: string; regionalModelZoom: number; countryCode?: string; warningUrl?: string; warningLabel?: string } | null;
      let isNewLocation = false;

      if (locationResult) {
        const geocoded = await geocodeLocation(locationResult);
        if (geocoded) {
          location = geocoded;
          isNewLocation = true;
          res.write(`data: ${JSON.stringify({ location: geocoded })}\n\n`);
        }
      }

      if (!location) {
        res.write(`data: ${JSON.stringify({ content: "Bitte nenne einen Ort, damit ich die Wetterlage analysieren kann. Zum Beispiel: \"Wie ist das Wetter in Punat?\" oder einfach \"Rovinj\"." })}\n\n`);
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
        return;
      }

      if (isNewLocation) {
        const locationShort = location.displayName.split(",")[0].trim();
        res.write(`data: ${JSON.stringify({ status: `Wetterbilder geladen. Lokales Modell: **${location.regionalModelLabel}**. Analysiere Wetterlage für ${locationShort}...` })}\n\n`);
      }

      const weatherContext = await fetchWeatherContext(location.lat, location.lon, location.displayName);
      const regional = getRegionalModelFallback(location.lat, location.lon);

      const mapContext = `
ANGEZEIGTE KARTEN (die der Benutzer rechts neben dem Chat sieht):
1. Temperatur 850hPa (ca. 1500m Höhe) - ECMWF Modell, Zoom auf Nordatlantik/Europa (zentriert 55°N, 10°W) — zeigt Luftmassen, Kaltluft-Zungen (blau/violett) und Warmluft-Vorstöße (gelb/orange/rot)
2. KNMI Fronten-Analysekarte — zeigt Druckgebilde (H/L mit hPa-Werten), Fronten (Warmfronten rot halb-kreise, Kaltfronten blau Dreiecke, Okklusionen violett), Isobaren
3. Lokales Windmodell: ${location.regionalModelLabel || regional.label} — hochauflösendes Regionalmodell, zeigt Windfelder (Stärke farbcodiert, Richtung mit Pfeilen) für den Bereich um ${location.displayName}
4. Windy Vorhersage — Zeitleiste mit Wind, Böen, Temperatur für die nächsten Tage

ORT: ${location.displayName} (${location.lat.toFixed(4)}°N, ${location.lon.toFixed(4)}°E)
Verwende "${location.displayName.split(",")[0].trim()}" als Ortsnamen in Kapitel 3.
`;

      const chatHistory = (history || []).map((m: { role: string; content: string }) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

      const isFollowUp = !isNewLocation;

      const systemPrompt = isFollowUp
        ? `${METEOROLOGIST_SYSTEM_PROMPT}\n\nWICHTIG: Dies ist eine Rückfrage des Benutzers im laufenden Gespräch. Antworte NUR auf die gestellte Frage. Wiederhole NICHT den kompletten Wetterbericht. Antworte kurz, präzise und im Chat-Stil.`
        : METEOROLOGIST_SYSTEM_PROMPT;

      const userContent = isFollowUp
        ? `${message}\n\n--- AKTUELLE WETTERDATEN (als Referenz) ---\n${weatherContext}\n\nORT: ${location.displayName} (${location.lat.toFixed(4)}°N, ${location.lon.toFixed(4)}°E)`
        : `Analysiere die aktuelle Wetterlage für ${location.displayName}. Der Benutzer schrieb: "${message}"\n\n--- AKTUELLE WETTERDATEN ---\n${weatherContext}\n\n${mapContext}`;

      const messages: OpenAI.ChatCompletionMessageParam[] = [
        { role: "system", content: systemPrompt },
        ...chatHistory,
        { role: "user", content: userContent },
      ];

      const stream = await openai.chat.completions.create({
        model: "gpt-4.1",
        messages,
        max_completion_tokens: isFollowUp ? 2048 : 8192,
        temperature: 0.3,
        stream: true,
      });

      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content || "";
        if (text) {
          res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
        }
      }

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (error) {
      console.error("Chat error:", error);
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ error: "Fehler bei der Wetteranalyse" })}\n\n`);
        res.end();
      } else {
        res.status(500).json({ error: "Failed to process chat message" });
      }
    }
  });

  return httpServer;
}
