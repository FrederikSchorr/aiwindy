import Anthropic from "@anthropic-ai/sdk";

// ── Constants ─────────────────────────────────────────────────────────────────

export const HNMS_BULLETIN_URL = "http://newportal.hnms.gr/emy/en/navigation/naftilia_deltio_thalasson_ektiposi";
export const HNMS_SOURCE_URL = "http://newportal.hnms.gr/emy/en/navigation/naftilia_deltio_thalasson_ektiposi";
export const OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
export const OPEN_METEO_MARINE_URL = "https://marine-api.open-meteo.com/v1/marine";
export const OPEN_METEO_FORECAST_SOURCE_URL = "https://open-meteo.com/en/docs";
export const OPEN_METEO_MARINE_SOURCE_URL = "https://open-meteo.com/en/docs/marine-weather-api";

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

// ── Open-Meteo Fetch ───────────────────────────────────────────────────────────

type OpenMeteoTarget = {
  name_de: string;
  type: "sea" | "lake";
  coordinates: { lat: number; lon: number };
};

const OPEN_METEO_FORECAST_HOURLY = [
  "temperature_2m",
  "precipitation_probability",
  "rain",
  "weather_code",
  "cloud_cover",
  "wind_speed_10m",
  "wind_direction_10m",
  "wind_gusts_10m",
  "cape",
];

const OPEN_METEO_MARINE_HOURLY = [
  "wave_height",
  "wave_direction",
  "wave_period",
  "wind_wave_height",
  "wind_wave_direction",
  "wind_wave_period",
  "swell_wave_height",
  "swell_wave_direction",
  "swell_wave_period",
];

function buildOpenMeteoUrl(
  endpoint: string,
  lat: number,
  lon: number,
  hourly: string[],
  extra: Record<string, string> = {},
): string {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    timezone: "Europe/Athens",
    // Section 3 needs the current day plus the following five days.
    forecast_days: "6",
    hourly: hourly.join(","),
    ...extra,
  });
  return `${endpoint}?${params.toString()}`;
}

async function fetchOpenMeteoJson(
  url: string,
  label: string,
  onProgress?: (status: string) => void,
): Promise<Record<string, any> | null> {
  try {
    onProgress?.(`Lade ${label} von Open-Meteo`);
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.error(`Open-Meteo ${label} failed (${res.status})`);
      return null;
    }
    const data = await res.json() as Record<string, any>;
    if (!Array.isArray(data.hourly?.time)) {
      console.error(`Open-Meteo ${label} returned no hourly data`);
      return null;
    }
    return data;
  } catch (e) {
    console.error(`Open-Meteo ${label} error:`, e instanceof Error ? e.message : e);
    return null;
  }
}

function arrayOrNull(hourly: Record<string, any> | undefined, key: string): unknown[] | null {
  return Array.isArray(hourly?.[key]) ? hourly[key] : null;
}

function normalizeForecast(
  raw: Record<string, any> | null,
  url: string,
  sailingArea: OpenMeteoTarget,
  city: OpenMeteoTarget,
  cityRaw: Record<string, any> | null,
  cityUrl: string,
): Record<string, unknown> {
  const hourly = raw?.hourly;
  const cityHourly = cityRaw?.hourly;
  return {
    source: "Open-Meteo Forecast API",
    url,
    available: Boolean(raw),
    fetchedAt: new Date().toISOString(),
    timezone: raw?.timezone ?? "Europe/Athens",
    latitude: raw?.latitude ?? sailingArea.coordinates.lat,
    longitude: raw?.longitude ?? sailingArea.coordinates.lon,
    hourlyUnits: raw?.hourly_units ?? {},
    sailingArea: {
      name: sailingArea.name_de,
      coordinates: sailingArea.coordinates,
      hourly: raw ? {
        timestamps: arrayOrNull(hourly, "time"),
        windSpeedKt: arrayOrNull(hourly, "wind_speed_10m"),
        windDirDeg: arrayOrNull(hourly, "wind_direction_10m"),
        gustKt: arrayOrNull(hourly, "wind_gusts_10m"),
        cloudCoverPct: arrayOrNull(hourly, "cloud_cover"),
        rainMm: arrayOrNull(hourly, "rain"),
        precipProbabilityPct: arrayOrNull(hourly, "precipitation_probability"),
        weatherCode: arrayOrNull(hourly, "weather_code"),
        capeJkg: arrayOrNull(hourly, "cape"),
      } : null,
    },
    city: {
      name: city.name_de,
      coordinates: city.coordinates,
      url: cityUrl,
      hourly: cityRaw ? {
        timestamps: arrayOrNull(cityHourly, "time"),
        temp2mC: arrayOrNull(cityHourly, "temperature_2m"),
      } : null,
    },
  };
}

