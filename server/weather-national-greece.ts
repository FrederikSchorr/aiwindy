import Anthropic from "@anthropic-ai/sdk";
import { spawn } from "child_process";
import sailingAreasJson from "../data/sailingareas.json" with { type: "json" };
import { cacheGet, cacheSet } from "./cache-db.js";

// ── Constants ─────────────────────────────────────────────────────────────────

export const HNMS_BULLETIN_URL = "http://newportal.hnms.gr/emy/en/navigation/naftilia_deltio_thalasson_ektiposi";
export const HNMS_SOURCE_URL = "http://newportal.hnms.gr/emy/en/navigation/naftilia_deltio_thalasson_ektiposi";
export const OPENSKIRON_BASE_URL = "https://openskiron.org/gribs_wrf_4km/";
export const OPENSKIRON_SOURCE_URL = "https://openskiron.org/";

// All HNMS area headings that act as block separators (superset of our sailingareas)
const HNMS_AREA_HEADINGS = new Set([
  "NORTH ADRIATIC", "CENTRAL ADRIATIC", "SOUTH ADRIATIC", "BOOT",
  "MELITA", "GABES", "SIDRA",
  "NORTH IONIO", "SOUTH IONIO", "PATRAIKOS", "KORINTHIAKOS",
  "KITHIRA SEA", "SOUTHWEST KRITIKO", "SOUTHEAST KRITIKO IERAPETRA",
  "WEST KRITIKO", "EAST KRITIKO",
  "SARONIKOS", "SOUTH EVVOIKOS", "KAFIREAS STRAIT",
  "SOUTHWEST AEGEAN", "SOUTHEAST AEGEAN IKARIO", "SAMOS SEA",
  "CENTRAL AEGEAN", "NORTHWEST AEGEAN", "NORTHEAST AEGEAN",
  "RODOS SEA", "KARPATHIO", "KASTELLORIZO SEA",
  "THRAKIKO", "THERMAIKOS",
  "TAURUS", "DELTA", "CRUSADE",
  "MARMARA", "WEST BLACK SEA", "EAST BLACK SEA",
]);

const MONTHS: Record<string, number> = {
  JANUARY: 0, FEBRUARY: 1, MARCH: 2, APRIL: 3, MAY: 4, JUNE: 5,
  JULY: 6, AUGUST: 7, SEPTEMBER: 8, OCTOBER: 9, NOVEMBER: 10, DECEMBER: 11,
};

const DAY_NAMES: Record<number, string> = {
  0: "So", 1: "Mo", 2: "Di", 3: "Mi", 4: "Do", 5: "Fr", 6: "Sa",
};

type SailingAreaObj = { name_de: string; type: "sea" | "lake"; coordinates: { lat: number; lon: number } } | null | undefined;
type CityObj = { name_de: string; coordinates: { lat: number; lon: number } } | null | undefined;

// ── HNMS Fetch ────────────────────────────────────────────────────────────────

async function fetchHnmsGaleWarning(): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(HNMS_BULLETIN_URL, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/html" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.error(`HNMS gale fetch failed (${res.status})`);
      return { source: "HNMS", url: HNMS_BULLETIN_URL, text: null };
    }
    const html = await res.text();

    const printable = html.match(/id="printableArea">([\s\S]*?)<\/div>\s*<\/div>/i);
    if (!printable) {
      return { source: "HNMS", url: HNMS_BULLETIN_URL, text: null };
    }

    const text = printable[1]
      .replace(/<[^>]+>/g, "\n")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#\d+;/g, "")
      .split("\n").map(l => l.trim()).filter(Boolean)
      .filter(l => l !== "National Meteorological Center")
      .join("\n");

    return { source: "HNMS", url: HNMS_BULLETIN_URL, text: text || null };
  } catch (e) {
    console.error("fetchHnmsGaleWarning error:", e instanceof Error ? e.message : e);
    return { source: "HNMS", url: HNMS_BULLETIN_URL, text: null };
  }
}

// ── OpenSkiron Fetch ──────────────────────────────────────────────────────────

function getOpenskironDomain(sailingAreaNameDe: string): string | null {
  const reviere = (sailingAreasJson as any)["Griechenland"]?.reviere ?? [];
  const found = reviere.find((r: any) => r.deutsch === sailingAreaNameDe);
  return found?.openskiron_domain ?? null;
}

const OPENSKIRON_WRF_PAGE = "https://openskiron.org/en/openwrf";

