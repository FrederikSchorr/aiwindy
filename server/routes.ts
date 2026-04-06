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
import {
  detectLocation,
  countryFlag,
  LAND_TO_COUNTRY_CODE,
  getModelForCountry,
  resolveWindyModel,
  getWindySources,
  classifyMessage,
  geocodeLocation,
  reverseGeocode,
  getCachedLocation,
  setCachedLocation,
  getRegionalModelFallback,
} from "./location.js";
import { createAnalysis } from "./analysis-store.js";

import sailingAreasData from "../data/sailingareas.json" with { type: "json" };
import windSystemsData from "../data/windsystems.json" with { type: "json" };

function buildSailingAreasSummary(): string {
  const lines: string[] = [];
  for (const [country, data] of Object.entries(sailingAreasData) as [
    string,
    any,
  ][]) {
    const reviere = (data.reviere || []).map((r: any) => r.deutsch).join(", ");
    if (reviere) lines.push(`${country}: ${reviere}`);
  }
  return lines.join("\n");
}

function buildWindSystemsSummary(): string {
  const lines: string[] = [];
  for (const entry of windSystemsData as any[]) {
    const wlist = entry.winds
      .map(
        (w: any) =>
          `${w.name}${w.alternativeNames ? ` (${w.alternativeNames})` : ""}: ${w.description.split(".")[0]}`,
      )
      .join("; ");
    lines.push(`${entry.country}: ${wlist}`);
  }
  return lines.join("\n");
}

const SAILING_AREAS_SUMMARY = buildSailingAreasSummary();
const WIND_SYSTEMS_SUMMARY = buildWindSystemsSummary();

let lastAnalysisContext: {
  location: string;
  date: string;
  sections: Record<string, string>;
  meta: string;
  preprocessed: string;
} | null = null;
let lastAnalysisFilePath: string | null = null;
let lastPhotoAnalysis: { text: string; date: string; locationName?: string } | null = null;
import {
  fetchMeteonews,
  preprocessMeteonews,
  fetchKnmiChart,
  fetchKnmiForecast,
  fetchWetterzentraleChart,
  buildWetterzentraleCurrentUrl,
  buildWetterzentraleForecastUrl,
  currentRunDate,
  nextForecastTarget,
  stripHtml,
  getEuropeSources,
} from "./weather-europe.js";
import {
  fetchNationalWeather,
  preprocessNationalWeather,
  preprocessLocalWeather,
} from "./weather-national.js";
import { generateWeatherOutput } from "./weather-output.js";

const execFileAsync = promisify(execFile);

function debugLog(_s: string, _d?: string): void {}
function debugLogRequestSeparator(_l: string): void {}
function debugLogLLM(
  _m: string,
  _c: string,
  _msgs: unknown[],
  _si?: string,
): void {}
function debugLogLLMResponse(_m: string, _c: string, _r: string): void {}
function debugLogScrape(
  _s: string,
  _u: string,
  _st: number,
  _t: string,
): void {}

const COUNTRY_TIMEZONE: Record<string, string> = {
  HR: "Europe/Zagreb",
  DE: "Europe/Berlin",
  AT: "Europe/Vienna",
  IT: "Europe/Rome",
  FR: "Europe/Paris",
  GR: "Europe/Athens",
  SI: "Europe/Ljubljana",
  ME: "Europe/Podgorica",
  GB: "Europe/London",
  NL: "Europe/Amsterdam",
  ES: "Europe/Madrid",
  PT: "Europe/Lisbon",
  TR: "Europe/Istanbul",
  DK: "Europe/Copenhagen",
  SE: "Europe/Stockholm",
  NO: "Europe/Oslo",
  PL: "Europe/Warsaw",
  CH: "Europe/Zurich",
  AL: "Europe/Tirane",
  BE: "Europe/Brussels",
  IE: "Europe/Dublin",
};