function normalizeMarine(
  raw: Record<string, any> | null,
  url: string,
  sailingArea: OpenMeteoTarget,
): Record<string, unknown> {
  const hourly = raw?.hourly;
  return {
    source: "Open-Meteo Marine API",
    url,
    available: Boolean(raw),
    fetchedAt: new Date().toISOString(),
    timezone: raw?.timezone ?? "Europe/Athens",
    latitude: raw?.latitude ?? sailingArea.coordinates.lat,
    longitude: raw?.longitude ?? sailingArea.coordinates.lon,
    hourlyUnits: raw?.hourly_units ?? {},
    sailingArea: {
      name: sailingArea.name_de,
      coordinates: sailingArea.coordinates,
      hourly: raw ? {
        timestamps: arrayOrNull(hourly, "time"),
        waveHeightM: arrayOrNull(hourly, "wave_height"),
        waveDirDeg: arrayOrNull(hourly, "wave_direction"),
        wavePeriodS: arrayOrNull(hourly, "wave_period"),
        windWaveHeightM: arrayOrNull(hourly, "wind_wave_height"),
        windWaveDirDeg: arrayOrNull(hourly, "wind_wave_direction"),
        windWavePeriodS: arrayOrNull(hourly, "wind_wave_period"),
        swellHeightM: arrayOrNull(hourly, "swell_wave_height"),
        swellDirDeg: arrayOrNull(hourly, "swell_wave_direction"),
        swellPeriodS: arrayOrNull(hourly, "swell_wave_period"),
      } : null,
    },
  };
}

// ── Main Fetch ────────────────────────────────────────────────────────────────

