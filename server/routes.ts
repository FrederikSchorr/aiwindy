import type { Express } from "express";
import { createServer, type Server } from "http";
import { geocodeRequestSchema } from "@shared/schema";
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
  // Fetches only the European overview bulletin from meteonews.at
  try {
    const res = await fetch("https://meteonews.at/de/Allgemeine_Lage/K33/Europa", {
      headers: { "User-Agent": "WindyWeatherApp/1.0", "Accept": "text/html" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return "";
    const html = await res.text();

    // Target the bulletin-wrap div inside ModuleBulletinsGeneralSituation
    const bulletinMatch = html.match(/class="[^"]*ModuleBulletinsGeneralSituation[^"]*"[^>]*>[\s\S]*?<div[^>]*class="[^"]*bulletin-wrap[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i)
      || html.match(/<div[^>]*class="[^"]*bulletin-wrap[^"]*"[^>]*>([\s\S]*?)<\/div>/i);

    if (bulletinMatch) {
      return stripHtml(bulletinMatch[1]).slice(0, 1500).trim();
    }

    // Fallback: find "Europawetter" section in plain text
    const plainText = stripHtml(html);
    const startIdx = plainText.indexOf("Europawetter");
    if (startIdx >= 0) return plainText.slice(startIdx, startIdx + 1500).trim();

    return plainText.slice(0, 1500);
  } catch (e) {
    console.error("Meteonews fetch failed:", e);
    return "";
  }
}

const REGIONAL_FORECAST_SERVICES: Record<string, { forecastUrl: string; label: string; warningUrl: string; warningLabel: string }> = {
  HR: {
    forecastUrl: "https://meteo.hr/prognoze_e.php?section=prognoze_specp&param=jadran",
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
    forecastUrl: "http://oldportal.emy.gr/emy/en/navigation/naftilia",
    label: "EMY (HNMS) Griechenland",
    warningUrl: "http://oldportal.emy.gr/emy/en/warning/gale_html",
    warningLabel: "EMY Sturmwarnungen",
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

CHAT — wenn der Benutzer eine allgemeine Frage zu Wetter, Meteorologie, Wolken, Segeln stellt, die KEINEN konkreten Wetterbericht erfordert${hasActiveLocation ? ", ODER eine Rückfrage zu einer laufenden Analyse stellt" : ""}. Beispiele:
- "Was sind Cumulonimbus-Wolken?" → CHAT
- "Wie entsteht die Bora?" → CHAT
- "Erkläre die Douglas-Skala" → CHAT
${hasActiveLocation ? '- "Wird der Wind stärker?" → CHAT (Rückfrage bei aktivem Ort)\n- "Wie sieht es morgen aus?" → CHAT (Rückfrage bei aktivem Ort)' : '- "Wird der Wind stärker?" → UNCLEAR (kein aktiver Ort)\n- "Wie sieht es morgen aus?" → UNCLEAR (kein aktiver Ort)'}

UNCLEAR — wenn nicht klar ist ob ein Ort gemeint ist, die Nachricht mehrdeutig ist${!hasActiveLocation ? ", oder eine ortsbezogene Frage ohne konkreten Ort gestellt wird" : ""}. Beispiele:
- "Wetter" → UNCLEAR
- "Wie ist es dort?" → UNCLEAR${!hasActiveLocation ? '\n- "Wird der Wind stärker?" → UNCLEAR (kein aktiver Ort)' : ""}
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
  countryCode?: string; cityName?: string;
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
    let cityName: string | undefined;
    try {
      const reverseRes = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10&addressdetails=1`,
        { headers: { "User-Agent": "WindyWeatherApp/1.0" } }
      );
      if (reverseRes.ok) {
        const reverseData = await reverseRes.json() as { address?: { country_code?: string; city?: string; town?: string; village?: string; suburb?: string; municipality?: string; county?: string } };
        countryCode = reverseData.address?.country_code?.toUpperCase();
        cityName = reverseData.address?.city || reverseData.address?.town || reverseData.address?.village || reverseData.address?.municipality || reverseData.address?.suburb || reverseData.address?.county;
      }
    } catch {}

    return {
      lat, lon,
      displayName: result.display_name,
      regionalModel: regional.model,
      regionalModelLabel: regional.label,
      regionalModelZoom: regional.zoom,
      countryCode,
      cityName,
    };
  } catch {
    return null;
  }
}

function getKnmiChartTime(): { hour: string; label: string } {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const hour = utcHour >= 12 ? "12" : "00";
  const day = String(now.getUTCDate()).padStart(2, "0");
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return { hour, label: `${day}.${month}. ${hour}:00 UTC` };
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

QUELLEN-REGEL: Schreibe Quellen IMMER als klickbaren Markdown-Link: [(Quelle: Name)](URL)
Die URLs der verfügbaren Quellen stehen im Datenkontext unter "QUELLENURLS".

## 1. Druck & Luftmassen
- Genau ZWEI Bullet-Points, basierend ausschließlich auf dem METEONEWS-TEXT:
  - Bullet 1: Dominierende Druckgebilde über Europa (Hochs, Tiefs, deren Lage und Einfluss)
  - Bullet 2: Luftmassen und deren Grenzen über Europa (Kaltluft, Warmluft, Luftmassengrenze)
- Jeder Bullet: 1 prägnanter Satz
- Gib die Quelle am Ende des zweiten Bullets an: [(Quelle: meteonews.at)](https://meteonews.at/de/Allgemeine_Lage/K33/Europa)
- Kein weiterer Text, keine weiteren Bullets in dieser Sektion

## 2. Fronten
- Basierend auf dem KNMI-Frontenbild, der obigen meteonews-Beschreibung und dem Zielort
- Genau 1-2 Bullets: Fasse die regional relevanten Fronten für den Zielort zusammen
- Welche Fronten beeinflussen die Region? Zugweg in Richtung Revier?
- Kalt-/Warmfronten, Okklusionen, Luftmassengrenzen — was ist relevant?
- Quelle als Link: [(Quelle: meteonews.at)](https://meteonews.at/de/Allgemeine_Lage/K33/Europa)

## 3. Wind & Welle
Schreibe genau diese Bullets in dieser Reihenfolge:
1. Erster Bullet exakt in diesem Format (Markdown-Link!): "Regionales Windmodell: ALADIN, Regionaler Wetterbericht: [DHMZ Kroatien](https://meteo.hr/...)" — ersetze Modell und Dienst aus KONTEXT und QUELLENURLS. Der Dienstname muss ein klickbarer Markdown-Link sein: [Dienstname](URL)
2. Je aktives oder nahendes Windsystem 1 eigener Bullet: Name des Windsystems, warum aktiv/nahend, Windstärke & Böen in Knoten (kt) — KEIN Bft. NUR Werte aus dem REGIONALEN WETTERBERICHT verwenden, KEINE eigenen Schätzungen. Windsysteme: Bora, Maestral, Meltemi, Mistral, Jugo/Scirocco, Tramontana, thermische Winde etc.
3. Letzter Bullet: "Seezustand: [Zustand auf Deutsch]" — exakt aus dem regionalen Wetterbericht übernehmen und korrekt ins Deutsche übersetzen. Douglas-Skala: 1=ruhig, 2=leicht bewegt, 3=leicht (slight), 4=mäßig (moderate), 5=bewegt/rau (rough), 6=sehr bewegt. Beispiele: "slight and moderate" → "leicht bis mäßig", "The sea 3-4" → "leicht bis mäßig (Douglas 3-4)"

## 4. Wolken & Regen
- Basierend auf dem regionalen Wetterbericht und (falls möglich) der Windy-Wolkenkarte
- Genau 1-2 Bullets: Beschreibung Bewölkung, Regen, Gewitterrisiko in den nächsten 12h
- Die Quelle direkt an den letzten Bullet anhängen (KEIN separater Bullet): "...Text. [(Quelle: Dienstname)](URL)" — URL aus QUELLENURLS

## 5. Prognose
- KEIN Fließtext, KEINE Bullets — nur die Überschrift, die Karte spricht für sich

## 6. Wetterwarnung
- Beginne mit dem Dienstnamen als Label, Beispiel: "[DHMZ Kroatien](WARNINGURL): Gelegentliche Böen..."
- Der Dienstname ist ein klickbarer Markdown-Link zur Warnseite: [WARNDIENSTNAME](WARNINGURL) — URL aus QUELLENURLS
- Falls Warnungen aktiv: "[Dienstname](URL): [Warntext mit konkreten Werten und Zeitfenstern]"
- Falls keine Warnungen: "[Dienstname](URL): Keine aktuellen Wetterwarnungen"

STIL-REGELN:
- Deutsch, sachlich-professionell, KEINE Begrüßung, KEINE Floskeln
- Bullet-Point-Stil, Fließtext minimieren
- Jeder Abschnitt: maximal 1-3 Bullets, KURZ und PRÄGNANT
- Emojis sparsam: 💨 Wind, 🌊 Welle, ☀️ Sonne, ☁️ Wolken, 🌧️ Regen, ⚠️ Warnung, ⛈️ Gewitter
- Konkrete Zahlen aus den Daten, KEINE halluzinierten Werte
- Windangaben: kt / Bft, Druckangaben: hPa

`;


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


  const upload = multer({
    dest: "/tmp/uploads",
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "video/mp4", "video/quicktime", "video/webm"];
      cb(null, allowed.includes(file.mimetype));
    },
  });

  const PHOTO_ANALYSIS_PROMPT = `Du bist ein Meteorologe und Wolkenexperte. Analysiere ausschließlich das vorliegende Bild — ohne externe Wetterdaten oder Kontext.

AUFGABE:
Prüfe ob das Bild meteorologisch relevant ist (Himmel, Wolken, Wasser, Wetterstimmung).

Falls JA — analysiere in genau dieser Struktur:

## ☁️ Wolkentyp
(ein Bullet pro identifizierter Wolkenart: Name fett, Höhe, dann 1–2 Sätze Beschreibung was diese Wolke charakterisiert und wie man sie erkennt)
- Beispiel: **Cumulus mediocris** — ~1.500–2.500 m (tief-mittel): Kompakte, blumenkohlförmige Quellwolke mit flacher Basis und klar abgegrenztem Rand. Entsteht durch thermische Konvektion und gilt als Schönwetterwolke solange die Vertikalentwicklung begrenzt bleibt.
- Beispiel: **Cirrus fibratus** — ~7.000–10.000 m (hoch): Feine, faserige Schleierwolke aus Eiskristallen, oft hakenförmig oder gekämmt. Trübt kaum die Sonne und kündigt häufig eine nahende Warmfront an.

## 🌫️ Bedeckungsgrad
(Okta-Angabe + kurze Beschreibung)

## 🌤️ Typische Wetterentwicklung
(Was ist meteorologisch zu erwarten? Kurz und klar.)

Falls NEIN: Sag kurz, dass kein meteorologisch relevanter Inhalt zu sehen ist, und bitte um ein Foto vom Himmel oder Horizont.

STIL: Deutsch, sachlich, ohne Wiederholungen. Keine Einleitung.`;

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
            exifTime = new Date(ts * 1000).toLocaleString("de-DE", {
              timeZone: "Europe/Berlin",
              year: "numeric", month: "2-digit", day: "2-digit",
              hour: "2-digit", minute: "2-digit",
            });
          }
        } catch (e) {
          console.log("EXIF parsing failed (non-critical):", e);
        }
      }

      let metadataInfo = "";
      let exifLocationName: string | null = null;
      let exifCountryCode: string | null = null;
      if (exifLocation) {
        sendSSE({ status: `📍 GPS gefunden: ${exifLocation.lat.toFixed(4)}°N, ${exifLocation.lon.toFixed(4)}°E` });
        metadataInfo += `\nGPS-Koordinaten aus EXIF: ${exifLocation.lat.toFixed(4)}°N, ${exifLocation.lon.toFixed(4)}°E`;

        const geocoded = await geocodeLocation(`${exifLocation.lat},${exifLocation.lon}`);
        if (geocoded) {
          sendSSE({ location: geocoded });
          exifLocationName = geocoded.cityName || geocoded.displayName.split(",")[0].trim();
          exifCountryCode = geocoded.countryCode || null;
          metadataInfo += `\nOrt: ${geocoded.displayName}`;
        }
      }

      if (exifTime) {
        metadataInfo += `\nAufnahmezeitpunkt: ${exifTime}`;
      }

      if (!isVideo) {
        sendSSE({ exifMeta: { time: exifTime, locationName: exifLocationName, countryCode: exifCountryCode } });
      }

      if (!exifLocation && !exifTime && !isVideo) {
        sendSSE({ status: "ℹ️ Keine GPS/Zeit-Metadaten im Bild gefunden" });
      }

      const systemPrompt = PHOTO_ANALYSIS_PROMPT;

      if (isVideo) {
        sendSSE({ status: "🔍 Analysiere Video mit Gemini KI..." });

        const base64Video = fileBuffer.toString("base64");
        const videoPrompt = systemPrompt.replace("Foto/Bild", "Video").replace("dieses Bild", "dieses Video") + "\n\nBesonders beachten bei Videos:\n- Wolkenbewegung und -entwicklung über die Zeit\n- Wellenmuster und Windstärke auf dem Wasser\n- Veränderungen in Lichtverhältnissen und Sichtweite\n- Dynamische Wetterphänomene (ziehende Fronten, aufbauende Konvektion)";

        const geminiModel = gemini.getGenerativeModel(
          { model: "gemini-2.5-flash" },
          { baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL }
        );

        const result = await geminiModel.generateContent({
          contents: [{
            role: "user",
            parts: [
              { inlineData: { mimeType: req.file!.mimetype, data: base64Video } },
              { text: "Analysiere dieses Video meteorologisch. Achte besonders auf Bewegungen und zeitliche Entwicklungen." },
            ],
          }],
          systemInstruction: { role: "user", parts: [{ text: videoPrompt }] },
        });
        const vidText = result.response.text();
        if (vidText) sendSSE({ content: vidText });
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

        const imgResponse = await openai.chat.completions.create({
          model: "gpt-4.1",
          messages: imageMessages,
          max_completion_tokens: 4096,
          temperature: 0.3,
          stream: false,
        });
        const imgText = imgResponse.choices[0]?.message?.content || "";
        if (imgText) sendSSE({ content: imgText });
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
          systemPrompt = GENERAL_CHAT_PROMPT + `\n\nWICHTIG: Es ist ein Ort aktiv (${currentLocation.displayName}, ${currentLocation.lat.toFixed(2)}°N, ${currentLocation.lon.toFixed(2)}°E). Beantworte allgemeine Segelfragen mit Bezug auf diesen Ort. Antworte kurz und präzise.`;
        }

        const msgs: OpenAI.ChatCompletionMessageParam[] = [
          { role: "system", content: systemPrompt },
          ...chatHistory,
          { role: "user", content: userContent },
        ];

        const chatResponse = await openai.chat.completions.create({
          model: "gpt-4.1",
          messages: msgs,
          max_completion_tokens: 2048,
          temperature: 0.3,
          stream: false,
        });
        const chatText = chatResponse.choices[0]?.message?.content || "";
        if (chatText) sendSSE({ content: chatText });

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
      const cloudsUrl = `https://www.windy.com/${geocoded.lat.toFixed(3)}/${geocoded.lon.toFixed(3)}/${geocoded.regionalModel}/meteogram?${geocoded.regionalModel},clouds,${geocoded.lat.toFixed(3)},${geocoded.lon.toFixed(3)},${geocoded.regionalModelZoom}`;
      const meteogramUrl = `https://www.windy.com/${geocoded.lat.toFixed(3)}/${geocoded.lon.toFixed(3)}/${geocoded.regionalModel}/meteogram`;
      const basisdatenUrl = `https://www.windy.com/${geocoded.lat.toFixed(3)}/${geocoded.lon.toFixed(3)}/${geocoded.regionalModel}`;

      const sectionConfigs = [
        {
          id: "druck-luftmassen", title: "1. Druck & Luftmassen",
          mapType: "windy", mapConfig: { lat: 48, lon: 5, overlay: "temp", product: "ecmwf", level: "850h", zoom: 3 },
          sourceLabel: "Windy Temperatur 1.500m ECMWF", sourceUrl: "https://www.windy.com/-Temperatur-temp?ecmwf,temp,850h,48.000,5.000,3",
        },
        {
          id: "fronten", title: "2. Fronten",
          mapType: "knmi", mapConfig: {},
          sourceLabel: `KNMI ${knmiTime.label}`, sourceUrl: "https://www.knmi.nl/nederland-nu/weer/waarschuwingen-en-verwachtingen/weerkaarten",
        },
        {
          id: "wind", title: "3. Wind & Welle",
          mapType: "windy", mapConfig: { lat: geocoded.lat, lon: geocoded.lon, overlay: "wind", product: geocoded.regionalModel, level: "surface", zoom: Math.max(geocoded.regionalModelZoom - 2, 4) },
          sourceLabel: `Wind ${locationShort} ${geocoded.regionalModelLabel} windy.com`, sourceUrl: windUrl,
          regionalServiceLabel: service?.label || null, regionalServiceUrl: service?.forecastUrl || null,
        },
        {
          id: "wolken", title: "4. Wolken & Regen",
          mapType: "windy", mapConfig: { lat: geocoded.lat, lon: geocoded.lon, overlay: "clouds", product: geocoded.regionalModel, level: "surface", zoom: Math.max(geocoded.regionalModelZoom - 3, 4) },
          sourceLabel: `Meteogram ${locationShort} ${geocoded.regionalModelLabel} windy.com`, sourceUrl: cloudsUrl,
        },
        {
          id: "prognose", title: "5. Prognose",
          mapType: "windy", mapConfig: { lat: geocoded.lat, lon: geocoded.lon, overlay: "wind", product: geocoded.regionalModel, level: "surface", zoom: geocoded.regionalModelZoom, forecast: true },
          sourceLabel: `Prognose ${locationShort} ${geocoded.regionalModelLabel} windy.com`, sourceUrl: basisdatenUrl,
        },
        {
          id: "warnung", title: "6. Wetterwarnung",
          mapType: "none", mapConfig: {},
          sourceLabel: null, sourceUrl: null,
        },
      ];

      const [meteonewsText, regionalReport, warningsText] = await Promise.all([
        fetchMeteonews(),
        countryCode ? fetchRegionalWeatherReport(countryCode, geocoded.lat, geocoded.lon) : Promise.resolve(""),
        countryCode ? fetchRegionalWarnings(countryCode) : Promise.resolve(""),
      ]);

      const dataContext = `
ORT: ${geocoded.displayName} (${geocoded.lat.toFixed(4)}°N, ${geocoded.lon.toFixed(4)}°E)
Ortskurzname: ${locationShort}
Regionales Windmodell: ${geocoded.regionalModelLabel}
Regionaler Wetterdienst: ${service?.label || "nicht verfügbar"}

--- QUELLENURLS (für Markdown-Links verwenden) ---
meteonews.at Allgemeine Lage: https://meteonews.at/de/Allgemeine_Lage/K33/Europa
Regionaler Wetterdienst (${service?.label || "nicht verfügbar"}): ${service?.forecastUrl || "nicht verfügbar"}
Regionaler Warndienst (${service?.warningLabel || "nicht verfügbar"}): ${service?.warningUrl || "nicht verfügbar"}

--- METEONEWS ALLGEMEINE LAGE EUROPA (Quelle: meteonews.at) ---
${meteonewsText || "(nicht verfügbar)"}

--- REGIONALER WETTERBERICHT (Quelle: ${service?.label || "nicht verfügbar"}) ---
${regionalReport || "(nicht verfügbar)"}

--- REGIONALE WARNUNGEN (Quelle: ${service?.warningLabel || "nicht verfügbar"}) ---
${warningsText || "(keine Warnungsdaten verfügbar)"}
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

      sendSSE({ analysisStart: { sections: sectionConfigs } });

      const stream = await openai.chat.completions.create({
        model: "gpt-4.1",
        messages: msgs,
        max_completion_tokens: 4096,
        temperature: 0.3,
        stream: true,
      });

      let anaBuf = "";
      let anaTimer: ReturnType<typeof setTimeout> | null = null;
      const flushAna = () => { if (anaBuf) { sendSSE({ content: anaBuf }); anaBuf = ""; } anaTimer = null; };
      for await (const chunk of stream) {
        const text = chunk.choices?.[0]?.delta?.content;
        if (text) { anaBuf += text; if (!anaTimer) anaTimer = setTimeout(flushAna, 30); }
      }
      if (anaTimer) clearTimeout(anaTimer);
      flushAna();

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