async function discoverOpenskironUrl(domain: string): Promise<string | null> {
  try {
    const res = await fetch(OPENSKIRON_WRF_PAGE, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const escaped = domain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(
      `https://openskiron\\.org/gribs_wrf_4km/(${escaped}_WRF_WAM_[^"'<>\\s]+\\.grb\\.bz2)`,
    );
    const m = html.match(pattern);
    if (!m) return null;
    return `${OPENSKIRON_BASE_URL}${m[1]}`;
  } catch (e) {
    console.warn("[openskiron-discover] URL check failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

type OpenskironMeta = {
  domain: string;
  created: string;
  gribFile: "downloaded" | "cached" | "not needed";
  sailingAreaData: "extracted" | "cached";
  cityData: "extracted" | "cached";
};

async function fetchGreeceWindCloudRain(
  sailingAreaObj: NonNullable<SailingAreaObj>,
  cityObj: CityObj,
  onProgress?: (status: string) => void,
): Promise<{ windCloudRain: Record<string, unknown>; temperature: Record<string, unknown>; openskironMeta?: OpenskironMeta }> {
  const nullWindCloudRain = {
    source: "OpenSkiron WRF 4km", url: OPENSKIRON_BASE_URL,
    sailingArea: sailingAreaObj,
    timestamps: null, windSpeedKt: null, windDir: null, gustKt: null,
    rainMm: null, cape: null, cloudCover: null, waterTempC: null,
    waveHeightM: null, wavePeriodS: null, waveDir: null, swellHeightM: null,
  };
  const nullTemperature = {
    source: "OpenSkiron WRF 4km", url: OPENSKIRON_BASE_URL,
    city: cityObj ?? null,
    timestamps: null, temp2mC: null,
  };
  const nullResult = { windCloudRain: nullWindCloudRain, temperature: nullTemperature };

  const domain = getOpenskironDomain(sailingAreaObj.name_de);
  if (!domain) {
    console.error(`No openskiron_domain for: ${sailingAreaObj.name_de}`);
    return nullResult;
  }

  const windLat = sailingAreaObj.coordinates.lat;
  const windLon = sailingAreaObj.coordinates.lon;
  const cityLat = cityObj?.coordinates.lat ?? windLat;
  const cityLon = cityObj?.coordinates.lon ?? windLon;

  const sailingAreaCacheKey = `openskiron:sa:${domain}:${windLat.toFixed(4)}_${windLon.toFixed(4)}`;
  const cityCacheKey = `openskiron:city:${domain}:${cityLat.toFixed(4)}_${cityLon.toFixed(4)}`;

  const currentGribUrl = await discoverOpenskironUrl(domain);

  let cachedSailingArea: Record<string, unknown> | null = null;
  let cachedCity: Record<string, unknown> | null = null;
  let cachedCreated = "";

  if (currentGribUrl) {
    try {
      const [saRaw, cityRaw] = await Promise.all([
        cacheGet(sailingAreaCacheKey),
        cacheGet(cityCacheKey),
      ]);
      if (saRaw) {
        const sa = JSON.parse(saRaw);
        if (sa._gribUrl === currentGribUrl) {
          cachedSailingArea = sa.data;
          cachedCreated = sa.created ?? "";
          console.log(`[openskiron-cache] sailingArea HIT for ${domain}`);
        } else {
          console.log(`[openskiron-cache] sailingArea STALE for ${domain}`);
        }
      }
      if (cityRaw) {
        const city = JSON.parse(cityRaw);
        if (city._gribUrl === currentGribUrl) {
          cachedCity = city.data;
          if (!cachedCreated) cachedCreated = city.created ?? "";
          console.log(`[openskiron-cache] city HIT for ${domain}`);
        } else {
          console.log(`[openskiron-cache] city STALE for ${domain}`);
        }
      }
    } catch (e) {
      console.warn("[openskiron-cache] DB read error:", e);
    }
  }

  if (cachedSailingArea && cachedCity) {
    if (onProgress) onProgress("OpenSkiron Daten aus Cache geladen");
    return {
      windCloudRain: {
        source: "OpenSkiron WRF 4km", url: OPENSKIRON_BASE_URL,
        sailingArea: sailingAreaObj,
        ...cachedSailingArea,
      },
      temperature: {
        source: "OpenSkiron WRF 4km", url: OPENSKIRON_BASE_URL,
        city: cityObj ?? null,
        ...cachedCity,
      },
      openskironMeta: { domain, created: cachedCreated, gribFile: "not needed", sailingAreaData: "cached", cityData: "cached" },
    };
  }

  return new Promise((resolve, reject) => {
    const args = [
      "scripts/openskiron_fetch.py",
      domain,
      String(windLat), String(windLon),
      String(cityLat), String(cityLon),
    ];
    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const proc = spawn(pythonCmd, args, {
      env: { ...process.env, ECCODES_LOG_LEVEL: "0" },
    });
    proc.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT" && pythonCmd === "python3") {
        console.warn("python3 not found, retrying with python");
        const proc2 = spawn("python", args, {
          env: { ...process.env, ECCODES_LOG_LEVEL: "0" },
        });
        let stdout2 = "";
        let stderr2 = "";
        proc2.stdout.on("data", (d: Buffer) => { stdout2 += d.toString(); });
        proc2.stderr.on("data", (d: Buffer) => { stderr2 += d.toString(); });
        proc2.on("close", (code2: number | null) => {
          if (code2 === 0 && stdout2.trim()) {
            try { resolve(JSON.parse(stdout2)); } catch { resolve(null); }
          } else {
            console.error("openskiron_fetch (python fallback) failed:", stderr2);
            resolve(null);
          }
        });
        proc2.on("error", (err2: NodeJS.ErrnoException) => {
          if (err2.code === "ENOENT") {
            reject(new Error("Python ist nicht installiert. OpenSkiron-Wetterdaten für Griechenland können nicht berechnet werden. Bitte Python 3 installieren (python3)."));
          } else {
            reject(new Error(`OpenSkiron-Fehler: ${err2.message}`));
          }
        });
        return;
      }
      if (err.code === "ENOENT") {
        reject(new Error("Python ist nicht installiert. OpenSkiron-Wetterdaten für Griechenland können nicht berechnet werden. Bitte Python 3 installieren (python3)."));
      } else {
        reject(new Error(`OpenSkiron-Fehler: ${err.message}`));
      }
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      console.error("openskiron_fetch timed out after 60s");
    }, 60000);

    let downloadNotified = false;
    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => {
      const chunk = d.toString();
      stderr += chunk;
      if (!downloadNotified && chunk.includes("[download]") && onProgress) {
        downloadNotified = true;
        const urlMatch = chunk.match(/\[download\]\s+(\S+)/);
        const filename = urlMatch ? urlMatch[1].split("/").pop() : domain;
        onProgress(`Download der OpenSkiron Wetterdaten ${filename ?? domain}`);
      }
      if (chunk.includes("[extract]") && onProgress) {
        const extractMatch = chunk.match(/\[extract\]\s+(\S+)\s*(.*)/);
        const filename = extractMatch ? extractMatch[1] : domain;
        const created = extractMatch?.[2]?.trim() || "";
        onProgress(`Extrahiere lokale Daten aus ${filename}${created ? " " + created : ""}`);
      }
    });
    proc.on("close", (code: number | null) => {
      clearTimeout(timer);
      const didDownload = stderr.includes("[download]");
      const stderrClean = stderr
        .split("\n")
        .filter(l => !l.includes("missingValue") && !l.includes("Ignoring index file")
          && !l.includes("FutureWarning") && !l.includes("xarray_store")
          && !l.includes("RequestsDependencyWarning") && !l.includes("warnings.warn("))
        .join("\n")
        .trim();
      if (stderrClean) console.error("openskiron_fetch:", stderrClean);
      if (code !== 0 || !stdout.trim()) {
        console.error(`openskiron_fetch exited with code ${code}`);
        resolve(nullResult);
        return;
      }
      try {
        const jsonStart = stdout.indexOf('{');
        if (jsonStart < 0) throw new Error("No JSON object in stdout");
        const parsed = JSON.parse(stdout.slice(jsonStart));
        const created = parsed.created ?? "";

        const gribStatus: "downloaded" | "cached" = didDownload ? "downloaded" : "cached";
        const saStatus: "extracted" | "cached" = cachedSailingArea ? "cached" : "extracted";
        const cityStatus: "extracted" | "cached" = cachedCity ? "cached" : "extracted";

        const freshSailingArea = {
          timestamps: parsed.timestamps,
          windSpeedKt: parsed.windSpeedKt,
          windDir: parsed.windDir,
          gustKt: parsed.gustKt,
          rainMm: parsed.rainMm,
          cape: parsed.cape,
          cloudCover: parsed.cloudCover,
          waterTempC: parsed.waterTempC,
          waveHeightM: parsed.waveHeightM,
          wavePeriodS: parsed.wavePeriodS,
          waveDir: parsed.waveDir,
          swellHeightM: parsed.swellHeightM,
        };
        const freshCity = {
          timestamps: parsed.timestamps,
          temp2mC: parsed.temp2mC,
        };

        const finalSailingArea = cachedSailingArea ?? freshSailingArea;
        const finalCity = cachedCity ?? freshCity;

        const result = {
          windCloudRain: {
            source: "OpenSkiron WRF 4km", url: OPENSKIRON_BASE_URL,
            sailingArea: sailingAreaObj,
            ...finalSailingArea,
          },
          temperature: {
            source: "OpenSkiron WRF 4km", url: OPENSKIRON_BASE_URL,
            city: cityObj ?? null,
            ...finalCity,
          },
          openskironMeta: { domain, created, gribFile: gribStatus, sailingAreaData: saStatus, cityData: cityStatus } as OpenskironMeta,
        };

        if (currentGribUrl) {
          const saves: Promise<void>[] = [];
          if (!cachedSailingArea) {
            saves.push(
              cacheSet(sailingAreaCacheKey, JSON.stringify({ _gribUrl: currentGribUrl, created, data: freshSailingArea }))
                .then(() => console.log(`[openskiron-cache] sailingArea SAVED for ${domain}`)),
            );
          }
          if (!cachedCity) {
            saves.push(
              cacheSet(cityCacheKey, JSON.stringify({ _gribUrl: currentGribUrl, created, data: freshCity }))
                .then(() => console.log(`[openskiron-cache] city SAVED for ${domain}`)),
            );
          }
          Promise.all(saves).catch((e) => console.warn("[openskiron-cache] DB write error:", e));
        }

        resolve(result);
      } catch (e) {
        console.error("openskiron_fetch JSON parse error:", e instanceof Error ? e.message : e);
        resolve(nullResult);
      }
    });
    proc.on("error", (e: Error) => {
      clearTimeout(timer);
      console.error("openskiron_fetch spawn error:", e.message);
      resolve(nullResult);
    });
  });
}