export async function fetchGreeceWeather(
  sailingAreaObj?: SailingAreaObj,
  cityObj?: CityObj,
  onProgress?: (status: string) => void,
): Promise<{ data: Record<string, unknown>; sourceUrls: string[] }> {
  const area: OpenMeteoTarget | null = sailingAreaObj
    ? sailingAreaObj
    : cityObj
      ? { name_de: cityObj.name_de, type: "sea", coordinates: cityObj.coordinates }
      : null;
  const city: OpenMeteoTarget | null = cityObj
    ? { name_de: cityObj.name_de, type: "sea", coordinates: cityObj.coordinates }
    : area;
  const forecastUrl = area && city
    ? buildOpenMeteoUrl(
      OPEN_METEO_FORECAST_URL,
      area.coordinates.lat,
      area.coordinates.lon,
      OPEN_METEO_FORECAST_HOURLY,
      { wind_speed_unit: "kn" },
    )
    : `${OPEN_METEO_FORECAST_URL}?timezone=Europe%2FAthens`;
  const cityForecastUrl = city
    ? buildOpenMeteoUrl(
      OPEN_METEO_FORECAST_URL,
      city.coordinates.lat,
      city.coordinates.lon,
      ["temperature_2m"],
    )
    : forecastUrl;
  const marineUrl = area
    ? buildOpenMeteoUrl(
      OPEN_METEO_MARINE_URL,
      area.coordinates.lat,
      area.coordinates.lon,
      OPEN_METEO_MARINE_HOURLY,
    )
    : `${OPEN_METEO_MARINE_URL}?timezone=Europe%2FAthens`;

  // The three Open-Meteo requests run in parallel. Emit one aggregate status
  // instead of letting the last request ("Wellendaten") hide the others.
  onProgress?.("Lade Wind- und Wetterdaten von Open-Meteo");
  const [hnms, forecastRaw, cityForecastRaw, marineRaw] = await Promise.all([
    fetchHnmsGaleWarning(),
    area ? fetchOpenMeteoJson(forecastUrl, "Wind- und Wetterdaten") : Promise.resolve(null),
    city ? fetchOpenMeteoJson(cityForecastUrl, "Temperaturdaten") : Promise.resolve(null),
    area ? fetchOpenMeteoJson(marineUrl, "Wellen- und Dünungsdaten") : Promise.resolve(null),
  ]);

  const data: Record<string, unknown> = {
    greeceMarineForecast: hnms,
    greeceOpenMeteoForecast: area && city
      ? normalizeForecast(forecastRaw, forecastUrl, area, city, cityForecastRaw, cityForecastUrl)
      : null,
    greeceOpenMeteoMarine: area
      ? normalizeMarine(marineRaw, marineUrl, area)
      : null,
  };

  const sourceUrls = [
    `Griechenland Wetterlage und Warnungen von [HNMS](${HNMS_SOURCE_URL})`,
    `Wind, Wolken, Regen, Gewitter, Temperatur von [Open-Meteo Forecast API](${OPEN_METEO_FORECAST_SOURCE_URL})`,
    `Wellen und Dünung von [Open-Meteo Marine API](${OPEN_METEO_MARINE_SOURCE_URL})`,
  ];

  return { data, sourceUrls };
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
  const localTimestamp = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):/.exec(utcTs);
  if (localTimestamp && !/(Z|[+-]\d{2}:?\d{2})$/i.test(utcTs)) {
    const [, year, month, day, hour] = localTimestamp;
    const dow = new Date(`${year}-${month}-${day}T12:00:00Z`).getUTCDay();
    return {
      label: `${DAY_NAMES[dow]} ${day}.${month}`,
      hour: Number(hour),
    };
  }
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
  signal?: AbortSignal,
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
    }, { signal });
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
  signal?: AbortSignal,
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
        content: `Seewetter-Bulletin. Suche in PART 3 den Abschnitt für "${emyName ?? ""}".

Extrahiere NUR echte Sturmwarnungen. Eine Sturmwarnung liegt nur vor wenn EINES dieser Schlüsselwörter im Text steht:
GALE, STORM, THUNDERSTORM, CHANCE OF THUNDERSTORM

WICHTIG: Normaler Segelwind ist KEINE Sturmwarnung! Wind bis Beaufort 7 (z.B. "NORTHWEST 5 OR 6", "NORTH 4 TO 7", "MODERATE", "ROUGH") ist normal und KEINE Warnung.

- Sturmwarnung gefunden: Antworte NUR mit dem übersetzten Warnungstext (z.B. "Gewittermöglichkeit im Westen"). Keine Erklärungen, keine Einleitung.
- Keine Sturmwarnung: Antworte mit genau "NONE"

Übersetzungsregeln: Deutsch, normale Groß-/Kleinschreibung. Keine Uhrzeiten nennen. Beaufort → Knoten.

${text}`,
      }],
    }, { signal });
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

// ── Open-Meteo Preprocessing ───────────────────────────────────────────────────

function getForecastHourly(rawData: Record<string, unknown>): {
  forecast: any;
  hourly: any;
} {
  const forecast = rawData["greeceOpenMeteoForecast"] as any;
  return { forecast, hourly: forecast?.sailingArea?.hourly ?? null };
}

function getMarineHourly(rawData: Record<string, unknown>): {
  marine: any;
  hourly: any;
} {
  const marine = rawData["greeceOpenMeteoMarine"] as any;
  return { marine, hourly: marine?.sailingArea?.hourly ?? null };
}