async function extractVideoThumbnail(filePath: string): Promise<string | null> {
  try {
    const outputPath = `/tmp/vthumb-${Date.now()}.jpg`;
    await execFileAsync("ffmpeg", [
      "-i",
      filePath,
      "-ss",
      "00:00:01",
      "-vframes",
      "1",
      "-q:v",
      "3",
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
        "-i",
        filePath,
        "-vframes",
        "1",
        "-q:v",
        "3",
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
      "-v",
      "quiet",
      "-print_format",
      "json",
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
    const creationTag =
      tags["creation_time"] ||
      tags["com.apple.quicktime.creationdate"] ||
      tags["date"];
    if (creationTag) {
      const d = new Date(creationTag);
      if (!isNaN(d.getTime())) {
        time = d.toLocaleString("de-DE", {
          timeZone: "Europe/Berlin",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
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

const REGIONAL_FORECAST_SERVICES: Record<
  string,
  {
    forecastUrl: string;
    label: string;
    warningUrl: string;
    warningLabel: string;
  }
> = {
  HR: {
    forecastUrl:
      "https://meteo.hr/prognoze_e.php?section=prognoze_specp&param=jadran",
    label: "DHMZ Kroatien",
    warningUrl:
      "https://meteo.hr/prognoze_e.php?section=prognoze_specp&param=jadran",
    warningLabel: "DHMZ Kroatien",
  },
  DE: {
    forecastUrl:
      "https://www.dwd.de/DWD/wetter/wv_allg/deutschland/text/vhdl13_dwoh.html",
    label: "DWD Deutschland",
    warningUrl:
      "https://www.dwd.de/DE/wetter/warnungen_gemeinden/warnWetter_node.html",
    warningLabel: "DWD Deutschland",
  },
  AT: {
    forecastUrl: "https://www.geosphere.at/de/karten/wetterprognose",
    label: "GeoSphere Austria",
    warningUrl: "https://warnungen.zamg.at/wsapp/de/alle",
    warningLabel: "GeoSphere Austria",
  },
  IT: {
    forecastUrl: "https://www.meteoam.it/",
    label: "MeteoAM Italien",
    warningUrl: "https://www.meteoam.it/it/avvisi-meteo",
    warningLabel: "MeteoAM Italien",
  },
  FR: {
    forecastUrl: "https://meteofrance.fr/meteo-marine",
    label: "Météo-France Marine",
    warningUrl: "https://vigilance.meteofrance.fr/fr",
    warningLabel: "Météo-France Marine",
  },
  GR: {
    forecastUrl:
      "http://oldportal.emy.gr/emy/en/navigation/naftilia_deltio_thalasson_ektiposi",
    label: "EMY (HNMS) Griechenland",
    warningUrl:
      "http://oldportal.emy.gr/emy/en/navigation/naftilia_deltio_thalasson_ektiposi",
    warningLabel: "EMY (HNMS) Griechenland",
  },
  SI: {
    forecastUrl: "https://vreme.arso.gov.si/",
    label: "ARSO Slowenien",
    warningUrl: "https://meteo.arso.gov.si/met/sl/warning/",
    warningLabel: "ARSO Slowenien",
  },
  ME: {
    forecastUrl: "https://www.meteo.co.me/",
    label: "ZHMS Montenegro",
    warningUrl: "https://www.meteo.co.me/",
    warningLabel: "ZHMS Montenegro",
  },
  GB: {
    forecastUrl: "https://weather.metoffice.gov.uk/forecast/uk",
    label: "Met Office UK",
    warningUrl:
      "https://www.metoffice.gov.uk/weather/warnings-and-advice/uk-warnings",
    warningLabel: "Met Office UK",
  },
  NL: {
    forecastUrl: "https://www.knmi.nl/nederland-nu/weer/verwachtingen",
    label: "KNMI Niederlande",
    warningUrl: "https://www.knmi.nl/nederland-nu/weer/waarschuwingen",
    warningLabel: "KNMI Niederlande",
  },
  ES: {
    forecastUrl: "https://www.aemet.es/es/eltiempo/prediccion/espana",
    label: "AEMET Spanien",
    warningUrl: "https://www.aemet.es/es/eltiempo/prediccion/avisos",
    warningLabel: "AEMET Spanien",
  },
  PT: {
    forecastUrl: "https://www.ipma.pt/en/otempo/prev.am.geral/",
    label: "IPMA Portugal",
    warningUrl: "https://www.ipma.pt/en/otempo/avisos/",
    warningLabel: "IPMA Portugal",
  },
  TR: {
    forecastUrl: "https://www.mgm.gov.tr/tahmin/il-ve-ilceler.aspx",
    label: "MGM Türkei",
    warningUrl: "https://www.mgm.gov.tr/tahmin/uyari.aspx",
    warningLabel: "MGM Türkei",
  },
  DK: {
    forecastUrl: "https://www.dmi.dk/hav/",
    label: "DMI Dänemark",
    warningUrl: "https://www.dmi.dk/hav/",
    warningLabel: "DMI Dänemark",
  },
  SE: {
    forecastUrl: "https://www.smhi.se/vader",
    label: "SMHI Schweden",
    warningUrl: "https://www.smhi.se/vader",
    warningLabel: "SMHI Schweden",
  },
  NO: {
    forecastUrl: "https://www.yr.no/en",
    label: "Yr.no Norwegen",
    warningUrl: "https://www.yr.no/en/weather-warnings",
    warningLabel: "Yr.no Norwegen",
  },
  PL: {
    forecastUrl: "https://meteo.imgw.pl/dyn/",
    label: "IMGW Polen",
    warningUrl: "https://meteo.imgw.pl/dyn/",
    warningLabel: "IMGW Polen",
  },
  CH: {
    forecastUrl: "https://www.meteoswiss.admin.ch/weather.html",
    label: "MeteoSchweiz",
    warningUrl: "https://www.meteoswiss.admin.ch/weather.html",
    warningLabel: "MeteoSchweiz",
  },
};

function getRegionalService(
  countryCode: string,
): (typeof REGIONAL_FORECAST_SERVICES)["HR"] | undefined {
  return REGIONAL_FORECAST_SERVICES[countryCode];
}

type FetchResult = { text: string; available: boolean };

const REGIONAL_MIN_TEXT_LENGTH = 150;

async function validateScrapedContent(
  text: string,
  expectedType: "forecast" | "warning",
  label: string,
): Promise<boolean> {
  if (text.length < REGIONAL_MIN_TEXT_LENGTH) return false;
  try {
    const typeDesc =
      expectedType === "forecast"
        ? "einen echten Wetterbericht oder eine Wettervorhersage mit konkreten Wetterdaten (Temperatur, Wind, Niederschlag, Bewölkung, Drucklage)"
        : "echte Wetterwarninformationen (aktive Warnungen ODER die explizite Meldung dass keine Warnungen aktiv sind)";
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: `Enthält der folgende Text ${typeDesc}? Oder ist es nur Website-Navigation, Menüs, Impressum, JavaScript-Code, Beaufort-Tabellen, oder sonstiger Nicht-Wetter-Inhalt? Antworte NUR mit JA oder NEIN.`,
      },
      { role: "user", content: text.slice(0, 4000) },
    ];
    debugLogLLM(
      "gpt-4.1-mini",
      `validate ${expectedType} [${label}]`,
      messages,
    );
    const result = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages,
      max_completion_tokens: 2,
      temperature: 0,
    });
    const answer =
      result.choices[0]?.message?.content?.trim().toUpperCase() || "";
    const isValid = answer.startsWith("JA");
    debugLog(
      `Validierung ${expectedType} [${label}]: ${answer} → ${isValid ? "gültig" : "als nicht verfügbar markiert"}`,
    );
    debugLogLLMResponse(
      "gpt-4.1-mini",
      `validate ${expectedType} [${label}]`,
      answer,
    );
    return isValid;
  } catch (e) {
    debugLog(
      `Validierung ${expectedType} [${label}]: Fehler, als gültig behandelt`,
    );
    return true;
  }
}

const AT_BUNDESLAND_COORDS: Record<
  number,
  { name: string; lat: number; lon: number }
> = {
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

async function fetchGeoSphereForecasts(
  lat: number,
  lon: number,
): Promise<FetchResult> {
  const url = "https://www.geosphere.at/data/textforecasts";
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    debugLog(`GeoSphere textforecasts API → ${res.status}`);
    if (!res.ok) return { text: "", available: false };
    const data = (await res.json()) as Array<{
      stationid: number;
      text: string;
      validity_range: string[];
    }>;
    if (!Array.isArray(data) || data.length === 0)
      return { text: "", available: false };

    let bestId = 8009000;
    let bestDist = Infinity;
    for (const [idStr, info] of Object.entries(AT_BUNDESLAND_COORDS)) {
      const dist = Math.sqrt(
        Math.pow(lat - info.lat, 2) + Math.pow(lon - info.lon, 2),
      );
      if (dist < bestDist) {
        bestDist = dist;
        bestId = Number(idStr);
      }
    }
    const bestName = AT_BUNDESLAND_COORDS[bestId]?.name || "Österreich";

    const regionalEntries = data.filter((e) => e.stationid === bestId);
    const generalEntries = data.filter((e) => e.stationid === 8009000);
    const entries =
      regionalEntries.length > 0 ? regionalEntries : generalEntries;

    const parts = entries
      .slice(0, 3)
      .map((e) => e.text)
      .filter((t) => t && t.length > 10);

    if (parts.length === 0) return { text: "", available: false };

    const fullText = `Wetterprognose ${bestName}: ${parts.join(" ")}`;
    debugLogScrape("forecast [AT]", url, res.status, fullText);
    return { text: fullText, available: true };
  } catch (e) {
    console.error(
      "GeoSphere textforecasts fetch error:",
      e instanceof Error ? e.message : e,
    );
    return { text: "", available: false };
  }
}

async function tryFetchForecast(
  countryCode: string,
  service: (typeof REGIONAL_FORECAST_SERVICES)["HR"],
  _lat?: number,
  _lon?: number,
): Promise<FetchResult> {
  if (countryCode === "DK") {
    const dkUrl = "https://www.dmi.dk/dmidk_byvejrWS/rest/json/Danmark/DK/land";
    const dmiRes = await fetch(dkUrl, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    debugLog(`Scrape forecast [${countryCode}] → ${dmiRes.status}`);
    if (!dmiRes.ok) return { text: "", available: false };
    const data = (await dmiRes.json()) as {
      date?: string;
      valid?: string;
      weatherForecast?: string;
      slipperyWarning?: string | null;
    };
    const parts: string[] = [];
    if (data.date) parts.push(data.date);
    if (data.valid) parts.push(data.valid);
    if (data.weatherForecast) parts.push(data.weatherForecast);
    if (data.slipperyWarning)
      parts.push(`Glatteis/Rutschwarnung: ${data.slipperyWarning}`);
    const fullText = parts.join(" ");
    debugLogScrape(`forecast [${countryCode}]`, dkUrl, dmiRes.status, fullText);
    const valid = await validateScrapedContent(
      fullText,
      "forecast",
      countryCode,
    );
    return { text: fullText, available: valid };
  }

  const res = await fetch(service.forecastUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "de,en;q=0.9",
    },
    signal: AbortSignal.timeout(10000),
  });
  debugLog(`Scrape forecast [${countryCode}] → ${res.status}`);
  if (!res.ok) return { text: "", available: false };
  const html = await res.text();
  const fullText = stripHtml(html);
  debugLogScrape(
    `forecast [${countryCode}]`,
    service.forecastUrl,
    res.status,
    fullText,
  );
  const valid = await validateScrapedContent(fullText, "forecast", countryCode);
  return { text: fullText, available: valid };
}

async function fetchGreekMarineForecast(
  lat: number,
  lon: number,
  locationName: string,
): Promise<FetchResult> {
  const url =
    "http://oldportal.emy.gr/emy/en/navigation/naftilia_deltio_thalasson_ektiposi";
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(10000),
    });
    debugLog(`Scrape EMY METAREA-3 → ${res.status}`);
    if (!res.ok) return { text: "", available: false };
    const html = await res.text();
    const match = html.match(/printableArea">([\s\S]*?)<\/div>/);
    if (!match) return { text: "", available: false };
    const bulletinText = match[1]
      .replace(/<br[^>]*>/gi, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/&[a-z]+;/gi, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (bulletinText.length < 200) return { text: "", available: false };
    debugLog(`EMY METAREA-3 bulletin: ${bulletinText.length} chars`);
    const extractMessages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: `You are given a METAREA-3 marine weather bulletin with forecasts for many sea areas (NORTH ADRIATIC, SOUTH IONIO, SARONIKOS, KITHIRA SEA, etc.).

Find the sea area(s) closest to the given location and extract ONLY those paragraphs. Include PART 2 (GENERAL SYNOPSIS) plus the relevant sea area forecast(s) from PART 3.

If the location is coastal, pick the adjacent sea area(s). If inland Greece, pick the nearest sea area.
Output the extracted text exactly as written, preserving all wind speeds, sea states, and weather data.`,
      },
      {
        role: "user",
        content: `Location: ${locationName} (${lat.toFixed(2)}°N, ${lon.toFixed(2)}°E)\n\nBULLETIN:\n${bulletinText}`,
      },
    ];
    debugLogLLM("gpt-4.1-mini", "extract-greek-sea-area", extractMessages);
    const result = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: extractMessages,
      max_completion_tokens: 1024,
      temperature: 0,
    });
    const extracted = result.choices[0]?.message?.content?.trim() || "";
    debugLogLLMResponse("gpt-4.1-mini", "extract-greek-sea-area", extracted);
    if (extracted.length < 30) return { text: bulletinText, available: true };
    return { text: extracted, available: true };
  } catch (e) {
    console.error(
      "EMY METAREA-3 fetch error:",
      e instanceof Error ? e.message : e,
    );
    return { text: "", available: false };
  }
}

