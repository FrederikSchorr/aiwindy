import type { Express } from "express";
import { createServer, type Server } from "http";
import { geocodeRequestSchema } from "@shared/schema";
import OpenAI from "openai";
import multer from "multer";
import exifParser from "exif-parser";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { GoogleGenAI } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";

const execFileAsync = promisify(execFile);

const DEBUG_LOG_PATH = path.join(process.cwd(), "debug.log");
if (process.env.DEBUG === "1") {
  try {
    fs.writeFileSync(DEBUG_LOG_PATH, `── Debug Log gestartet: ${new Date().toLocaleString("de-DE", { timeZone: "Europe/Berlin" })} ──\n\n`);
  } catch {}
}

function debugLog(summary: string, fullDetail?: string): void {
  if (process.env.DEBUG !== "1") return;
  console.log(`[DEBUG] ${summary}`);
  const timestamp = new Date().toLocaleString("de-DE", {
    timeZone: "Europe/Berlin",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const fileContent = fullDetail
    ? `[${timestamp}] ${summary}\n${fullDetail}\n`
    : `[${timestamp}] ${summary}\n`;
  try {
    fs.appendFileSync(DEBUG_LOG_PATH, fileContent);
  } catch {}
}

function debugLogRequestSeparator(label: string): void {
  if (process.env.DEBUG !== "1") return;
  const timestamp = new Date().toLocaleString("de-DE", {
    timeZone: "Europe/Berlin",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const separator = `\n${"=".repeat(80)}\n  REQUEST: ${label}\n  Zeit: ${timestamp}\n${"=".repeat(80)}\n`;
  console.log(`[DEBUG] ── New Request: ${label}`);
  try {
    fs.appendFileSync(DEBUG_LOG_PATH, separator);
  } catch {}
}

function formatLLMMessages(messages: unknown[]): string {
  const lines: string[] = [];
  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    const m = msg as Record<string, unknown>;
    const role = String(m.role || "unknown").toUpperCase();
    lines.push(`─── ${role} ───`);
    if (typeof m.content === "string") {
      lines.push(m.content);
    } else if (Array.isArray(m.content)) {
      for (const part of m.content) {
        if (!part || typeof part !== "object") continue;
        const p = part as Record<string, unknown>;
        if (p.type === "text" && typeof p.text === "string") {
          lines.push(p.text);
        } else if (p.type === "image_url") {
          const imgUrl = (p.image_url as Record<string, unknown>)?.url;
          if (typeof imgUrl === "string" && imgUrl.startsWith("data:")) {
            lines.push(`[BASE64_IMAGE ~${Math.round(imgUrl.length / 1024)}KB]`);
          } else {
            lines.push(`[IMAGE: ${imgUrl}]`);
          }
        } else if (p.text && typeof p.text === "string") {
          lines.push(p.text);
        } else if (p.inlineData) {
          const d = p.inlineData as Record<string, unknown>;
          const dataLen = typeof d.data === "string" ? d.data.length : 0;
          lines.push(`[INLINE_DATA ${d.mimeType || "unknown"} ~${Math.round(dataLen / 1024)}KB]`);
        }
      }
    }
    if (Array.isArray(m.parts)) {
      for (const part of m.parts) {
        if (!part || typeof part !== "object") continue;
        const p = part as Record<string, unknown>;
        if (typeof p.text === "string") {
          lines.push(p.text);
        } else if (p.inlineData) {
          const d = p.inlineData as Record<string, unknown>;
          const dataLen = typeof d.data === "string" ? d.data.length : 0;
          lines.push(`[INLINE_DATA ${d.mimeType || "unknown"} ~${Math.round(dataLen / 1024)}KB]`);
        }
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

function debugLogLLM(model: string, context: string, messages: unknown[], systemInstruction?: string): void {
  if (process.env.DEBUG !== "1") return;
  const msgCount = messages.length;
  const summary = `LLM [${model} / ${context}] ${msgCount} messages`;
  console.log(`[DEBUG] ${summary}`);
  let detail = `── LLM Call: ${model} / ${context} ──\n`;
  if (systemInstruction) {
    detail += `─── SYSTEM INSTRUCTION ───\n${systemInstruction}\n\n`;
  }
  detail += formatLLMMessages(messages);
  detail += `${"─".repeat(40)}\n`;
  const timestamp = new Date().toLocaleString("de-DE", {
    timeZone: "Europe/Berlin",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  try {
    fs.appendFileSync(DEBUG_LOG_PATH, `[${timestamp}] ${summary}\n${detail}\n`);
  } catch {}
}

function debugLogLLMResponse(model: string, context: string, response: string): void {
  if (process.env.DEBUG !== "1") return;
  const preview = response.length > 200 ? response.slice(0, 200) + "..." : response;
  console.log(`[DEBUG] LLM Response [${model} / ${context}] ${response.length} chars: ${preview.replace(/\n/g, " ")}`);
  const timestamp = new Date().toLocaleString("de-DE", {
    timeZone: "Europe/Berlin",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const detail = `── LLM Response: ${model} / ${context} (${response.length} chars) ──\n${response}\n${"─".repeat(40)}\n`;
  try {
    fs.appendFileSync(DEBUG_LOG_PATH, `[${timestamp}] ${detail}\n`);
  } catch {}
}

function debugLogScrape(source: string, url: string, status: number, text: string): void {
  if (process.env.DEBUG !== "1") return;
  const summary = `Scrape ${source} → ${status}, ${text.length} chars`;
  console.log(`[DEBUG] ${summary}`);
  const timestamp = new Date().toLocaleString("de-DE", {
    timeZone: "Europe/Berlin",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const detail = `── Scrape: ${source} ──\nURL: ${url}\nHTTP Status: ${status}\nText (${text.length} chars):\n${text}\n${"─".repeat(40)}\n`;
  try {
    fs.appendFileSync(DEBUG_LOG_PATH, `[${timestamp}] ${summary}\n${detail}\n`);
  } catch {}
}

async function extractVideoThumbnail(filePath: string): Promise<string | null> {
  try {
    const outputPath = `/tmp/vthumb-${Date.now()}.jpg`;
    await execFileAsync("ffmpeg", [
      "-i", filePath,
      "-ss", "00:00:01",
      "-vframes", "1",
      "-q:v", "3",
      "-y",
      outputPath,
    ]);
    const buf = fs.readFileSync(outputPath);
    fs.unlinkSync(outputPath);
    return buf.toString("base64");
  } catch {
    try {
      const outputPath = `/tmp/vthumb-${Date.now()}.jpg`;
      await execFileAsync("ffmpeg", [
        "-i", filePath,
        "-vframes", "1",
        "-q:v", "3",
        "-y",
        outputPath,
      ]);
      const buf = fs.readFileSync(outputPath);
      fs.unlinkSync(outputPath);
      return buf.toString("base64");
    } catch {
      return null;
    }
  }
}

function parseISO6709(raw: string): { lat: number; lon: number } | null {
  const m = raw.match(/^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/);
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lon = parseFloat(m[2]);
  if (isNaN(lat) || isNaN(lon)) return null;
  return { lat, lon };
}

async function extractVideoMetadata(filePath: string): Promise<{
  gps: { lat: number; lon: number } | null;
  time: string | null;
}> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "quiet",
      "-print_format", "json",
      "-show_format",
      filePath,
    ]);
    const data = JSON.parse(stdout);
    const tags: Record<string, string> = data?.format?.tags || {};

    let gps: { lat: number; lon: number } | null = null;
    const locationTag =
      tags["com.apple.quicktime.location.ISO6709"] ||
      tags["location"] ||
      tags["location-eng"] ||
      tags["GPS_location"];
    if (locationTag) {
      gps = parseISO6709(locationTag);
    }

    let time: string | null = null;
    const creationTag = tags["creation_time"] || tags["com.apple.quicktime.creationdate"] || tags["date"];
    if (creationTag) {
      const d = new Date(creationTag);
      if (!isNaN(d.getTime())) {
        time = d.toLocaleString("de-DE", {
          timeZone: "Europe/Berlin",
          year: "numeric", month: "2-digit", day: "2-digit",
          hour: "2-digit", minute: "2-digit",
        });
      }
    }

    return { gps, time };
  } catch {
    return { gps: null, time: null };
  }
}

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

const gemini = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY || "",
  httpOptions: {
    apiVersion: "",
    baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
  },
});

function getRegionalModelFallback(lat: number, lon: number): { model: string; label: string; zoom: number } {
  if (lat >= 42 && lat <= 51 && lon >= -5 && lon <= 8) {
    return { model: "aromeHd", label: "AROME-HD 1.3km", zoom: 8 };
  }
  if (lat >= 46 && lat <= 52 && lon >= 10 && lon <= 22) {
    return { model: "czeAladin", label: "ALADIN 2.3km", zoom: 7 };
  }
  if (lat >= 51 && lat <= 58 && lon >= -8 && lon <= 0) {
    return { model: "ukv", label: "UKV 2km", zoom: 7 };
  }
  if (lat >= 35 && lat <= 72 && lon >= -25 && lon <= 45) {
    return { model: "iconEu", label: "ICON-EU 7km", zoom: 6 };
  }
  return { model: "gfs", label: "GFS 22km", zoom: 5 };
}

const MODEL_SELECTION_PROMPT = `Du bist ein Meteorologie-Experte. Wähle das BESTE hochauflösende Windmodell für den gegebenen Ort auf Windy.com.

## Wichtige Regel
Der Ort muss mindestens ~300km vom Rand der Modell-Domain entfernt liegen, damit man auf der Windy-Karte das heranziehende Wetter aus allen Richtungen sieht. Liegt ein Ort zu nahe am Domain-Rand, nimm das nächstbeste Modell mit größerer Abdeckung.

## Verfügbare Modelle (Windy product parameter)

| Parameter | Modell | Auflösung | Aktualisierung |
|-----------|--------|-----------|----------------|
| aromeHd | AROME-HD (Météo-France) | 1.3 km | 4×/Tag, +48h |
| czeAladin | ALADIN (CHMI Tschechien) | 2.3 km | 4×/Tag, +72h |
| ukv | UKV (Met Office) | 2 km | 4×/Tag, +48h |
| iconEu | ICON-EU (DWD) | 7 km | 4×/Tag, +120h |
| gfs | GFS (NOAA) | 22 km | 4×/Tag, +240h |

## Modell-Domains (Kerngebiete mit ≥300km Puffer zum Domain-Rand)

### aromeHd — 1.3 km (höchste Priorität wo verfügbar)
Kerngebiet: Frankreich (komplett), Belgien, Luxemburg, Westdeutschland (Rheinland, Ruhrgebiet, Hessen, Saarland), Schweiz, Nordspanien (Pyrenäen, Katalonien, Baskenland), Korsika
Grenzfälle (eher NICHT aromeHd): München, Stuttgart, Norditalien, Niederlande-Nord, Südengland, Zentralspanien
NICHT verwenden: Österreich, Ostdeutschland, Tschechien, Adria, UK nördlich London, Skandinavien, Portugal, Süditalien

### czeAladin — 2.3 km
Kerngebiet: Österreich, Tschechien, Slowakei, Ungarn, Kroatien, Slowenien, Serbien, Bosnien, Zentralpolen (Warschau, Krakau), Rumänien-West, Bayern, Sachsen, Norditalien-Ost (Venetien, Friaul, Triest)
Grenzfälle (eher NICHT czeAladin): Berlin, Bulgarien-Süd, Norditalien-West (Gardasee, Lombardei), Südliche Ostsee, Norddeutschland
NICHT verwenden: Griechenland, Türkei, Skandinavien, Westfrankreich, Süditalien südlich Rom, UK, nördl. Ostsee, Baltikum nördlich Vilnius

### ukv — 2 km
Kerngebiet: England (Mitte und Nord), Wales, Schottland-Süd, Irland-Ost, Irische See
Grenzfälle (eher NICHT ukv): Südengland (Ärmelkanal), Schottland-Nord, Irland-West, Nordsee-Mitte
NICHT verwenden: Kontinentaleuropa, Island, Norwegen, Färöer

### iconEu — 7 km (Europa-Fallback)
Kerngebiet: Ganz Europa inkl. Skandinavien, Ostsee, Nordsee, Griechenland, Ägäis, Ionische Inseln, Spanien, Portugal, Island, Türkei-West, Mittelmeer komplett, Nordafrika-Küste
Verwende iconEu immer wenn kein hochauflösendes Modell den Ort mit 300km Puffer abdeckt.

### gfs — 22 km (Global-Fallback)
Außerhalb Europas, oder wenn iconEu nicht verfügbar.

## Entscheidungslogik

Prüfe in dieser Reihenfolge (erste Übereinstimmung gewinnt):
1. Liegt der Ort im Kerngebiet von aromeHd? → aromeHd
2. Liegt der Ort im Kerngebiet von czeAladin? → czeAladin
3. Liegt der Ort im Kerngebiet von ukv? → ukv
4. Liegt der Ort in Europa? → iconEu
5. Sonst → gfs

### Sonderfälle bei Überlappung und Grenzgebieten
- Bayern (München, Augsburg): czeAladin — liegt zentral in ALADIN, aber am Ostrand von AROME-HD
- Schweiz: aromeHd — liegt zentral in der AROME-HD-Domain
- Baden-Württemberg (Stuttgart, Freiburg): aromeHd — noch ausreichend Puffer
- Norditalien-West (Gardasee, Lombardei): iconEu — Grenzfall bei beiden hochauflösenden Modellen
- Norditalien-Ost (Venetien, Friaul, Triest): czeAladin
- Berlin, Brandenburg: iconEu — am Rand von sowohl AROME-HD als auch ALADIN
- Niederlande: iconEu — am Nordrand von AROME-HD
- Nordsee, Deutsche Bucht: iconEu
- Ostsee (Gotland, Stockholm, Helsinki): iconEu
- Südengland, Ärmelkanal: Im Zweifel iconEu — Grenzfall für ukv und aromeHd
- Levkada, Ionische Inseln, Peloponnes: iconEu
- Dubrovnik: czeAladin — noch im Kern, aber knapp; im Zweifel iconEu

## Zoom-Level

| Situation | Zoom |
|-----------|------|
| Hochauflösende Modelle — Küste, See, Insel | 8–9 |
| Hochauflösende Modelle — Binnenland, Stadt | 7–8 |
| iconEu — regional | 6–7 |
| gfs — großräumig | 5–6 |

## Antwortformat

Antworte NUR mit einem JSON-Objekt, KEINE weiteren Erklärungen:
{"model": "...", "label": "...", "zoom": 8}

Wobei "label" der angezeigte Modellname ist, z.B. "AROME-HD 1.3km", "ALADIN 2.3km", "ICON-EU 7km".`;

async function getRegionalModelAI(lat: number, lon: number, displayName: string): Promise<{ model: string; label: string; zoom: number }> {
  try {
    const modelSelMessages = [
      { role: "system", content: MODEL_SELECTION_PROMPT },
      { role: "user", content: `Ort: ${displayName}\nKoordinaten: ${lat.toFixed(4)}°N, ${lon.toFixed(4)}°E\n\nWähle das beste Windmodell.` },
    ];
    debugLogLLM("gpt-4.1-mini", "getRegionalModelAI", modelSelMessages);
    const result = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: modelSelMessages as OpenAI.ChatCompletionMessageParam[],
      max_completion_tokens: 256,
      temperature: 0,
    });

    const text = result.choices[0]?.message?.content?.trim() || "";
    debugLogLLMResponse("gpt-4.1-mini", "getRegionalModelAI", text);
    const jsonMatch = text.match(/\{[^}]+\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const validModels = ["czeAladin", "aromeHd", "ukv", "iconEu", "gfs"];
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
    const url = "https://meteonews.at/de/Allgemeine_Lage/K33/Europa";
    const res = await fetch(url, {
      headers: { "User-Agent": "WindyWeatherApp/1.0", "Accept": "text/html" },
      signal: AbortSignal.timeout(8000),
    });
    debugLog(`Scrape meteonews.at → ${res.status}`);
    if (!res.ok) return "";
    const html = await res.text();

    // Target the bulletin-wrap div inside ModuleBulletinsGeneralSituation
    const bulletinMatch = html.match(/class="[^"]*ModuleBulletinsGeneralSituation[^"]*"[^>]*>[\s\S]*?<div[^>]*class="[^"]*bulletin-wrap[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i)
      || html.match(/<div[^>]*class="[^"]*bulletin-wrap[^"]*"[^>]*>([\s\S]*?)<\/div>/i);

    if (bulletinMatch) {
      const fullText = stripHtml(bulletinMatch[1]).trim();
      debugLogScrape("meteonews.at", url, res.status, fullText);
      return fullText.slice(0, 1500);
    }

    // Fallback: find "Europawetter" section in plain text
    const plainText = stripHtml(html);
    const startIdx = plainText.indexOf("Europawetter");
    if (startIdx >= 0) {
      const fullText = plainText.slice(startIdx).trim();
      debugLogScrape("meteonews.at (fallback)", url, res.status, fullText);
      return fullText.slice(0, 1500);
    }

    debugLogScrape("meteonews.at (last-resort)", url, res.status, plainText);
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
    forecastUrl: "https://www.geosphere.at/de/karten/wetterprognose",
    label: "GeoSphere Austria",
    warningUrl: "https://warnungen.zamg.at/wsapp/de/alle",
    warningLabel: "GeoSphere Warnungen",
  },
  IT: {
    forecastUrl: "https://www.meteoam.it/",
    label: "MeteoAM Italien",
    warningUrl: "https://www.meteoam.it/it/avvisi-meteo",
    warningLabel: "MeteoAM Warnungen",
  },
  FR: {
    forecastUrl: "https://meteofrance.fr/meteo-marine",
    label: "Météo-France Marine",
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
    forecastUrl: "https://vreme.arso.gov.si/",
    label: "ARSO Slowenien",
    warningUrl: "https://meteo.arso.gov.si/met/sl/warning/",
    warningLabel: "ARSO Warnungen",
  },
  ME: {
    forecastUrl: "https://www.meteo.co.me/",
    label: "ZHMS Montenegro",
    warningUrl: "https://www.meteo.co.me/",
    warningLabel: "ZHMS Warnungen",
  },
  GB: {
    forecastUrl: "https://weather.metoffice.gov.uk/forecast/uk",
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
    warningUrl: "https://www.ipma.pt/en/otempo/avisos/",
    warningLabel: "IPMA Warnungen",
  },
  TR: {
    forecastUrl: "https://www.mgm.gov.tr/tahmin/il-ve-ilceler.aspx",
    label: "MGM Türkei",
    warningUrl: "https://www.mgm.gov.tr/tahmin/uyari.aspx",
    warningLabel: "MGM Warnungen",
  },
  DK: {
    forecastUrl: "https://www.dmi.dk/hav/",
    label: "DMI Dänemark",
    warningUrl: "https://www.dmi.dk/hav/",
    warningLabel: "DMI Warnungen",
  },
  SE: {
    forecastUrl: "https://www.smhi.se/vader",
    label: "SMHI Schweden",
    warningUrl: "https://www.smhi.se/vader",
    warningLabel: "SMHI Warnungen",
  },
  NO: {
    forecastUrl: "https://www.yr.no/en",
    label: "Yr.no Norwegen",
    warningUrl: "https://www.yr.no/en/weather-warnings",
    warningLabel: "Yr.no Warnungen",
  },
  PL: {
    forecastUrl: "https://meteo.imgw.pl/dyn/",
    label: "IMGW Polen",
    warningUrl: "https://meteo.imgw.pl/dyn/",
    warningLabel: "IMGW Warnungen",
  },
  CH: {
    forecastUrl: "https://www.meteoswiss.admin.ch/weather.html",
    label: "MeteoSchweiz",
    warningUrl: "https://www.meteoswiss.admin.ch/weather.html",
    warningLabel: "MeteoSchweiz Warnungen",
  },
};

function getRegionalService(countryCode: string): typeof REGIONAL_FORECAST_SERVICES["HR"] | undefined {
  return REGIONAL_FORECAST_SERVICES[countryCode];
}

type FetchResult = { text: string; available: boolean };

const REGIONAL_MIN_TEXT_LENGTH = 150;

async function validateScrapedContent(text: string, expectedType: "forecast" | "warning", label: string): Promise<boolean> {
  if (text.length < REGIONAL_MIN_TEXT_LENGTH) return false;
  try {
    const typeDesc = expectedType === "forecast"
      ? "einen echten Wetterbericht oder eine Wettervorhersage mit konkreten Wetterdaten (Temperatur, Wind, Niederschlag, Bewölkung, Drucklage)"
      : "echte Wetterwarninformationen (aktive Warnungen ODER die explizite Meldung dass keine Warnungen aktiv sind)";
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: "system", content: `Enthält der folgende Text ${typeDesc}? Oder ist es nur Website-Navigation, Menüs, Impressum, JavaScript-Code, Beaufort-Tabellen, oder sonstiger Nicht-Wetter-Inhalt? Antworte NUR mit JA oder NEIN.` },
      { role: "user", content: text.slice(0, 1500) },
    ];
    debugLogLLM("gpt-4.1-mini", `validate ${expectedType} [${label}]`, messages);
    const result = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages,
      max_completion_tokens: 2,
      temperature: 0,
    });
    const answer = result.choices[0]?.message?.content?.trim().toUpperCase() || "";
    const isValid = answer.startsWith("JA");
    debugLog(`Validierung ${expectedType} [${label}]: ${answer} → ${isValid ? "gültig" : "als nicht verfügbar markiert"}`);
    debugLogLLMResponse("gpt-4.1-mini", `validate ${expectedType} [${label}]`, answer);
    return isValid;
  } catch (e) {
    debugLog(`Validierung ${expectedType} [${label}]: Fehler, als gültig behandelt`);
    return true;
  }
}

const AT_BUNDESLAND_COORDS: Record<number, { name: string; lat: number; lon: number }> = {
  8009100: { name: "Vorarlberg", lat: 47.25, lon: 9.9 },
  8009200: { name: "Tirol", lat: 47.26, lon: 11.39 },
  8009300: { name: "Salzburg", lat: 47.26, lon: 13.05 },
  8009400: { name: "Oberösterreich", lat: 48.15, lon: 13.98 },
  8009500: { name: "Niederösterreich", lat: 48.3, lon: 15.75 },
  8009600: { name: "Wien", lat: 48.21, lon: 16.37 },
  8009700: { name: "Burgenland", lat: 47.5, lon: 16.42 },
  8009800: { name: "Steiermark", lat: 47.27, lon: 15.0 },
  8009900: { name: "Kärnten", lat: 46.72, lon: 14.3 },
};

async function fetchGeoSphereForecasts(lat: number, lon: number): Promise<FetchResult> {
  const url = "https://www.geosphere.at/data/textforecasts";
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    debugLog(`GeoSphere textforecasts API → ${res.status}`);
    if (!res.ok) return { text: "", available: false };
    const data = await res.json() as Array<{ stationid: number; text: string; validity_range: string[] }>;
    if (!Array.isArray(data) || data.length === 0) return { text: "", available: false };

    let bestId = 8009000;
    let bestDist = Infinity;
    for (const [idStr, info] of Object.entries(AT_BUNDESLAND_COORDS)) {
      const dist = Math.sqrt(Math.pow(lat - info.lat, 2) + Math.pow(lon - info.lon, 2));
      if (dist < bestDist) {
        bestDist = dist;
        bestId = Number(idStr);
      }
    }
    const bestName = AT_BUNDESLAND_COORDS[bestId]?.name || "Österreich";

    const regionalEntries = data.filter(e => e.stationid === bestId);
    const generalEntries = data.filter(e => e.stationid === 8009000);
    const entries = regionalEntries.length > 0 ? regionalEntries : generalEntries;

    const parts = entries
      .slice(0, 3)
      .map(e => e.text)
      .filter(t => t && t.length > 10);

    if (parts.length === 0) return { text: "", available: false };

    const fullText = `Wetterprognose ${bestName}: ${parts.join(" ")}`;
    debugLogScrape("forecast [AT]", url, res.status, fullText);
    return { text: fullText.slice(0, 3000), available: true };
  } catch (e) {
    console.error("GeoSphere textforecasts fetch error:", e instanceof Error ? e.message : e);
    return { text: "", available: false };
  }
}

async function fetchGeoSphereWarnings(lat: number, lon: number): Promise<FetchResult> {
  const url = `https://warnungen.zamg.at/wsapp/api/getWarningsForCoords?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    debugLog(`GeoSphere warnings API → ${res.status}`);
    if (!res.ok) return { text: "", available: false };
    const data = await res.json() as { properties?: { location?: { properties?: { name?: string } }; warnings?: Array<{ type?: string; level?: number; text?: string; start?: string; end?: string }> } };
    const warnings = data?.properties?.warnings;
    const locationName = data?.properties?.location?.properties?.name || "";

    if (!warnings || warnings.length === 0) {
      const noWarnText = locationName
        ? `Keine aktiven Wetterwarnungen für ${locationName}.`
        : "Keine aktiven Wetterwarnungen.";
      debugLogScrape("warnings [AT]", url, res.status, noWarnText);
      return { text: noWarnText, available: true };
    }

    const warnTexts = warnings.map(w => {
      const parts: string[] = [];
      if (w.type) parts.push(w.type);
      if (w.text) parts.push(w.text);
      if (w.start && w.end) parts.push(`(${w.start} bis ${w.end})`);
      return parts.join(": ");
    });
    const fullText = `Wetterwarnungen ${locationName}: ${warnTexts.join(" | ")}`;
    debugLogScrape("warnings [AT]", url, res.status, fullText);
    return { text: fullText.slice(0, 2000), available: true };
  } catch (e) {
    console.error("GeoSphere warnings fetch error:", e instanceof Error ? e.message : e);
    return { text: "", available: false };
  }
}

async function tryFetchForecast(countryCode: string, service: typeof REGIONAL_FORECAST_SERVICES["HR"], _lat?: number, _lon?: number): Promise<FetchResult> {
  if (countryCode === "DK") {
    const dkUrl = "https://www.dmi.dk/dmidk_byvejrWS/rest/json/Danmark/DK/land";
    const dmiRes = await fetch(dkUrl, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    debugLog(`Scrape forecast [${countryCode}] → ${dmiRes.status}`);
    if (!dmiRes.ok) return { text: "", available: false };
    const data = await dmiRes.json() as { date?: string; valid?: string; weatherForecast?: string; slipperyWarning?: string | null };
    const parts: string[] = [];
    if (data.date) parts.push(data.date);
    if (data.valid) parts.push(data.valid);
    if (data.weatherForecast) parts.push(data.weatherForecast);
    if (data.slipperyWarning) parts.push(`Glatteis/Rutschwarnung: ${data.slipperyWarning}`);
    const fullText = parts.join(" ");
    debugLogScrape(`forecast [${countryCode}]`, dkUrl, dmiRes.status, fullText);
    const text = fullText.slice(0, 3000);
    const valid = await validateScrapedContent(fullText, "forecast", countryCode);
    return { text, available: valid };
  }

  const res = await fetch(service.forecastUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "de,en;q=0.9",
    },
    signal: AbortSignal.timeout(10000),
  });
  debugLog(`Scrape forecast [${countryCode}] → ${res.status}`);
  if (!res.ok) return { text: "", available: false };
  const html = await res.text();
  const fullText = stripHtml(html);
  debugLogScrape(`forecast [${countryCode}]`, service.forecastUrl, res.status, fullText);
  const text = fullText.slice(0, 3000);
  const valid = await validateScrapedContent(fullText, "forecast", countryCode);
  return { text, available: valid };
}

async function fetchRegionalWeatherReport(countryCode: string, lat: number, lon: number): Promise<FetchResult> {
  if (countryCode === "AT") return fetchGeoSphereForecasts(lat, lon);

  const service = REGIONAL_FORECAST_SERVICES[countryCode];
  if (!service) return { text: "", available: false };

  try {
    const first = await tryFetchForecast(countryCode, service);
    if (first.available) return first;
    console.warn(`Regional forecast first attempt failed for ${countryCode}, retrying in 1s...`);
    await new Promise(r => setTimeout(r, 1000));
    const second = await tryFetchForecast(countryCode, service);
    if (second.available) return second;
    console.error(`Regional forecast unavailable for ${countryCode} (${lat.toFixed(2)},${lon.toFixed(2)}) after 2 attempts`);
    return { text: "", available: false };
  } catch (e) {
    console.error(`Regional forecast fetch error for ${countryCode}:`, e);
    return { text: "", available: false };
  }
}

async function tryFetchWarnings(service: typeof REGIONAL_FORECAST_SERVICES["HR"]): Promise<FetchResult> {
  const res = await fetch(service.warningUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "de,en;q=0.9",
    },
    signal: AbortSignal.timeout(8000),
  });
  debugLog(`Scrape warnings [${service.warningLabel}] → ${res.status}`);
  if (!res.ok) return { text: "", available: false };
  const html = await res.text();
  const fullText = stripHtml(html);
  debugLogScrape(`warnings [${service.warningLabel}]`, service.warningUrl, res.status, fullText);
  const text = fullText.slice(0, 2000);
  const valid = await validateScrapedContent(fullText, "warning", service.warningLabel);
  return { text, available: valid };
}

async function fetchRegionalWarnings(countryCode: string, lat?: number, lon?: number): Promise<FetchResult> {
  if (countryCode === "AT" && lat !== undefined && lon !== undefined) {
    return fetchGeoSphereWarnings(lat, lon);
  }

  const service = REGIONAL_FORECAST_SERVICES[countryCode];
  if (!service) return { text: "", available: false };

  try {
    const first = await tryFetchWarnings(service);
    if (first.available) return first;
    console.warn(`Regional warnings first attempt failed for ${countryCode}, retrying in 1s...`);
    await new Promise(r => setTimeout(r, 1000));
    const second = await tryFetchWarnings(service);
    if (second.available) return second;
    console.error(`Regional warnings unavailable for ${countryCode} after 2 attempts`);
    return { text: "", available: false };
  } catch (e) {
    console.error(`Regional warnings fetch error for ${countryCode}:`, e);
    return { text: "", available: false };
  }
}

async function classifyMessage(message: string, hasActiveLocation: boolean): Promise<{ type: "ANALYSE" | "CHAT" | "UNCLEAR"; location?: string }> {
  try {
    const classifyMessages = [
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
    ];
    debugLogLLM("gpt-4.1-mini", "classifyMessage", classifyMessages);
    const result = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: classifyMessages as OpenAI.ChatCompletionMessageParam[],
      max_completion_tokens: 64,
      temperature: 0,
    });
    const text = result.choices[0]?.message?.content?.trim() || "";
    debugLogLLMResponse("gpt-4.1-mini", "classifyMessage", text);
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

const WATER_CLASSES = new Set(["water", "waterway"]);
const WATER_NATURAL_TYPES = new Set(["water", "lake", "wetland", "bay", "strait", "sea"]);
const WATER_PLACE_TYPES = new Set(["sea", "ocean"]);

function isWaterFeature(cls: string, type: string): boolean {
  if (WATER_CLASSES.has(cls)) return true;
  if (cls === "natural" && WATER_NATURAL_TYPES.has(type)) return true;
  if (cls === "place" && WATER_PLACE_TYPES.has(type)) return true;
  return false;
}

async function geocodeLocation(locationName: string): Promise<{
  lat: number; lon: number; displayName: string;
  regionalModel: string; regionalModelLabel: string; regionalModelZoom: number;
  countryCode?: string; cityName?: string;
} | null> {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(locationName)}&limit=1&extratags=1&namedetails=1`,
      { headers: { "User-Agent": "WindyWeatherApp/1.0" } }
    );
    if (!response.ok) return null;

    const results = await response.json() as Array<{
      lat: string; lon: string; display_name: string;
      class: string; type: string;
      namedetails?: Record<string, string>;
    }>;
    if (!results.length) return null;

    const result = results[0];
    const lat = parseFloat(result.lat);
    const lon = parseFloat(result.lon);
    const resultClass = result.class || "";
    const resultType = result.type || "";
    const isWater = isWaterFeature(resultClass, resultType);

    const regional = await getRegionalModelAI(lat, lon, result.display_name);

    let countryCode: string | undefined;
    let cityName: string | undefined;

    if (isWater) {
      const nd = result.namedetails || {};
      const waterName = nd["name:de"] || nd["name"] || result.display_name.split(",")[0].trim();
      cityName = waterName;
      try {
        const reverseRes = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=4&addressdetails=1`,
          { headers: { "User-Agent": "WindyWeatherApp/1.0" } }
        );
        if (reverseRes.ok) {
          const rev = await reverseRes.json() as { address?: { country_code?: string } };
          countryCode = rev.address?.country_code?.toUpperCase();
        }
      } catch {}
    } else {
      try {
        const reverseRes = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10&addressdetails=1`,
          { headers: { "User-Agent": "WindyWeatherApp/1.0" } }
        );
        if (reverseRes.ok) {
          const reverseData = await reverseRes.json() as {
            class?: string; address?: {
              country_code?: string; city?: string; town?: string;
              village?: string; suburb?: string; municipality?: string; county?: string;
            }
          };
          countryCode = reverseData.address?.country_code?.toUpperCase();
          cityName = reverseData.address?.city || reverseData.address?.town || reverseData.address?.village || reverseData.address?.municipality || reverseData.address?.suburb || reverseData.address?.county;
        }
      } catch {}
    }

    debugLog(`geocodeLocation: countryCode=${countryCode}, cityName=${cityName}, isWater=${isWater}`, `countryCode=${countryCode}\ncityName=${cityName}\nisWater=${isWater}`);
    debugLog(`geocodeLocation: model=${regional.model} (${regional.label})`);

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