function degreesToCompass(degrees: unknown): string | null {
  if (typeof degrees !== "number" || !Number.isFinite(degrees)) return null;
  const directions = ["N", "NNO", "NO", "ONO", "O", "OSO", "SO", "SSO", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return directions[Math.round(degrees / 22.5) % directions.length];
}

export async function preprocessGreeceLocalWind(
  rawData: Record<string, unknown>,
  anthropic: Anthropic,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const { forecast, hourly } = getForecastHourly(rawData);
  const url: string | null = forecast?.url ?? null;
  const sailingArea = forecast?.sailingArea?.name ?? null;
  if (!hourly?.timestamps || !hourly?.windSpeedKt) {
    return { wind: { source: "Open-Meteo Forecast API", url, sailingArea, text_de: null } };
  }

  const TZ = "Europe/Athens";
  type Row = { time: string; dir: string; spd: number; gust: number };
  const byDate = new Map<string, Row[]>();

  for (let i = 0; i < hourly.timestamps.length; i++) {
    const { label, hour } = toLocalDateHour(hourly.timestamps[i], TZ);
    const speed = hourly.windSpeedKt[i];
    if (typeof speed !== "number") continue;
    if (!byDate.has(label)) byDate.set(label, []);
    byDate.get(label)!.push({
      time: `${String(hour).padStart(2, "0")}:00`,
      dir: degreesToCompass(hourly.windDirDeg?.[i]) ?? "?",
      spd: Math.round(speed),
      gust: Math.round(typeof hourly.gustKt?.[i] === "number" ? hourly.gustKt[i] : speed),
    });
  }

  const days = Array.from(byDate.entries()).slice(0, 6);
  if (!days.length) return { wind: { source: "Open-Meteo Forecast API", url, sailingArea, text_de: null } };

  const table = days
    .map(([label, rows]) => {
      const rowStr = rows.map(r => `${r.time} ${r.dir} ${r.spd}kt Böe ${r.gust}kt`).join("  ");
      return `${label}:\n${rowStr}`;
    })
    .join("\n\n");

  const prompt = `Du bist ein Segelwetter-Experte. Bereite die Windprognose für sechs Tage auf Deutsch auf.
Gib genau eine Zeile pro Tag aus, ohne Überschrift und ohne Bullet-Zeichen:
- Tag 1 und Tag 2: detailliert mit Zeitverlauf einschließlich Nacht, Richtung, Windstärke in Knoten, Böen und signifikanten Änderungen.
- Tag 3: nur minimale und maximale Windstärke in Knoten sowie die vorherrschende Windrichtung.
- Tag 4 bis Tag 6: nur eine großräumige Einstufung (Flaute, schwach, mäßig, kräftig oder stürmisch) und, falls eindeutig, die vorherrschende Richtung. Keine Stundenwerte.
Übernimm ausschließlich Werte aus den Rohdaten. Verwende die Tagesbezeichnungen am Zeilenanfang unverändert.
Format: "Sa 22.08.: ...\nSo 23.08.: ...\nMo 24.08.: ...\nDi 25.08.: ...\nMi 26.08.: ...\nDo 27.08.: ..."

${table}`;

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      // Six labeled day summaries need more room than the former two-day output.
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    }, { signal });
    const text = (msg.content[0] as any)?.text?.trim() ?? null;
    return { wind: { source: "Open-Meteo Forecast API", url, sailingArea, text_de: text } };
  } catch {
    return { wind: { source: "Open-Meteo Forecast API", url, sailingArea, text_de: null } };
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
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const { marine, hourly } = getMarineHourly(rawData);
  const url: string | null = marine?.url ?? null;
  const sailingArea = marine?.sailingArea?.name ?? null;
  const src = "Open-Meteo Marine API";
  if (!hourly?.timestamps || !hourly?.waveHeightM) {
    return { wave: { source: src, url, sailingArea, text_de: null } };
  }

  const hasAnyWave = (hourly.waveHeightM as (number | null)[]).some(
    (v: number | null) => v !== null && !isNaN(v),
  );
  if (!hasAnyWave) return { wave: { source: src, url, sailingArea, text_de: null } };

  const TZ = "Europe/Athens";
  type WaveRow = { hour: number; waveH: number; swellH: number | null; waveD: string | null; waveP: number | null };
  const byDate = new Map<string, WaveRow[]>();

  for (let i = 0; i < hourly.timestamps.length; i++) {
    const wh = hourly.waveHeightM[i];
    if (wh === null || isNaN(wh)) continue;
    const { label, hour } = toLocalDateHour(hourly.timestamps[i], TZ);
    if (hour < 6 || hour > 20) continue;
    if (!byDate.has(label)) byDate.set(label, []);
    byDate.get(label)!.push({
      hour,
      waveH: wh,
      swellH: hourly.swellHeightM?.[i] ?? null,
      waveD: degreesToCompass(hourly.waveDirDeg?.[i]),
      waveP: hourly.wavePeriodS?.[i] ?? null,
    });
  }

  // Section 3 combines wave/swell details with the wind bullets for today and tomorrow.
  const days = Array.from(byDate.entries()).slice(0, 2);
  if (!days.length) return { wave: { source: src, url, sailingArea, text_de: null } };

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

  const prompt = `Du bist ein Segelwetter-Experte. Beschreibe NUR die vorherrschende Seegangsstärke für die beiden Tage in den Rohdaten.
Gib genau eine Zeile pro Tag aus, ohne Überschrift und ohne Bullet-Zeichen. Beginne jede Zeile mit der Tagesbezeichnung aus den Rohdaten.
Verwende nur die Douglas-Skala (z.B. "See 3 leicht bewegt"), KEINE Meter. Nenne KEINE Wellenrichtung, Periode oder Dünung. Erfinde keine Werte.
Format: "Sa 22.08.: See 2 schwach bewegt\nSo 23.08.: See 3 leicht bewegt"

${table}`;

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    }, { signal });
    const text = (msg.content[0] as any)?.text?.trim() ?? null;
    return { wave: { source: src, url, sailingArea, text_de: text } };
  } catch {
    return { wave: { source: src, url, sailingArea, text_de: null } };
  }
}