// ── Main Fetch ────────────────────────────────────────────────────────────────

export async function fetchGreeceWeather(
  sailingAreaObj?: SailingAreaObj,
  cityObj?: CityObj,
  onProgress?: (status: string) => void,
): Promise<{ data: Record<string, unknown>; sourceUrls: string[]; openskironMeta?: OpenskironMeta }> {
  const [hnms, openskiron] = await Promise.all([
    fetchHnmsGaleWarning(),
    sailingAreaObj ? fetchGreeceWindCloudRain(sailingAreaObj, cityObj, onProgress) : null,
  ]);

  const data: Record<string, unknown> = { greeceMarineForecast: hnms };
  if (openskiron) {
    data["greeceWindWaveCloudRain"] = openskiron.windCloudRain;
    data["greeceTemperature"] = openskiron.temperature;
  }

  const sourceUrls = [
    `Griechenland Wetterlage und Warnungen von [HNMS](${HNMS_SOURCE_URL})`,
  ];
  if (openskiron) {
    sourceUrls.push(`Wind, Welle, Wolken, Regen, Gewitter, Temperatur von [OpenSkiron](${OPENSKIRON_SOURCE_URL}) API`);
  }

  return { data, sourceUrls, openskironMeta: openskiron?.openskironMeta };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseHnmsTimestamp(line: string): Date | null {
  const m = line.match(/(\d{1,2})\s+([A-Z]+)\s+(\d{4})\s*\/\s*(\d{2})(\d{2})\s+UTC/i);
  if (!m) return null;
  const [, day, mon, year, hh, mm] = m;
  const month = MONTHS[mon.toUpperCase()];
  if (month === undefined) return null;
  return new Date(Date.UTC(Number(year), month, Number(day), Number(hh), Number(mm)));
}

function formatAthenTime(date: Date): string {
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Athens",
    weekday: "short", day: "2-digit", month: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).format(date) + " Ortszeit";
}