const SECTION_STYLE = `STIL: Deutsch, sachlich-professionell. Bullet-Point-Stil, KURZ und PRÄGNANT. Verwende GROSSZÜGIG passende Emojis am Anfang jedes Bullets und im Text: 🌀 💨 🌊 ☀️ ⛅ ☁️ 🌥️ 🌧️ 🌦️ ⚠️ ⛈️ 🌡️ 🧭 🌬️ ❄️ 🔵 🔴 📍 ✅. Konkrete Zahlen, KEINE halluzinierten Werte. KEINE Begrüßung, KEINE Floskeln. Schreibe KEINE Überschrift — nur die Bullet-Points.`;

const SECTION1_PROMPT = `Du bist ein Meteorologe. Beschreibe die aktuelle Großwetterlage über Europa.

Schreibe genau ZWEI Bullet-Points basierend ausschließlich auf dem METEONEWS-TEXT:
- Bullet 1: Druckgebilde über Europa. 12-15 Wörter. Beispiel: "Hoch über Mitteleuropa, Tief über Island steuert feuchte Luft nach Nordeuropa."
- Bullet 2: Luftmassen — kalt/warm, feucht/trocken, Luftmassengrenze. 12-15 Wörter. Quelle anhängen: [(meteonews.at)](https://meteonews.at/de/Allgemeine_Lage/K33/Europa)
KEINE Schachtelsätze, KEINE Nebensätze. Kein Bezug zu einem konkreten Ort.

${SECTION_STYLE}`;