async function fetchRegionalWeatherReport(
  countryCode: string,
  lat: number,
  lon: number,
  locationName?: string,
): Promise<FetchResult> {
  if (countryCode === "AT") return fetchGeoSphereForecasts(lat, lon);
  if (countryCode === "GR")
    return fetchGreekMarineForecast(lat, lon, locationName || "Greece");

  const service = REGIONAL_FORECAST_SERVICES[countryCode];
  if (!service) return { text: "", available: false };

  try {
    const first = await tryFetchForecast(countryCode, service);
    if (first.available) return first;
    console.warn(
      `Regional forecast first attempt failed for ${countryCode}, retrying in 1s...`,
    );
    await new Promise((r) => setTimeout(r, 1000));
    const second = await tryFetchForecast(countryCode, service);
    if (second.available) return second;
    console.error(
      `Regional forecast unavailable for ${countryCode} (${lat.toFixed(2)},${lon.toFixed(2)}) after 2 attempts`,
    );
    return { text: "", available: false };
  } catch (e) {
    console.error(`Regional forecast fetch error for ${countryCode}:`, e);
    return { text: "", available: false };
  }
}

async function preprocessWeatherText(
  rawText: string,
  serviceName: string,
): Promise<string> {
  if (!rawText || rawText.length < 50) return rawText;
  try {
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: `Extract ONLY the meteorological content from this weather service page text. Remove all website navigation, menus, headers, footers, disclaimers, and non-weather content.

Keep and preserve EXACTLY:
- Wind: directions, speeds, gusts — ALL numbers must be preserved exactly
- Sea state: Douglas scale values, wave heights, sea conditions
- Temperature: all values in °C
- Precipitation: rain, snow, thunderstorms
- Warnings: all active weather warnings with severity, timing, and values
- Pressure: high/low pressure systems
- Cloud cover, visibility
- Time references: dates, periods, "today", "tomorrow", etc.

Rules:
- CONVERT all wind speeds to knots (kt): If Beaufort (Bft) scale is used, convert using: Bft 2=5kt, 3=10kt, 4=14kt, 5=19kt, 6=24kt, 7=30kt, 8=37kt, 9=44kt. Write the kt value and note the original Bft in parentheses, e.g. "NORTHEAST 19-24kt (Bft 5-6)". If km/h is used, divide by 1.852. If m/s, multiply by 1.944.
- Preserve ALL other numeric values exactly as written
- Keep the original language (English, German, Croatian, etc.)
- Output clean text paragraphs, no HTML
- If text contains forecast AND warnings, include BOTH
- Do NOT add any information not in the source text`,
      },
      { role: "user", content: rawText.slice(0, 15000) },
    ];
    debugLogLLM("gpt-4.1-mini", `preprocess [${serviceName}]`, messages);
    const result = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages,
      max_completion_tokens: 2000,
      temperature: 0,
    });
    const cleaned = result.choices[0]?.message?.content?.trim() || rawText;
    debugLog(
      `Preprocess [${serviceName}]: ${rawText.length} chars → ${cleaned.length} chars`,
    );
    debugLogLLMResponse("gpt-4.1-mini", `preprocess [${serviceName}]`, cleaned);
    return cleaned;
  } catch (e) {
    console.error(
      `Preprocess failed for ${serviceName}:`,
      e instanceof Error ? e.message : e,
    );
    return rawText;
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

const GENERAL_CHAT_PROMPT = `Du bist ein erfahrener Meteorologe und Segelexperte. Du beantwortest Fragen zu Wetter, Meteorologie, Segeln, Windsystemen, Marine, Segelrevieren und Geographie.

THEMENEINSCHRÄNKUNG:
Du beantwortest AUSSCHLIESSLICH Fragen zu: Segeln, Wetter, Meteorologie, Windsysteme, Marine, Segelreviere, Geographie (Küsten, Meere, Seen, Inseln).
Bei allen anderen Fragen antworte: "Ich kann nur Segel- und Wetter-Fragen beantworten. Frage mich z.B. nach Segelrevieren oder lokalen Winden. Oder lade ein aktuelles Wolken-Foto oder Video hoch für meteorologische Analyse."

SEGELREVIERE die du kennst:
${SAILING_AREAS_SUMMARY}

WINDSYSTEME die du kennst:
${WIND_SYSTEMS_SUMMARY}

LOKALE WETTERDATEN:
Für folgende Länder sind lokale Wetterdienst-Daten angebunden: Österreich (GeoSphere Austria), Kroatien (DHMZ), Griechenland (EMY + OpenSkiron).
Für alle anderen europäischen Länder werden Windy-Karten und Europa-Übersichten (Meteonews, KNMI, Wetterzentrale) verwendet, aber keine nationalen Wetterdienst-Daten.

STIL:
- Deutsch, sachlich-professionell
- Bullet-Points wo sinnvoll
- Emojis sparsam zur Strukturierung
- Konkret und hilfreich, keine Floskeln
- Bei Segelfragen: praktische Tipps aus Segler-Perspektive
- Kurz und prägnant antworten, nicht übermäßig lang`;

const SECTION_STYLE = `STIL: Deutsch, sachlich-professionell. Bullet-Point-Stil, KURZ und PRÄGNANT. Verwende GROSSZÜGIG passende Emojis am Anfang jedes Bullets und im Text: 🌀 💨 🌊 ☀️ ⛅ ☁️ 🌥️ 🌧️ 🌦️ ⚠️ ⛈️ 🌡️ 🧭 🌬️ ❄️ 🔵 🔴 📍 ✅. Konkrete Zahlen, KEINE halluzinierten Werte. KEINE Begrüßung, KEINE Floskeln. Schreibe KEINE Überschrift — nur die Bullet-Points. KEIN Fettdruck (kein **text**), nur normaler Text.`;

const SECTION1_PROMPT = `Du bist ein Meteorologe. Beschreibe die aktuelle Großwetterlage über Europa.

Schreibe genau ZWEI Bullet-Points basierend ausschließlich auf dem METEONEWS-TEXT:
- Bullet 1: "- 🌀 [Druckgebilde über Europa]". 12-15 Wörter.
- Bullet 2: "- 🌡️ [Luftmassen — kalt/warm, feucht/trocken, Luftmassengrenze]". 12-15 Wörter. Quelle anhängen: [(meteonews.at)](https://meteonews.at/de/Allgemeine_Lage/K33/Europa)
JEDER Bullet MUSS mit "- " beginnen (Markdown-Bullet).
KEINE Schachtelsätze, KEINE Nebensätze. Kein Bezug zu einem konkreten Ort.

${SECTION_STYLE}`;

const SECTION2_PROMPT = `Du bist ein synoptischer Meteorologe. Analysiere AUSSCHLIESSLICH das beigefügte KNMI-Frontenbild (Bodenwetterkarte).

ANLEITUNG ZUM LESEN DER KNMI-KARTE:
- Die Karte zeigt Europa mit Isobaren (Linien gleichen Luftdrucks), Druckzentren (H/L bzw. H/T) und Fronten
- Kaltfront: blaue Linie mit Dreiecken (zeigen in Zugrichtung)
- Warmfront: rote Linie mit Halbkreisen (zeigen in Zugrichtung)
- Okklusion: lila/violette Linie mit abwechselnd Dreiecken und Halbkreisen
- Isobaren: dünne blaue Linien mit Druckwerten in hPa
- Schau dir die GESAMTE Karte systematisch an, besonders die Region um den Zielort

Schreibe genau 2 KURZE Bullets, MAXIMAL 15 Wörter pro Bullet. STRIKT einhalten!
- Bullet 1: Große Fronten über Europa. Beispiel: "- 🌀 Kaltfront zog vor 10h von Nordatlantik über Skandinavien nach Südosten"
- Bullet 2: Nächste Front zum Zielort: Typ + Entfernung. Falls keine Front innerhalb 100km: "- ✅ Keine Fronten im Umkreis von 100km um [Zielort]. [(KNMI)](URL)"
- PFLICHT: Schreibe "vor Xh" in JEDEN Bullet — den Wert für X findest du im Context beim KNMI-Analysezeitpunkt
- NUR Fronten — KEINE Hoch-/Tiefdruckgebiete, KEINE Isobaren, KEINE Erklärungen
- Quelle am letzten Bullet: [(KNMI)](https://www.knmi.nl/nederland-nu/weer/waarschuwingen-en-verwachtingen/weerkaarten)
JEDER Bullet MUSS mit "- " beginnen. KEINE Schachtelsätze. KEINE langen Beschreibungen.

${SECTION_STYLE}`;

const SECTION3_PROMPT = `Du bist ein Segelwetter-Experte. Beschreibe NUR Wind und Wellen/Seezustand für den Zielort. KEINE Wolken, KEINE Temperaturen, KEINE Niederschläge.

Schreibe Bullets basierend auf dem REGIONALEN WETTERBERICHT, KEINE Schätzungen, KEINE erfundenen Werte! JEDER Bullet MUSS mit "- " beginnen (Markdown-Bullet):
1. Wind
- Je Wind-System ein Bullet, MAXIMAL 2 Bullets, KURZ (max 20 Wörter).
- Regionale Windsysteme nur wenn geographisch zutreffend (Bora, Jugo/Scirocco, Maestral, Meltemi, Föhn, Thermik, etc.)
- ZEITBEZUG: Verwende den konkreten Wochentag + Tageszeit statt "Heute/Nächste 12h". z.B. "Samstag Vormittag", "Sonntag Nachmittag", "Samstag Nacht".
- WINDWERTE VEREINFACHEN: Nur EINEN Durchschnittswert in kt + maximale Böe. NICHT mehrere Zwischenwerte auflisten!
  FALSCH: "Nächste 12h: 10-20kt, lokal bis 26kt, am Velebit bis 30kt (Böen 55kt)" — zu viele Zahlen!
  RICHTIG: "Samstag Vormittag: 15kt (Böen 55kt)" — nur Durchschnitt + max Böe.
- Beispiele: "- 💨 Samstag Vormittag: Bora (NE) 15kt (Böen 55kt)", "- 💨 Sonntag: NW 8kt"
- PFLICHT: Wenn Böen/gusts im Wetterbericht erwähnt werden, MÜSSEN sie in Klammern angegeben werden!
- Windstärke in Knoten (kt). KEIN Bft — der Bericht enthält bereits kt-Werte.
- Falls der Wetterbericht KEINE Windstärke in kt enthält: schreibe "- 💨 Winddetails nicht im regionalen Bericht verfügbar — siehe Windy-Karte". Erfinde NIEMALS Windwerte!
2. Letzter Bullet: "- 🌊 Seegang: Douglas [Zahl]-[Zahl], [Beschreibung]" — nur wenn der regionale Wetterbericht EXPLIZIT Seegangsdaten enthält, ansonsten Verweis dass Daten nicht enthalten. NIEMALS Seegang aus Windstärke schätzen! KEINE Wellenhöhe in Metern. Douglas-Skala: 1=ruhig, 2=leicht bewegt, 3=leicht (slight), 4=mäßig (moderate), 5=rau (rough), 6=sehr rau. Beispiel: "- 🌊 Seegang: Douglas 3-4, leicht bis mäßig".
WICHTIG: Schreibe AUSSCHLIESSLICH über Wind und Wellen. Keine weiteren Themen. JEDER Bullet beginnt mit "- ".

${SECTION_STYLE}`;

const SECTION4_PROMPT = `Du bist ein Meteorologe. Beschreibe NUR Bewölkung, Regen und Gewitterrisiko für den Zielort. KEIN Wind, KEINE Temperaturen, KEIN Seezustand.

Schreibe GENAU 1 Bullet (max 15 Wörter). MUSS mit "- " beginnen:
- Bewölkung + Niederschlag + Gewitterrisiko kompakt in einem Satz, mit Zeitbezug
- KEINE Quellenangabe schreiben — die Quelle wird automatisch angehängt
- WICHTIG: Falls der regionale Wetterbericht "(NICHT VERFÜGBAR)" ist, schreibe NUR: "- Regionaler Wetterbericht nicht verfügbar". Erfinde KEINE Wetterdaten.

${SECTION_STYLE}`;

const SECTION5_PROMPT = `Du bist ein Meteorologe. Schreibe GENAU 1 Bullet mit Temperaturen für heute und morgen in einem Satz.

Format: "- 🌡️ Heute: bis [Höchstwert]°C, nachts [Tiefstwert]°C, morgen bis [Höchstwert]°C"
- KEINE Quellenangabe schreiben — die Quelle wird automatisch angehängt
- NUR Temperaturwerte verwenden die EXPLIZIT als Grad-Celsius-Zahlen im REGIONALEN WETTERBERICHT stehen (z.B. "15°C", "Höchstwerte um 14 Grad", "highs around 16"). KEINE Schätzungen, KEINE Ableitungen aus Wetterlage!
- AUSSCHLIESSLICH Temperaturen — KEINE Wolken, KEIN Regen, KEIN Wind, KEINE Bewölkung, KEINE Niederschläge
- Falls KEINE expliziten Temperaturzahlen im Wetterbericht: "- 🌡️ Temperatur: nicht verfügbar"
- Schreibe NUR diesen einen Bullet, NICHTS ANDERES.

${SECTION_STYLE}`;

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  app.post("/api/geocode", async (req, res) => {
    debugLogRequestSeparator(
      `POST /api/geocode — ${req.body?.location || "unknown"}`,
    );
    const parsed = geocodeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "Invalid request. Please provide a location." });
    }

    const { location } = parsed.data;

    try {
      const geocoded = await geocodeLocation(location);
      if (!geocoded) {
        return res.status(404).json({ error: "Location not found." });
      }

      const service = geocoded.countryCode
        ? getRegionalService(geocoded.countryCode)
        : undefined;

      return res.json({
        ...geocoded,
        warningUrl: service?.warningUrl,
        warningLabel: service?.warningLabel,
      });
    } catch {
      return res.status(500).json({ error: "Failed to geocode location." });
    }
  });


  const upload = multer({
    dest: "/tmp/uploads",
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = [
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/heic",
        "image/heif",
        "video/mp4",
        "video/quicktime",
        "video/webm",
      ];
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

## 🌧️ Regen
(PFLICHT — immer vorhanden. Ist Niederschlag sichtbar? Regen, Nieselregen, Virga (Fallstreifen), nasse Oberflächen, Regenschleier am Horizont? Wenn ja: Art, Intensität, Richtung. Wenn nein: kurz begründen warum kein Regen zu erwarten ist basierend auf den erkannten Wolkentypen.)

## 🌊 Wellen
(PFLICHT — immer vorhanden. Wenn Wasser sichtbar: Wellentyp, geschätzte Höhe, Periode, Beschaffenheit der Oberfläche. Wenn kein Wasser sichtbar: schreibe nur „—".)

## 🌫️ Bedeckungsgrad
(Okta-Angabe + kurze Beschreibung)

## 🌤️ Typische Wetterentwicklung
(Was ist meteorologisch zu erwarten? Kurz und klar.)

STIL: Deutsch, sachlich, ohne Wiederholungen.`;

  app.get("/api/analysis-json", (_req, res) => {
    if (!lastAnalysisFilePath || !fs.existsSync(lastAnalysisFilePath)) {
      return res.status(404).json({ error: "Keine Analyse verfügbar" });
    }
    const filename = path.basename(lastAnalysisFilePath);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/json");
    fs.createReadStream(lastAnalysisFilePath).pipe(res);
  });

  app.post("/api/upload", upload.single("photo"), async (req, res) => {
    debugLogRequestSeparator(
      `POST /api/upload — ${req.file?.originalname || "no file"}`,
    );
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

      sendSSE({
        status: isVideo
          ? "📹 Video empfangen — analysiere Metadaten..."
          : "📷 Foto empfangen — analysiere Metadaten...",
      });

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
      } else if (
        req.file.mimetype === "image/jpeg" ||
        req.file.mimetype === "image/png"
      ) {
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
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
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
        sendSSE({
          status: `📍 GPS gefunden: ${exifLocation.lat.toFixed(4)}°N, ${exifLocation.lon.toFixed(4)}°E`,
        });
        metadataInfo += `\nGPS-Koordinaten aus EXIF: ${exifLocation.lat.toFixed(4)}°N, ${exifLocation.lon.toFixed(4)}°E`;

        const geocoded = await reverseGeocode(
          exifLocation.lat,
          exifLocation.lon,
        );
        if (geocoded) {
          sendSSE({ location: geocoded });
          exifLocationName =
            geocoded.cityName || geocoded.displayName.split(",")[0].trim();
          exifCountryCode = geocoded.countryCode || null;
          metadataInfo += `\nOrt: ${geocoded.displayName}`;
        }
      }

      if (exifTime) {
        metadataInfo += `\nAufnahmezeitpunkt: ${exifTime}`;
      }

      if (isVideo) {
        sendSSE({
          videoMeta: {
            thumbnailBase64: videoThumbnailBase64,
            time: exifTime,
            locationName: exifLocationName,
            countryCode: exifCountryCode,
          },
        });
      } else {
        sendSSE({
          exifMeta: {
            time: exifTime,
            locationName: exifLocationName,
            countryCode: exifCountryCode,
          },
        });
      }

      if (!exifLocation && !exifTime && !isVideo) {
        sendSSE({ status: "ℹ️ Keine GPS/Zeit-Metadaten im Bild gefunden" });
      }

      const systemPrompt = PHOTO_ANALYSIS_PROMPT;

      if (isVideo) {
        sendSSE({ status: "🔍 Analysiere Video mit Gemini 2.5 Flash..." });

        const base64Video = fileBuffer.toString("base64");
        const videoPrompt =
          systemPrompt
            .replace(/\bBild\b/g, "Video")
            .replace(
              "## 🌫️ Bedeckungsgrad",
              "## 💨 Windgeschwindigkeit\n(Schätze die Windstärke anhand sichtbarer Hinweise: Baumbeweigung, Wasserkräuselung, Gischt, Flaggen, Wellenhöhe, Schaumstreifen. Gib Windstärke NUR in Knoten (kt) an, mit kurzer Begründung der Schätzung. KEINE Beaufort-Angabe.)\n\n## 🌫️ Bedeckungsgrad",
            ) +
          "\n\nBesonders beachten bei Videos:\n- Wolkenbewegung und -entwicklung über die Zeit\n- Wellenmuster und Windstärke auf dem Wasser\n- Veränderungen in Lichtverhältnissen und Sichtweite\n- Dynamische Wetterphänomene (ziehende Fronten, aufbauende Konvektion)";

        let vidText = "";
        try {
          const geminiContents = [
            {
              role: "user",
              parts: [
                {
                  inlineData: {
                    mimeType: req.file!.mimetype,
                    data: base64Video,
                  },
                },
                {
                  text: "Analysiere dieses Video meteorologisch. Achte besonders auf Bewegungen und zeitliche Entwicklungen.",
                },
              ],
            },
          ];
          debugLogLLM(
            "gemini-2.5-flash",
            "video analysis",
            geminiContents,
            videoPrompt,
          );
          const result = await gemini.models.generateContent({
            model: "gemini-2.5-flash",
            contents: geminiContents,
            config: { systemInstruction: videoPrompt },
          });
          vidText = result.text || "";
          debugLogLLMResponse("gemini-2.5-flash", "video analysis", vidText);
        } catch (geminiErr) {
          console.warn(
            "Gemini video analysis failed, falling back to GPT-4.1 Vision with thumbnail:",
            geminiErr instanceof Error ? geminiErr.message : geminiErr,
          );
        }

        if (!vidText && videoThumbnailBase64) {
          sendSSE({
            status: "🔍 Analysiere Video-Standbild mit GPT-4.1 Vision...",
          });
          const fallbackMessages: OpenAI.ChatCompletionMessageParam[] = [
            { role: "system", content: videoPrompt },
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: {
                    url: `data:image/jpeg;base64,${videoThumbnailBase64}`,
                    detail: "high",
                  },
                },
                {
                  type: "text",
                  text: "Analysiere dieses Video-Standbild meteorologisch.",
                },
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
          const fallbackContent =
            fallbackRes.choices[0]?.message?.content || "";
          debugLogLLMResponse("gpt-4.1", "video fallback", fallbackContent);
          if (fallbackContent) {
            vidText = `> ⚠️ *Video-Analyse nicht verfügbar — Analyse basiert auf einem Standbild (1. Sekunde).*\n\n${fallbackContent}`;
          }
        }

        if (vidText) {
          sendSSE({ content: vidText });
          lastPhotoAnalysis = { text: vidText, date: new Date().toLocaleString("de-AT", { timeZone: "Europe/Vienna" }), locationName: exifLocationName ?? undefined };
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
        if (imgText) {
          sendSSE({ content: imgText });
          lastPhotoAnalysis = { text: imgText, date: new Date().toLocaleString("de-AT", { timeZone: "Europe/Vienna" }), locationName: exifLocationName ?? undefined };
        }
      }

      sendSSE({ done: true });
      res.end();

      try {
        fs.unlinkSync(filePath);
      } catch {}
    } catch (error) {
      console.error("Upload analysis error:", error);
      if (res.headersSent) {
        sendSSE({ error: "Fehler bei der Bildanalyse" });
        res.end();
      } else {
        res.status(500).json({ error: "Failed to analyze image" });
      }
      try {
        if (req.file) fs.unlinkSync(req.file.path);
      } catch {}
    }
  });

  app.post("/api/chat", async (req, res) => {
    const { message, history, currentLocation } = req.body;
    debugLogRequestSeparator(
      `POST /api/chat — "${(message || "").slice(0, 80)}"`,
    );

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
      const activeLocationName =
        currentLocation?.displayName?.split(",")[0]?.trim() ||
        lastAnalysisContext?.location;
      const classification = await classifyMessage(
        message,
        hasActiveLocation,
        anthropic,
        activeLocationName,
      );

      if (classification.type === "OFFTOPIC") {
        sendSSE({
          content:
            "Ich kann nur Segel- und Wetter-Fragen beantworten. Frage mich z.B. nach Segelrevieren oder lokalen Winden. Oder lade ein aktuelles Wolken-Foto oder Video hoch für meteorologische Analyse.",
        });
        sendSSE({ done: true });
        res.end();
        return;
      }

      if (classification.type === "CHAT") {
        const chatHistory = (history || []).map(
          (m: { role: string; content: string }) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          }),
        );

        let userContent = message;
        let systemPrompt = GENERAL_CHAT_PROMPT;
        if (currentLocation) {
          systemPrompt += `\n\nWICHTIG: Es ist ein Ort aktiv (${currentLocation.displayName}, ${currentLocation.lat.toFixed(2)}°N, ${currentLocation.lon.toFixed(2)}°E). Beantworte allgemeine Segelfragen mit Bezug auf diesen Ort. Antworte kurz und präzise.`;
        }
        if (lastAnalysisContext) {
          systemPrompt += `\n\nLETZTE WETTERANALYSE (${lastAnalysisContext.date}, ${lastAnalysisContext.location}):\n`;
          systemPrompt += `\n--- META ---\n${lastAnalysisContext.meta}\n`;
          systemPrompt += `\n--- ANALYSE-ERGEBNIS (5 Sektionen) ---\n`;
          for (const [section, text] of Object.entries(
            lastAnalysisContext.sections,
          )) {
            systemPrompt += `${section}: ${text}\n`;
          }
          systemPrompt += `\n--- WETTERDATEN (preprocessed) ---\n${lastAnalysisContext.preprocessed}\n`;
          systemPrompt += `\nDer Benutzer kann Rückfragen zu dieser Analyse stellen. Beantworte sie basierend auf den obigen Daten. Du kennst das verwendete Wettermodell, die Koordinaten, die Wetterdaten und alle Details der Analyse.`;
        }
        if (lastPhotoAnalysis) {
          systemPrompt += `\n\nLETZTE FOTO/VIDEO-ANALYSE (${lastPhotoAnalysis.date}${lastPhotoAnalysis.locationName ? `, ${lastPhotoAnalysis.locationName}` : ""}):\n${lastPhotoAnalysis.text}\n`;
          systemPrompt += `\nDer Benutzer kann Rückfragen zu diesem Foto/Video stellen. Beantworte sie basierend auf der obigen Analyse (Wolkentypen, Regen, Wellen, Bedeckungsgrad, Wetterentwicklung).`;
        }

        const chatMessages: Anthropic.MessageParam[] = [
          ...chatHistory.map((m: { role: string; content: string }) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          })),
          { role: "user", content: userContent },
        ];

        debugLogLLM("claude-sonnet-4-6", "general chat", chatMessages);
        const chatResponse = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 2048,
          temperature: 0.3,
          system: systemPrompt,
          messages: chatMessages,
        });
        const chatText =
          chatResponse.content[0]?.type === "text"
            ? chatResponse.content[0].text
            : "";
        debugLogLLMResponse("claude-sonnet-4-6", "general chat", chatText);
        if (chatText) sendSSE({ content: chatText });

        sendSSE({ done: true });
        res.end();
        return;
      }

      if (classification.type === "UNCLEAR") {
        sendSSE({
          content:
            'Welchen Ort meinst du? Nenne mir einen konkreten Ort, Hafen oder See — z.B. "Punat", "Gardasee" oder "Split".',
        });
        sendSSE({ done: true });
        res.end();
        return;
      }

      if (!classification.location) {
        sendSSE({
          content:
            'Welchen Ort meinst du? Nenne mir einen konkreten Ort, Hafen oder See — z.B. "Punat", "Gardasee" oder "Split".',
        });
        sendSSE({ done: true });
        res.end();
        return;
      }

      // ── Ortserkennung (mit persistentem Cache) ──────────────────────────
      const userInput = classification.location;
      const cached = getCachedLocation(userInput);

      let sailingAreaObj: import("./analysis-store.js").AnalysisPosition["sailingArea"] = null;
      let cityObj: import("./analysis-store.js").AnalysisPosition["city"];
      let countryCode: string;

      if (cached) {
        console.log(`[location-cache] HIT "${userInput}" → ${cached.city} (${cached.cityLat.toFixed(4)}, ${cached.cityLon.toFixed(4)})`);
        if (cached.sailingArea) {
          for (const [, landData] of Object.entries(sailingAreasData as Record<string, { reviere: Array<{ deutsch: string; typ: string; lat: number; lon: number; windyModel: string; [key: string]: unknown }> }>)) {
            const revier = landData.reviere.find((r) => r.deutsch === cached.sailingArea);
            if (revier) {
              sailingAreaObj = {
                name_de: revier.deutsch,
                type: revier.typ === "meer" ? "sea" : "lake",
                coordinates: { lat: revier.lat, lon: revier.lon },
              };
              break;
            }
          }
        }
        cityObj = {
          name_de: cached.city,
          coordinates: { lat: cached.cityLat, lon: cached.cityLon },
        };
        countryCode = cached.countryCode;
      } else {
        sendSSE({ loadingStatus: "Suche Segelrevier" });
        const detected = await detectLocation(userInput, anthropic);

        if (detected === null) {
          sendSSE({
            content: `Für „${userInput}" konnte ich keinen bekannten Ort finden. Bitte versuche einen konkreteren Namen, z.B. „Split in Kroatien" oder „Traunsee".`,
          });
          sendSSE({ done: true });
          res.end();
          return;
        }

        const cityNameFromSonnet = detected.city;
        const hintCoords =
          detected.kind === "revier"
            ? { lat: detected.revier.lat, lon: detected.revier.lon }
            : undefined;
        const geocodedCity = await geocodeLocation(
          cityNameFromSonnet,
          hintCoords,
        );

        if (detected.kind === "revier") {
          sailingAreaObj = {
            name_de: detected.revier.deutsch,
            type: detected.revier.typ === "meer" ? "sea" : "lake",
            coordinates: { lat: detected.revier.lat, lon: detected.revier.lon },
          };
        }

        const cityFallbackCoords = hintCoords ?? null;
        cityObj = geocodedCity
          ? {
              name_de: geocodedCity.cityName ?? cityNameFromSonnet,
              coordinates: { lat: geocodedCity.lat, lon: geocodedCity.lon },
            }
          : {
              name_de: cityNameFromSonnet,
              coordinates: cityFallbackCoords ?? { lat: 0, lon: 0 },
            };

        countryCode =
          (detected.kind === "revier" ? detected.countryCode : null)
          ?? geocodedCity?.countryCode
          ?? "";

        const finalCoords = sailingAreaObj?.coordinates ?? cityObj.coordinates;
        if (finalCoords.lat !== 0 || finalCoords.lon !== 0) {
          setCachedLocation(userInput, {
            sailingArea: sailingAreaObj?.name_de ?? null,
            city: cityObj.name_de,
            cityLat: cityObj.coordinates.lat,
            cityLon: cityObj.coordinates.lon,
            displayName: geocodedCity?.displayName ?? cityNameFromSonnet,
            countryCode,
          });
        }
      }
      const coords = sailingAreaObj?.coordinates ?? cityObj.coordinates;
      const lat = coords.lat;
      const lon = coords.lon;

      if (lat === 0 && lon === 0) {
        console.warn(`[geocode] Failed to geocode "${cityObj.name_de}" — no coordinates available`);
        sendSSE({
          content: `Für „${userInput}" konnten keine Koordinaten ermittelt werden. Bitte versuche es mit einem konkreteren Ortsnamen (z.B. Stadt oder Hafen).`,
        });
        sendSSE({ done: true });
        res.end();
        return;
      }

      const country =
        Object.entries(LAND_TO_COUNTRY_CODE).find(
          ([, v]) => v === countryCode,
        )?.[0] ?? countryCode;

      const displayName = cached?.displayName ?? cityObj.name_de;
      const revierModel = sailingAreaObj
        ? (() => {
            for (const [, landData] of Object.entries(sailingAreasData as Record<string, { reviere: Array<{ deutsch: string; windyModel: string; [key: string]: unknown }> }>)) {
              const r = landData.reviere.find((rv) => rv.deutsch === sailingAreaObj.name_de);
              if (r) return resolveWindyModel(r.windyModel);
            }
            return null;
          })()
        : null;
      const countryModel = countryCode ? getModelForCountry(countryCode) : null;
      const fallbackModel = (!revierModel && !countryModel && lat !== 0)
        ? getRegionalModelFallback(lat, lon)
        : null;
      const regional = revierModel ?? countryModel ?? fallbackModel;
      if (!regional) {
        sendSSE({
          content: `Für „${userInput}" konnte kein Wettermodell bestimmt werden. Bitte versuche einen konkreteren Ortsnamen.`,
        });
        sendSSE({ done: true });
        res.end();
        return;
      }

      // SSE location object (frontend-compatible)
      const geocoded = {
        lat,
        lon,
        displayName,
        countryCode,
        cityName:
          cityObj.name_de ||
          sailingAreaObj?.name_de ||
          displayName.split(",")[0].trim(),
        cityLat: cityObj.coordinates.lat,
        cityLon: cityObj.coordinates.lon,
        regionalModel: regional.model,
        regionalModelLabel: regional.label,
        sailingArea: sailingAreaObj?.name_de ?? null,
        type: sailingAreaObj?.type ?? null,
        country,
        location: cityObj.name_de,
        userInput,
      };

      sendSSE({ location: geocoded });
      sendSSE({ loadingStatus: "Lade Europa Wetterkarten" });

      // ── Analysis JSON ──────────────────────────────────────────────────────
      const analysis = createAnalysis({
        userInput,
        country,
        countryCode,
        windyModel: regional.label,
        sailingArea: sailingAreaObj,
        city: cityObj,
      });

      // ── Wetterdaten scrapen ───────────────────────────────────────────────

      const saLat = sailingAreaObj?.coordinates.lat ?? cityObj.coordinates.lat;
      const saLon = sailingAreaObj?.coordinates.lon ?? cityObj.coordinates.lon;
      analysis.data.sources.windy.push(...getWindySources(regional, { lat: saLat, lon: saLon }, sailingAreaObj?.name_de ?? cityObj.name_de));

      const meteonewsText = await fetchMeteonews();
      analysis.data.weatherRaw["generalWeather"] = {
        source: "meteonews",
        text_de: meteonewsText || null,
      };
      if (meteonewsText) {
        const preprocessed = await preprocessMeteonews(
          meteonewsText,
          anthropic,
        );
        analysis.data.weatherPreprocessed.europe["generalWeather"] = {
          source: "meteonews",
          text_de: preprocessed || null,
        };
      } else {
        analysis.data.weatherPreprocessed.europe["generalWeather"] = {
          source: "meteonews",
          text_de: null,
        };
      }
      const localTz = COUNTRY_TIMEZONE[countryCode] || "Europe/Berlin";
      const fmtLocal = (d: Date) =>
        new Intl.DateTimeFormat("de-DE", {
          day: "2-digit", month: "2-digit", year: "numeric",
          hour: "2-digit", minute: "2-digit",
          timeZone: localTz,
        }).format(d);
      const runUtc = currentRunDate();
      const fcTarget = nextForecastTarget();
      const currentTs = `Aktuell ${fmtLocal(runUtc)} Ortszeit`;
      const forecastTs = `Forecast ${fmtLocal(fcTarget)} Ortszeit`;

      const wz850Current = await fetchWetterzentraleChart(
        buildWetterzentraleCurrentUrl(),
      );
      analysis.data.weatherPreprocessed.europe["temp850hpaCurrent"] = {
        source: "Wetterzentrale",
        url: wz850Current?.url ?? null,
        imageBase64: wz850Current?.imageBase64 ?? null,
        timestamp: currentTs,
      };
      const wz850Forecast = await fetchWetterzentraleChart(
        buildWetterzentraleForecastUrl(),
      );
      analysis.data.weatherPreprocessed.europe["temp850hpaForecast"] = {
        source: "Wetterzentrale",
        url: wz850Forecast?.url ?? null,
        imageBase64: wz850Forecast?.imageBase64 ?? null,
        timestamp: forecastTs,
      };
      const knmi = await fetchKnmiChart();
      analysis.data.weatherPreprocessed.europe["frontCurrent"] = {
        source: "KNMI",
        url: knmi?.url ?? null,
        imageBase64: knmi?.imageBase64 ?? null,
        timestamp: currentTs,
      };
      const knmiForecast = await fetchKnmiForecast();
      analysis.data.weatherPreprocessed.europe["frontForecast"] = {
        source: "KNMI",
        url: knmiForecast?.url ?? null,
        imageBase64: knmiForecast?.imageBase64 ?? null,
        timestamp: forecastTs,
      };

      analysis.data.sources.europe.push(...getEuropeSources());

      const knmiUtcHour = Math.floor(new Date().getUTCHours() / 6) * 6;
      const knmiUtcDate = new Date();
      knmiUtcDate.setUTCHours(knmiUtcHour, 0, 0, 0);
      const tz = COUNTRY_TIMEZONE[countryCode] || "Europe/Berlin";
      const frontCurrentLocalTime = new Intl.DateTimeFormat("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: tz,
      }).format(knmiUtcDate);

      sendSSE({
        weatherEurope: {
          frontCurrentBase64: knmi?.imageBase64 ?? null,
          frontCurrentUrl: knmi?.url ?? null,
          frontCurrentLocalTime,
        },
      });
      analysis.save();
      sendSSE({ loadingStatus: `Lade lokale Wetterdaten für ${country || "unbekanntes Land"}` });

      const national = await fetchNationalWeather(
        countryCode,
        { lat, lon },
        sailingAreaObj?.name_de ?? null,
        sailingAreaObj,
        cityObj,
        country,
        (status) => sendSSE({ loadingStatus: status }),
      );
      Object.assign(analysis.data.weatherRaw, national.data);
      for (const u of national.sourceUrls)
        analysis.data.sources.national.push(u);
      if (national.openskironMeta) {
        analysis.data.position.openskiron_domain = national.openskironMeta;
      }
      const nationalPre = await preprocessNationalWeather(
        analysis.data.weatherRaw,
        anthropic,
        countryCode,
      );
      Object.assign(analysis.data.weatherPreprocessed.national, nationalPre);
      const localPre = await preprocessLocalWeather(
        analysis.data.weatherRaw,
        {
          userInput: analysis.data.position.userInput,
          city: cityObj.name_de,
          sailingArea: sailingAreaObj?.name_de ?? null,
        },
        anthropic,
        countryCode,
      );
      Object.assign(analysis.data.weatherPreprocessed.local, localPre);
      analysis.save();

      sendSSE({ loadingStatus: "Interpretieren der lokalen Wetterdaten" });
      const weatherOutput = await generateWeatherOutput(
        analysis.data,
        anthropic,
      );
      Object.assign(analysis.data.weatherOutput, weatherOutput);
      analysis.save();
      sendSSE({ weatherOutput, sources: analysis.data.sources });

      const analysisLabel =
        sailingAreaObj?.name_de ??
        cityObj.name_de ??
        displayName.split(",")[0].trim();
      lastAnalysisFilePath = analysis.filePath;

      const metaLines: string[] = [];
      metaLines.push(`Ort: ${analysisLabel}`);
      metaLines.push(`Land: ${country} (${countryCode})`);
      metaLines.push(`Segelrevier: ${sailingAreaObj?.name_de ?? "nicht erkannt"}`);
      metaLines.push(`Stadt: ${cityObj.name_de} (${cityObj.coordinates.lat.toFixed(2)}°N, ${cityObj.coordinates.lon.toFixed(2)}°E)`);
      metaLines.push(`Windmodell: ${regional.label}`);
      if (sailingAreaObj?.coordinates) {
        metaLines.push(`Revier-Koordinaten: ${sailingAreaObj.coordinates.lat.toFixed(2)}°N, ${sailingAreaObj.coordinates.lon.toFixed(2)}°E`);
      }

      const preParts: string[] = [];
      const pre = analysis.data.weatherPreprocessed;
      if (pre.europe?.generalWeather?.text_de) {
        preParts.push(`EUROPA-WETTERLAGE:\n${pre.europe.generalWeather.text_de}`);
      }
      if (pre.national) {
        for (const [k, v] of Object.entries(pre.national)) {
          if (v && typeof v === "object" && "text_de" in v && v.text_de) {
            preParts.push(`${k.toUpperCase()}:\n${v.text_de}`);
          }
        }
      }
      if (pre.local) {
        for (const [k, v] of Object.entries(pre.local)) {
          if (v && typeof v === "object" && "text_de" in v && typeof v.text_de === "string" && v.text_de) {
            preParts.push(`LOKAL ${k.toUpperCase()}:\n${v.text_de}`);
          }
        }
      }

      lastAnalysisContext = {
        location: analysisLabel,
        date: new Date().toLocaleString("de-AT", {
          timeZone: COUNTRY_TIMEZONE[countryCode] || "Europe/Vienna",
        }),
        sections: {},
        meta: metaLines.join("\n"),
        preprocessed: preParts.join("\n\n").slice(0, 6000),
      };
      for (const [key, value] of Object.entries(weatherOutput)) {
        if (typeof value === "string")
          lastAnalysisContext.sections[key] = value;
      }

      // ── Chat-Ausgabe ───────────────────────────────────────────────────────
      const flag = countryFlag(countryCode);
      sendSSE({ content: `Wetteranalyse für **${analysisLabel}** ${flag}` });

      sendSSE({ done: true });
      res.end();
    } catch (error) {
      console.error("Chat error:", error);
      const errMsg = error instanceof Error ? error.message : "Fehler bei der Wetteranalyse";
      if (res.headersSent) {
        sendSSE({ error: errMsg });
        res.end();
      } else {
        res.status(500).json({ error: errMsg });
      }
    }
  });

  return httpServer;
}