function isAreaHeading(line: string): boolean {
  const upper = line.trim().toUpperCase();
  if (HNMS_AREA_HEADINGS.has(upper)) return true;
  for (const h of Array.from(HNMS_AREA_HEADINGS)) {
    if (upper.startsWith(h)) return true;
  }
  return false;
}

/** Convert UTC timestamp string to local label + hour using Intl (DST-aware). */
function toLocalDateHour(utcTs: string, tz: string): { label: string; hour: number } {
  const d = new Date(utcTs);
  const datePart = new Intl.DateTimeFormat("sv-SE", { timeZone: tz }).format(d);
  const hour = parseInt(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: tz }).format(d)) % 24;
  const parts = datePart.split("-");
  const dow = new Date(`${datePart}T12:00:00Z`).getUTCDay();
  const label = `${DAY_NAMES[dow]} ${parts[2]}.${parts[1]}`;
  return { label, hour };
}

// ── HNMS Preprocessing ────────────────────────────────────────────────────────

export async function preprocessGreeceNationalSynopsis(
  text: string | null,
  anthropic: Anthropic,
): Promise<Record<string, unknown>> {
  const nullResult = { "synopsis": { source: "HNMS", url: HNMS_BULLETIN_URL, text_de: null } };
  if (!text) return nullResult;

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      messages: [{
        role: "user",
        content: `Aus dieser Seewetter-Warnung: Extrahiere NUR den Abschnitt "GENERAL SYNOPSIS" (großräumige Wetterlage mit Druckgebieten und Positionen). IGNORIERE alle gebietsspezifischen Warnungen (z.B. KITHIRA SEA, SOUTHWEST KRITIKO etc.). Übersetze ins Deutsche, normale Groß-/Kleinschreibung. Behalte alle Druckwerte (hPa) bei. Datumsformat DD-MM-YY/HH bedeutet Tag-Monat-Jahr um HH:00 UTC. UTC-Zeiten auf griechische Ortszeit (UTC+3) umrechnen (z.B. "GENERAL SYNOPSIS 03-04-26/09 UTC" → "Großräumige Wetterlage 03.04. 12:00 Ortszeit", "03/21 UTC" bei Tag 03 → "03.04. 00:00 Ortszeit"). Antworte nur mit der Übersetzung, ohne Erklärungen.

${text}`,
      }],
    });
    const translated = (msg.content[0] as any)?.text?.trim() ?? null;
    return { "synopsis": { source: "HNMS", url: HNMS_BULLETIN_URL, text_de: translated } };
  } catch (e) {
    console.error("preprocessGreeceNationalSynopsis error:", e instanceof Error ? e.message : e);
    return nullResult;
  }
}