const SECTION2_PROMPT = `Du bist ein synoptischer Meteorologe. Analysiere AUSSCHLIESSLICH das beigefügte KNMI-Frontenbild (Bodenwetterkarte).

ANLEITUNG ZUM LESEN DER KNMI-KARTE:
- Die Karte zeigt Europa mit Isobaren (Linien gleichen Luftdrucks), Druckzentren (H/L bzw. H/T) und Fronten
- Kaltfront: blaue Linie mit Dreiecken (zeigen in Zugrichtung)
- Warmfront: rote Linie mit Halbkreisen (zeigen in Zugrichtung)
- Okklusion: lila/violette Linie mit abwechselnd Dreiecken und Halbkreisen
- Konvergenzlinie: gestrichelte Linie
- Isobaren: dünne schwarze Linien mit Druckwerten in hPa
- Druckzentren: "H"/"L" oder "H"/"T" mit Druckwert
- Schau dir die GESAMTE Karte systematisch an, besonders die Region um den Zielort

Schreibe genau 1-2 Bullets, jeweils 12-15 Wörter:
- Beschreibe die nächstgelegenen Fronten zum Zielort: Typ, ungefähre Entfernung, Zugrichtung
- Falls keine Fronten nahe dem Zielort: schreibe "✅ Keine Fronten in der Nähe von [Zielort]" und beschreibe kurz die dominierenden Druckgebilde
- Quelle am letzten Bullet: [(KNMI)](https://www.knmi.nl/nederland-nu/weer/waarschuwingen-en-verwachtingen/weerkaarten)
KEINE Schachtelsätze.

${SECTION_STYLE}`;