export async function preprocessGreeceLocalCloudRainThunderstorm(
  rawData: Record<string, unknown>,
  anthropic: Anthropic,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const { forecast, hourly } = getForecastHourly(rawData);
  const url: string | null = forecast?.url ?? null;
  if (!hourly?.timestamps || !hourly?.rainMm || !hourly?.cloudCoverPct) {
    return { cloudRainThunderstorm: { source: "Open-Meteo Forecast API", url, text_de: null } };
  }

  const TZ = "Europe/Athens";
  const rainMm: number[] = hourly.rainMm;
  const cape: number[] = hourly.capeJkg ?? new Array(hourly.timestamps.length).fill(0);

  type Row = { time: string; cloud: number; rain: number; cape: number };
  const byDate = new Map<string, Row[]>();

  for (let i = 0; i < hourly.timestamps.length; i++) {
    const { label, hour } = toLocalDateHour(hourly.timestamps[i], TZ);
    if (hour < 6 || hour > 20) continue;
    if (!byDate.has(label)) byDate.set(label, []);
    byDate.get(label)!.push({
      time: `${String(hour).padStart(2, "0")}:00`,
      cloud: hourly.cloudCoverPct[i],
      rain: Math.round(rainMm[i] * 10) / 10,
      cape: Math.round(cape[i]),
    });
  }

  const days = Array.from(byDate.entries()).slice(0, 2);
  if (!days.length) return { cloudRainThunderstorm: { source: "Open-Meteo Forecast API", url, text_de: null } };

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
    }, { signal });
    const text = (msg.content[0] as any)?.text?.trim() ?? null;
    return { cloudRainThunderstorm: { source: "Open-Meteo Forecast API", url, text_de: text } };
  } catch {
    return { cloudRainThunderstorm: { source: "Open-Meteo Forecast API", url, text_de: null } };
  }
}

export function preprocessGreeceLocalTemperature(
  rawData: Record<string, unknown>,
): Record<string, unknown> {
  const forecast = rawData["greeceOpenMeteoForecast"] as any;
  const tempData = forecast?.city?.hourly ?? null;
  const url: string | null = forecast?.url ?? null;
  const city = forecast?.city?.name ?? null;
  const nullResult = { temperature: { source: "Open-Meteo Forecast API", url, city, text_de: null } };

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
      source: "Open-Meteo Forecast API",
      url,
      city,
      text_de: lines.length ? lines.join("\n") : null,
    },
  };
}

export function preprocessGreeceLocalWaterTemp(
  rawData: Record<string, unknown>,
): Record<string, unknown> {
  const marine = rawData["greeceOpenMeteoMarine"] as any;
  return {
    waterTemp: {
      source: "Open-Meteo Marine API",
      url: marine?.url ?? null,
      text_de: null,
    },
  };
}