export async function extractGreeceWarning(
  galeData: Record<string, unknown> | null,
  emyName: string | null,
  anthropic: Anthropic,
): Promise<Record<string, unknown>> {
  if (!galeData || !emyName) {
    return { "warnings": { source: "HNMS", url: HNMS_BULLETIN_URL, sailingArea: emyName, text_de: "Aktuell: Keine Sturmwarnung von HNMS" } };
  }

  const text = galeData["text"] as string | null;
  if (!text) {
    return { "warnings": { source: "HNMS", url: HNMS_BULLETIN_URL, sailingArea: emyName, text_de: "Aktuell: Keine Sturmwarnung von HNMS" } };
  }

  const headerLine = text.split("\n").find(l => /ATHENS,.*\/\s*\d{4}\s+UTC/i.test(l)) ?? "";
  const headerDate = parseHnmsTimestamp(headerLine);
  const timeLabel = headerDate ? formatAthenTime(headerDate) : "";
  const noWarningText = timeLabel ? `Aktuell ${timeLabel}: Keine Sturmwarnung von HNMS` : "Aktuell: Keine Sturmwarnung von HNMS";

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      messages: [{
        role: "user",
        content: `Seewetter-Bulletin. Suche in PART 3 den Abschnitt für "${emyName}".

Extrahiere NUR echte Sturmwarnungen. Eine Sturmwarnung liegt nur vor wenn EINES dieser Schlüsselwörter im Text steht:
GALE, STORM, THUNDERSTORM, CHANCE OF THUNDERSTORM

WICHTIG: Normaler Segelwind ist KEINE Sturmwarnung! Wind bis Beaufort 7 (z.B. "NORTHWEST 5 OR 6", "NORTH 4 TO 7", "MODERATE", "ROUGH") ist normal und KEINE Warnung.

- Sturmwarnung gefunden: Antworte NUR mit dem übersetzten Warnungstext (z.B. "Gewittermöglichkeit im Westen"). Keine Erklärungen, keine Einleitung.
- Keine Sturmwarnung: Antworte mit genau "NONE"

Übersetzungsregeln: Deutsch, normale Groß-/Kleinschreibung. Keine Uhrzeiten nennen. Beaufort → Knoten.

${text}`,
      }],
    });
    const translated = (msg.content[0] as any)?.text?.trim() ?? null;
    if (!translated || translated === "NONE") {
      return { "warnings": { source: "HNMS", url: HNMS_BULLETIN_URL, sailingArea: emyName, text_de: noWarningText } };
    }
    const text_de = `Aktuell ${timeLabel ? timeLabel + " " : ""}Sturmwarnung von HNMS:\n${translated}`;
    return { "warnings": { source: "HNMS", url: HNMS_BULLETIN_URL, sailingArea: emyName, text_de } };
  } catch (e) {
    console.error("extractGreeceWarning error:", e instanceof Error ? e.message : e);
    return { "warnings": { source: "HNMS", url: HNMS_BULLETIN_URL, sailingArea: emyName, text_de: noWarningText } };
  }
}