const SECTION3_PROMPT = `Du bist ein Segelwetter-Experte. Beschreibe NUR Wind und Wellen/Seezustand für den Zielort. KEINE Wolken, KEINE Temperaturen, KEINE Niederschläge.

Schreibe Bullets basierend auf dem REGIONALEN WETTERBERICHT:
1. Je aktives oder nahendes Windsystem 1 eigener Bullet: Name des Windsystems, warum aktiv/nahend, Windstärke & Böen in Knoten (kt) — KEIN Bft. NUR Werte aus dem REGIONALEN WETTERBERICHT verwenden, KEINE eigenen Schätzungen. WICHTIG: Nur Windsysteme nennen, die am konkreten Ort geographisch tatsächlich vorkommen können — niemals ein Windsystem erfinden oder aus anderen Regionen übertragen. Beispiele für typische regionale Windsysteme (nur wenn geographisch zutreffend): Küste/Adria: Bora, Maestral, Jugo/Scirocco; Mittelmeer: Meltemi, Mistral, Tramontana, Sirocco, Levante; Alpen/Binnenland: Föhn, thermische Winde (Tag-/Nachtwind), Talwind, Bergwind; Nordsee/Ostsee: keine speziellen Eigennamen. Falls kein benanntes Windsystem aktiv ist: diesen Bullet weglassen und nur den Hauptwind (Richtung, Stärke) beschreiben.
2. Letzter Bullet: "🌊 Seezustand: [Zustand auf Deutsch]" — exakt aus dem regionalen Wetterbericht übernehmen und korrekt ins Deutsche übersetzen. Douglas-Skala: 1=ruhig, 2=leicht bewegt, 3=leicht (slight), 4=mäßig (moderate), 5=bewegt/rau (rough), 6=sehr bewegt. Beispiele: "slight and moderate" → "leicht bis mäßig", "The sea 3-4" → "leicht bis mäßig (Douglas 3-4)". Falls regionaler Wetterbericht nicht verfügbar: "Seezustand: nicht verfügbar"
WICHTIG: Schreibe AUSSCHLIESSLICH über Wind und Wellen. Keine weiteren Themen.

${SECTION_STYLE}`;