// ── OpenSkiron Preprocessing ──────────────────────────────────────────────────

export async function preprocessGreeceLocalWind(
  rawData: Record<string, unknown>,
  anthropic: Anthropic,
): Promise<Record<string, unknown>> {
  const forecast = rawData["greeceWindWaveCloudRain"] as any;
  const url: string | null = forecast?.url ?? null;
  if (!forecast?.timestamps || !forecast?.windSpeedKt) {
    return { wind: { source: "OpenSkiron WRF 4km", url, text_de: null } };
  }

  const TZ = "Europe/Athens";
  type Row = { time: string; dir: string; spd: number; gust: number };
  const byDate = new Map<string, Row[]>();

  for (let i = 0; i < forecast.timestamps.length; i++) {
    const { label, hour } = toLocalDateHour(forecast.timestamps[i], TZ);
    if (hour < 6 || hour > 20) continue;
    if (!byDate.has(label)) byDate.set(label, []);
    byDate.get(label)!.push({
      time: `${String(hour).padStart(2, "0")}:00`,
      dir: forecast.windDir[i],
      spd: Math.round(forecast.windSpeedKt[i]),
      gust: Math.round(forecast.gustKt[i]),
    });
  }

  const days = Array.from(byDate.entries()).slice(0, 2);
  if (!days.length) return { wind: { source: "OpenSkiron WRF 4km", url, text_de: null } };

  const table = days
    .map(([label, rows]) => {
      const rowStr = rows.map(r => `${r.time} ${r.dir} ${r.spd}kt Böe ${r.gust}kt`).join("  ");
      return `${label}:\n${rowStr}`;
    })
    .join("\n\n");

  const prompt = `Du bist ein Segelwetter-Experte. Beschreibe den Windverlauf für jeden Tag in je einem deutschen Satz (max. 25 Wörter). Nenne Richtung, Stärke in Knoten, Böen und signifikante Änderungen im Tagesverlauf. Format: "Di 31.03: ...\nMi 01.04: ..."

${table}`;

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    });
    const text = (msg.content[0] as any)?.text?.trim() ?? null;
    return { wind: { source: "OpenSkiron WRF 4km", url, text_de: text } };
  } catch {
    return { wind: { source: "OpenSkiron WRF 4km", url, text_de: null } };
  }
}

const DOUGLAS_SCALE: { max: number; label: string }[] = [
  { max: 0.0,  label: "0 (glatt)" },
  { max: 0.1,  label: "1 (ruhig)" },
  { max: 0.5,  label: "2 (schwach bewegt)" },
  { max: 1.25, label: "3 (leicht bewegt)" },
  { max: 2.5,  label: "4 (mäßig bewegt)" },
  { max: 4.0,  label: "5 (grob)" },
  { max: 6.0,  label: "6 (sehr grob)" },
  { max: 9.0,  label: "7 (hoch)" },
  { max: 14.0, label: "8 (sehr hoch)" },
  { max: Infinity, label: "9 (phänomenal)" },
];

function toDouglasScale(heightM: number): string {
  for (const d of DOUGLAS_SCALE) {
    if (heightM <= d.max) return d.label;
  }
  return DOUGLAS_SCALE[DOUGLAS_SCALE.length - 1].label;
}