const SECTION4_PROMPT = `Du bist ein Meteorologe. Beschreibe Bewölkung und Niederschlag für den Zielort.

Schreibe genau 1-2 Bullets:
- Beschreibung Bewölkung, Regen, Gewitterrisiko in den nächsten 12h
- Basierend auf dem regionalen Wetterbericht
- Die Quelle direkt an den letzten Bullet anhängen (KEIN separater Bullet): "...Text. [(Quelle: Dienstname)](URL)"
- WICHTIG: Falls der regionale Wetterbericht "(NICHT VERFÜGBAR)" ist, schreibe NUR: "- Regionaler Wetterbericht nicht verfügbar". Erfinde KEINE Wetterdaten.

${SECTION_STYLE}`;

const SECTION6_PROMPT = `Du bist ein Meteorologe. Gib die aktuellen Wetterwarnungen für den Zielort wieder.

- Beginne mit dem Dienstnamen als Label, Beispiel: "[DHMZ Kroatien](WARNINGURL): Gelegentliche Böen..."
- Der Dienstname ist ein klickbarer Markdown-Link zur Warnseite: [WARNDIENSTNAME](WARNINGURL)
- Falls Warnungen aktiv: "[Dienstname](URL): [Warntext mit konkreten Werten und Zeitfenstern]"
- Falls keine Warnungen: "[Dienstname](URL): Keine aktuellen Wetterwarnungen"

${SECTION_STYLE}`;

async function fetchKnmiChartBase64(): Promise<string | null> {
  try {
    const now = new Date();
    const utcHour = now.getUTCHours();
    const utcDay = now.getUTCDate();
    const chartHour = utcHour >= 12 ? "12" : "00";
    const dayStr = utcDay.toString().padStart(2, "0");
    const chartUrl = `https://cdn.knmi.nl/knmi/map/page/weer/waarschuwingen_verwachtingen/weerkaarten/AL${dayStr}${chartHour}_large.gif`;

    let chartRes = await fetch(chartUrl, { signal: AbortSignal.timeout(10000) });
    if (!chartRes.ok) {
      const fallbackUrl = `https://cdn.knmi.nl/knmi/map/page/weer/waarschuwingen_verwachtingen/weerkaarten/AL${dayStr}00_large.gif`;
      chartRes = await fetch(fallbackUrl, { signal: AbortSignal.timeout(10000) });
      if (!chartRes.ok) return null;
    }
    const buffer = Buffer.from(await chartRes.arrayBuffer());
    return buffer.toString("base64");
  } catch (e) {
    console.error("KNMI chart fetch for vision failed:", e instanceof Error ? e.message : e);
    return null;
  }
}


export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.post("/api/geocode", async (req, res) => {
    debugLogRequestSeparator(`POST /api/geocode — ${req.body?.location || "unknown"}`);
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

Enthält das Bild meteorologisch relevanten Inhalt (Himmel, Wolken, Wasser, Wetterstimmung)?

WENN NEIN: Schreibe nur einen kurzen Satz, dass kein meteorologisch relevanter Inhalt zu sehen ist, und bitte um ein Foto vom Himmel oder Horizont.

WENN JA: Beginne sofort mit dem ersten Abschnitt — KEIN einleitender Satz, KEINE Bewertung der Relevanz, KEINE Einleitung. Der erste Ausgabe-Token muss "## 📷" sein.

## 📷 Aufnahme
(1–2 Sätze: Was ist zu sehen? Kurze sachliche Beschreibung des Motivs — Ort, Perspektive, Tageszeit, auffällige Elemente.)

## ☁️ Wolkentyp
(ein Bullet pro identifizierter Wolkenart: Name fett, Höhe, dann 1–2 Sätze Beschreibung was diese Wolke charakterisiert und wie man sie erkennt)
- Beispiel: **Cumulus mediocris** — ~1.500–2.500 m (tief-mittel): Kompakte, blumenkohlförmige Quellwolke mit flacher Basis und klar abgegrenztem Rand. Entsteht durch thermische Konvektion und gilt als Schönwetterwolke solange die Vertikalentwicklung begrenzt bleibt.
- Beispiel: **Cirrus fibratus** — ~7.000–10.000 m (hoch): Feine, faserige Schleierwolke aus Eiskristallen, oft hakenförmig oder gekämmt. Trübt kaum die Sonne und kündigt häufig eine nahende Warmfront an.

## 🌊 Wellen
(PFLICHT — immer vorhanden. Wenn Wasser sichtbar: Wellentyp, geschätzte Höhe, Periode, Beschaffenheit der Oberfläche. Wenn kein Wasser sichtbar: schreibe nur „—".)

## 🌫️ Bedeckungsgrad
(Okta-Angabe + kurze Beschreibung)

## 🌤️ Typische Wetterentwicklung
(Was ist meteorologisch zu erwarten? Kurz und klar.)

STIL: Deutsch, sachlich, ohne Wiederholungen.`;

  app.post("/api/upload", upload.single("photo"), async (req, res) => {
    debugLogRequestSeparator(`POST /api/upload — ${req.file?.originalname || "no file"}`);
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

      sendSSE({ status: isVideo ? "📹 Video empfangen — analysiere Metadaten..." : "📷 Foto empfangen — analysiere Metadaten..." });

      let exifLocation: { lat: number; lon: number } | null = null;
      let exifTime: string | null = null;
      let videoThumbnailBase64: string | null = null;

      if (isVideo) {
        const [thumbResult, metaResult] = await Promise.all([
          extractVideoThumbnail(filePath),
          extractVideoMetadata(filePath),
        ]);
        videoThumbnailBase64 = thumbResult;
        if (metaResult.gps) exifLocation = metaResult.gps;
        if (metaResult.time) exifTime = metaResult.time;
      } else if (req.file.mimetype === "image/jpeg" || req.file.mimetype === "image/png") {
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

      if (isVideo) {
        sendSSE({ videoMeta: { thumbnailBase64: videoThumbnailBase64, time: exifTime, locationName: exifLocationName, countryCode: exifCountryCode } });
      } else {
        sendSSE({ exifMeta: { time: exifTime, locationName: exifLocationName, countryCode: exifCountryCode } });
      }

      if (!exifLocation && !exifTime && !isVideo) {
        sendSSE({ status: "ℹ️ Keine GPS/Zeit-Metadaten im Bild gefunden" });
      }

      const systemPrompt = PHOTO_ANALYSIS_PROMPT;

      if (isVideo) {
        sendSSE({ status: "🔍 Analysiere Video mit Gemini 2.5 Flash..." });

        const base64Video = fileBuffer.toString("base64");
        const videoPrompt = systemPrompt
          .replace(/\bBild\b/g, "Video")
          .replace(
            "## 🌫️ Bedeckungsgrad",
            "## 💨 Windgeschwindigkeit\n(Schätze die Windstärke anhand sichtbarer Hinweise: Baumbeweigung, Wasserkräuselung, Gischt, Flaggen, Wellenhöhe, Schaumstreifen. Gib Windstärke NUR in Knoten (kt) an, mit kurzer Begründung der Schätzung. KEINE Beaufort-Angabe.)\n\n## 🌫️ Bedeckungsgrad"
          ) + "\n\nBesonders beachten bei Videos:\n- Wolkenbewegung und -entwicklung über die Zeit\n- Wellenmuster und Windstärke auf dem Wasser\n- Veränderungen in Lichtverhältnissen und Sichtweite\n- Dynamische Wetterphänomene (ziehende Fronten, aufbauende Konvektion)";

        let vidText = "";
        try {
          const geminiContents = [{
            role: "user",
            parts: [
              { inlineData: { mimeType: req.file!.mimetype, data: base64Video } },
              { text: "Analysiere dieses Video meteorologisch. Achte besonders auf Bewegungen und zeitliche Entwicklungen." },
            ],
          }];
          debugLogLLM("gemini-2.5-flash", "video analysis", geminiContents, videoPrompt);
          const result = await gemini.models.generateContent({
            model: "gemini-2.5-flash",
            contents: geminiContents,
            config: { systemInstruction: videoPrompt },
          });
          vidText = result.text || "";
          debugLogLLMResponse("gemini-2.5-flash", "video analysis", vidText);
        } catch (geminiErr) {
          console.warn("Gemini video analysis failed, falling back to GPT-4.1 Vision with thumbnail:", geminiErr instanceof Error ? geminiErr.message : geminiErr);
        }

        if (!vidText && videoThumbnailBase64) {
          sendSSE({ status: "🔍 Analysiere Video-Standbild mit GPT-4.1 Vision..." });
          const fallbackMessages: OpenAI.ChatCompletionMessageParam[] = [
            { role: "system", content: videoPrompt },
            {
              role: "user",
              content: [
                { type: "image_url", image_url: { url: `data:image/jpeg;base64,${videoThumbnailBase64}`, detail: "high" } },
                { type: "text", text: "Analysiere dieses Video-Standbild meteorologisch." },
              ],
            },
          ];
          debugLogLLM("gpt-4.1", "video fallback", fallbackMessages);
          const fallbackRes = await openai.chat.completions.create({
            model: "gpt-4.1",
            messages: fallbackMessages,
            max_completion_tokens: 4096,
            temperature: 0.3,
            stream: false,
          });
          const fallbackContent = fallbackRes.choices[0]?.message?.content || "";
          debugLogLLMResponse("gpt-4.1", "video fallback", fallbackContent);
          if (fallbackContent) {
            vidText = `> ⚠️ *Video-Analyse nicht verfügbar — Analyse basiert auf einem Standbild (1. Sekunde).*\n\n${fallbackContent}`;
          }
        }

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

        debugLogLLM("gpt-4.1", "image analysis", imageMessages);
        const imgResponse = await openai.chat.completions.create({
          model: "gpt-4.1",
          messages: imageMessages,
          max_completion_tokens: 4096,
          temperature: 0.3,
          stream: false,
        });
        const imgText = imgResponse.choices[0]?.message?.content || "";
        debugLogLLMResponse("gpt-4.1", "image analysis", imgText);
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
    debugLogRequestSeparator(`POST /api/chat — "${(message || "").slice(0, 80)}"`);

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

        debugLogLLM("gpt-4.1", "general chat", msgs);
        const chatResponse = await openai.chat.completions.create({
          model: "gpt-4.1",
          messages: msgs,
          max_completion_tokens: 2048,
          temperature: 0.3,
          stream: false,
        });
        const chatText = chatResponse.choices[0]?.message?.content || "";
        debugLogLLMResponse("gpt-4.1", "general chat", chatText);
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
      const locationShort = geocoded.cityName || geocoded.displayName.split(",")[0].trim();
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

      const noResult: FetchResult = { text: "", available: false };
      const [meteonewsText, regionalReport, warningsText, knmiBase64] = await Promise.all([
        fetchMeteonews(),
        countryCode ? fetchRegionalWeatherReport(countryCode, geocoded.lat, geocoded.lon) : Promise.resolve(noResult),
        countryCode ? fetchRegionalWarnings(countryCode, geocoded.lat, geocoded.lon) : Promise.resolve(noResult),
        fetchKnmiChartBase64(),
      ]);

      const bullet1Available = service
        ? `Regionales Windmodell: ${geocoded.regionalModelLabel}, Regionaler Wetterbericht: [${service.label}](${service.forecastUrl})`
        : `Regionales Windmodell: ${geocoded.regionalModelLabel}`;
      const bullet1Unavailable = service
        ? `⚠️ Regionales Windmodell: ${geocoded.regionalModelLabel} — Regionaler Wetterbericht [${service.label}](${service.forecastUrl}) momentan nicht verfügbar`
        : `⚠️ Regionales Windmodell: ${geocoded.regionalModelLabel} — kein regionaler Wetterbericht verfügbar`;
      const abschnitt3Bullet1 = regionalReport.available ? bullet1Available : bullet1Unavailable;

      sendSSE({ analysisStart: { sections: sectionConfigs } });

      const streamSectionLLM = async (
        sectionIndex: number,
        sectionTitle: string,
        systemPrompt: string,
        userContent: string | OpenAI.ChatCompletionContentPart[],
        model: string,
        debugLabel: string,
        skipHeader: boolean = false,
      ) => {
        if (!skipHeader) {
          sendSSE({ section: sectionConfigs[sectionIndex] });
          sendSSE({ content: `## ${sectionTitle}\n\n` });
        }

        const msgs: OpenAI.ChatCompletionMessageParam[] = [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ];
        debugLogLLM(model, debugLabel, msgs);

        const stream = await openai.chat.completions.create({
          model,
          messages: msgs,
          max_completion_tokens: 512,
          temperature: 0.3,
          stream: true,
        });

        let buf = "";
        let fullText = "";
        let timer: ReturnType<typeof setTimeout> | null = null;
        const flush = () => { if (buf) { sendSSE({ content: buf }); buf = ""; } timer = null; };
        for await (const chunk of stream) {
          const text = chunk.choices?.[0]?.delta?.content;
          if (text) { buf += text; fullText += text; if (!timer) timer = setTimeout(flush, 30); }
        }
        if (timer) clearTimeout(timer);
        flush();
        debugLogLLMResponse(model, debugLabel, fullText);
        sendSSE({ content: "\n\n" });
      };

      // Section 1: Druck & Luftmassen (Claude with KNMI image + meteonews)
      sendSSE({ section: sectionConfigs[0] });
      sendSSE({ content: "## 1. Druck & Luftmassen\n\n" });

      const section1UserContent: Anthropic.MessageCreateParams["messages"][0]["content"] = [];
      if (knmiBase64) {
        section1UserContent.push({
          type: "image",
          source: { type: "base64", media_type: "image/gif", data: knmiBase64 },
        });
      }
      section1UserContent.push({
        type: "text",
        text: `METEONEWS-TEXT:\n${meteonewsText || "(nicht verfügbar)"}`,
      });

      debugLogLLM("claude-sonnet-4-6", "section1-druck-luftmassen", [{ role: "user", content: "(KNMI image + meteonews)" }], SECTION1_PROMPT);
      const s1Stream = anthropic.messages.stream({
        model: "claude-sonnet-4-6",
        max_tokens: 512,
        system: SECTION1_PROMPT,
        messages: [{ role: "user", content: section1UserContent }],
      });

      let s1Buf = "";
      let s1Full = "";
      let s1Timer: ReturnType<typeof setTimeout> | null = null;
      const s1Flush = () => { if (s1Buf) { sendSSE({ content: s1Buf }); s1Buf = ""; } s1Timer = null; };
      for await (const event of s1Stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          const text = event.delta.text;
          if (text) { s1Buf += text; s1Full += text; if (!s1Timer) s1Timer = setTimeout(s1Flush, 30); }
        }
      }
      if (s1Timer) clearTimeout(s1Timer);
      s1Flush();
      debugLogLLMResponse("claude-sonnet-4-6", "section1-druck-luftmassen", s1Full);
      sendSSE({ content: "\n\n" });

      // Section 2: Fronten (KNMI image via Claude Sonnet 4.6)
      sendSSE({ section: sectionConfigs[1] });
      sendSSE({ content: "## 2. Fronten\n\n" });

      const section2UserContent: Anthropic.MessageCreateParams["messages"][0]["content"] = [];
      if (knmiBase64) {
        section2UserContent.push({
          type: "image",
          source: { type: "base64", media_type: "image/gif", data: knmiBase64 },
        });
      }
      section2UserContent.push({
        type: "text",
        text: `Zielort: ${locationShort} (${geocoded.lat.toFixed(2)}°N, ${geocoded.lon.toFixed(2)}°E)${!knmiBase64 ? "\n\n(KNMI-Frontenbild nicht verfügbar — schreibe: 'KNMI-Karte nicht verfügbar')" : ""}`,
      });

      debugLogLLM("claude-sonnet-4-6", "section2-fronten", [{ role: "user", content: "(KNMI image + location)" }], SECTION2_PROMPT);
      const claudeStream = anthropic.messages.stream({
        model: "claude-sonnet-4-6",
        max_tokens: 512,
        system: SECTION2_PROMPT,
        messages: [{ role: "user", content: section2UserContent }],
      });

      let s2Buf = "";
      let s2Full = "";
      let s2Timer: ReturnType<typeof setTimeout> | null = null;
      const s2Flush = () => { if (s2Buf) { sendSSE({ content: s2Buf }); s2Buf = ""; } s2Timer = null; };
      for await (const event of claudeStream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          const text = event.delta.text;
          if (text) { s2Buf += text; s2Full += text; if (!s2Timer) s2Timer = setTimeout(s2Flush, 30); }
        }
      }
      if (s2Timer) clearTimeout(s2Timer);
      s2Flush();
      debugLogLLMResponse("claude-sonnet-4-6", "section2-fronten", s2Full);
      sendSSE({ content: "\n\n" });

      // Section 3: Wind & Welle (regional report + model info)
      const regionalReportText = regionalReport.available ? regionalReport.text : "(NICHT VERFÜGBAR)";
      sendSSE({ section: sectionConfigs[2] });
      sendSSE({ content: `## 3. Wind & Welle\n\n- ${abschnitt3Bullet1}\n` });
      const section3Context = `Zielort: ${locationShort}\n\nREGIONALER WETTERBERICHT (${service?.label || "nicht verfügbar"}):\n${regionalReportText}`;
      await streamSectionLLM(
        2,
        "3. Wind & Welle",
        SECTION3_PROMPT,
        section3Context,
        "gpt-4.1-mini",
        "section3-wind-welle",
        true,
      );

      // Section 4: Wolken & Regen (regional report)
      const section4Context = `Zielort: ${locationShort}\nQuelle: ${service?.label || "nicht verfügbar"}, URL: ${service?.forecastUrl || "nicht verfügbar"}\n\nREGIONALER WETTERBERICHT:\n${regionalReportText}`;
      await streamSectionLLM(
        3,
        "4. Wolken & Regen",
        SECTION4_PROMPT,
        section4Context,
        "gpt-4.1-mini",
        "section4-wolken-regen",
      );

      // Section 5: Prognose (no LLM call — chart speaks for itself)
      sendSSE({ section: sectionConfigs[4] });
      sendSSE({ content: "## 5. Prognose\n\n" });

      // Section 6: Wetterwarnung
      const warningServiceLabel = service?.warningLabel || "Warnseite";
      const warningServiceUrl = service?.warningUrl || "#";
      const warningContext = warningsText.available
        ? `Zielort: ${locationShort}\nWarndienst: [${warningServiceLabel}](${warningServiceUrl})\n\nWARNUNGEN:\n${warningsText.text}`
        : `Zielort: ${locationShort}\nWarndienst: [${warningServiceLabel}](${warningServiceUrl})\n\n⚠️ Die Warnseite (${warningServiceLabel}) ist NICHT ABRUFBAR. Schreibe: "⚠️ [${warningServiceLabel}](${warningServiceUrl}) nicht erreichbar – bitte direkt auf der Seite prüfen."`;
      await streamSectionLLM(
        5,
        "6. Wetterwarnung",
        SECTION6_PROMPT,
        warningContext,
        "gpt-4.1-mini",
        "section6-warnung",
      );

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