export async function preprocessGreeceLocalWave(
  rawData: Record<string, unknown>,
  anthropic: Anthropic,
): Promise<Record<string, unknown>> {
  const forecast = rawData["greeceWindWaveCloudRain"] as any;
  const url: string | null = forecast?.url ?? null;
  const src = "OpenSkiron WAM";
  if (!forecast?.timestamps || !forecast?.waveHeightM) {
    return { wave: { source: src, url, text_de: null } };
  }

  const hasAnyWave = (forecast.waveHeightM as (number | null)[]).some(
    (v: number | null) => v !== null && !isNaN(v),
  );
  if (!hasAnyWave) {
    return { wave: { source: src, url, text_de: null } };
  }

  const TZ = "Europe/Athens";
  type WaveRow = { hour: number; waveH: number; swellH: number | null; waveD: string | null; waveP: number | null };
  const byDate = new Map<string, WaveRow[]>();

  for (let i = 0; i < forecast.timestamps.length; i++) {
    const wh = forecast.waveHeightM[i];
    if (wh === null || isNaN(wh)) continue;
    const { label, hour } = toLocalDateHour(forecast.timestamps[i], TZ);
    if (hour < 6 || hour > 20) continue;
    if (!byDate.has(label)) byDate.set(label, []);
    byDate.get(label)!.push({
      hour,
      waveH: wh,
      swellH: forecast.swellHeightM?.[i] ?? null,
      waveD: forecast.waveDir?.[i] ?? null,
      waveP: forecast.wavePeriodS?.[i] ?? null,
    });
  }

  const days = Array.from(byDate.entries()).slice(0, 3);
  if (!days.length) return { wave: { source: src, url, text_de: null } };

  const table = days.map(([label, rows]) => {
    const rowStr = rows.map(r => {
      let line = `${String(r.hour).padStart(2, "0")}:00 Welle ${r.waveH.toFixed(1)}m=${toDouglasScale(r.waveH)}`;
      if (r.waveD) line += ` aus ${r.waveD}`;
      if (r.waveP !== null) line += ` Periode ${r.waveP.toFixed(1)}s`;
      if (r.swellH !== null && r.swellH > 0.1) line += ` Dünung ${r.swellH.toFixed(1)}m=${toDouglasScale(r.swellH)}`;
      return line;
    }).join("  ");
    return `${label}:\n${rowStr}`;
  }).join("\n\n");

  const prompt = `Du bist ein Segelwetter-Experte. Beschreibe NUR den Seegang (KEIN Wind!) für alle Tage in EINEM einzigen Satz (max. 30 Wörter). Verwende Douglas-Skala (z.B. "See 3 leicht bewegt"), KEINE Meter. Nenne Wellenrichtung und ggf. Dünung. Fasse alle Tage zusammen, z.B.: "Heute See 3 leicht bewegt aus S, morgen abnehmend auf See 2, Dünung gering."

${table}`;

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    });
    const text = (msg.content[0] as any)?.text?.trim() ?? null;
    return { wave: { source: src, url, text_de: text } };
  } catch {
    return { wave: { source: src, url, text_de: null } };
  }
}

export async function preprocessGreeceLocalCloudRainThunderstorm(
  rawData: Record<string, unknown>,
  anthropic: Anthropic,
): Promise<Record<string, unknown>> {
  const forecast = rawData["greeceWindWaveCloudRain"] as any;
  const url: string | null = forecast?.url ?? null;
  if (!forecast?.timestamps || !forecast?.rainMm || !forecast?.cloudCover) {
    return { cloudRainThunderstorm: { source: "OpenSkiron WRF 4km", url, text_de: null } };
  }

  const TZ = "Europe/Athens";
  // rainMm in OpenSkiron is already delta (per-hour), not cumulative — use as-is
  const rainMm: number[] = forecast.rainMm;
  const cape: number[] = forecast.cape ?? new Array(forecast.timestamps.length).fill(0);

  type Row = { time: string; cloud: number; rain: number; cape: number };
  const byDate = new Map<string, Row[]>();

  for (let i = 0; i < forecast.timestamps.length; i++) {
    const { label, hour } = toLocalDateHour(forecast.timestamps[i], TZ);
    if (hour < 6 || hour > 20) continue;
    if (!byDate.has(label)) byDate.set(label, []);
    byDate.get(label)!.push({
      time: `${String(hour).padStart(2, "0")}:00`,
      cloud: forecast.cloudCover[i],
      rain: Math.round(rainMm[i] * 10) / 10,
      cape: Math.round(cape[i]),
    });
  }

  const days = Array.from(byDate.entries()).slice(0, 2);
  if (!days.length) return { cloudRainThunderstorm: { source: "OpenSkiron WRF 4km", url, text_de: null } };

  const hasThunderstorm = days.some(([, rows]) => rows.some(r => r.cape >= 1000));

  const table = days
    .map(([label, rows]) => {
      const rowStr = rows.map(r => `${r.time} ${r.cloud}% ${r.rain}mm CAPE=${r.cape}`).join("  ");
      return `${label}:\n${rowStr}`;
    })
    .join("\n\n");

  const thunderNote = hasThunderstorm
    ? " Bei CAPE ≥ 1000 J/kg Gewitterrisiko erwähnen (⛈️)."
    : "";

  const prompt = `Du bist ein Segelwetter-Experte. Beschreibe Bewölkung, Niederschlag und Gewitterrisiko für jeden Tag in je einem deutschen Satz (max. 25 Wörter). Nenne Bewölkungsgrad und ob/wann es regnet.${thunderNote} Format: "Di 31.03: ...\nMi 01.04: ..."

${table}`;

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    });
    const text = (msg.content[0] as any)?.text?.trim() ?? null;
    return { cloudRainThunderstorm: { source: "OpenSkiron WRF 4km", url, text_de: text } };
  } catch {
    return { cloudRainThunderstorm: { source: "OpenSkiron WRF 4km", url, text_de: null } };
  }
}

export function preprocessGreeceLocalTemperature(
  rawData: Record<string, unknown>,
): Record<string, unknown> {
  const tempData = rawData["greeceTemperature"] as any;
  const url: string | null = tempData?.url ?? null;
  const city = tempData?.city ?? null;
  const nullResult = { temperature: { source: "OpenSkiron WRF 4km", url, city, text_de: null } };

  if (!tempData?.timestamps || !tempData?.temp2mC) return nullResult;

  const TZ = "Europe/Athens";
  const todayStr = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(new Date());
  const todayParts = todayStr.split("-");
  const todayDow = new Date(`${todayStr}T12:00:00Z`).getUTCDay();
  const todayLabel = `${DAY_NAMES[todayDow]} ${todayParts[2]}.${todayParts[1]}`;

  const allowedLabels = new Set<string>();
  for (let offset = 0; offset <= 1; offset++) {
    const d = new Date(new Date(`${todayStr}T12:00:00Z`).getTime() + offset * 86400000);
    const dp = d.toISOString().slice(0, 10).split("-");
    allowedLabels.add(`${DAY_NAMES[d.getUTCDay()]} ${dp[2]}.${dp[1]}`);
  }

  const byDate = new Map<string, number[]>();
  for (let i = 0; i < tempData.timestamps.length; i++) {
    const { label } = toLocalDateHour(tempData.timestamps[i], TZ);
    if (!byDate.has(label)) byDate.set(label, []);
    byDate.get(label)!.push(tempData.temp2mC[i]);
  }

  const lines: string[] = [];
  for (const [day, temps] of Array.from(byDate)) {
    if (!allowedLabels.has(day)) continue;
    lines.push(`${day}: ${Math.round(Math.min(...temps))}–${Math.round(Math.max(...temps))}°C`);
    if (lines.length >= 2) break;
  }

  return {
    temperature: {
      source: "OpenSkiron WRF 4km",
      url,
      city,
      text_de: lines.length ? lines.join("\n") : null,
    },
  };
}

export function preprocessGreeceLocalWaterTemp(
  rawData: Record<string, unknown>,
): Record<string, unknown> {
  const forecast = rawData["greeceWindWaveCloudRain"] as any;
  const url: string | null = forecast?.url ?? null;
  const nullResult = { waterTemp: { source: "OpenSkiron WRF 4km", url, text_de: null } };

  const waterTempC: (number | null)[] | null = forecast?.waterTempC ?? null;
  if (!waterTempC) return nullResult;

  const valid = waterTempC.filter((v): v is number => v !== null && !isNaN(v));
  if (!valid.length) return nullResult;

  const avg = Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
  return {
    waterTemp: {
      source: "OpenSkiron WRF 4km",
      url,
      text_de: `Wassertemperatur: ${avg}°C`,
    },
  };
}
