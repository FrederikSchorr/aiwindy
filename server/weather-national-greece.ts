import Anthropic from "@anthropic-ai/sdk";

// ── Constants ─────────────────────────────────────────────────────────────────

export const HNMS_BULLETIN_URL = "http://newportal.hnms.gr/emy/en/navigation/naftilia_deltio_thalasson_ektiposi";
export const HNMS_SOURCE_URL = "http://newportal.hnms.gr/emy/en/navigation/naftilia_deltio_thalasson_ektiposi";

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

// ── HNMS Fetch ────────────────────────────────────────────────────────────────

export async function fetchHnmsGaleWarning(): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(HNMS_BULLETIN_URL, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/html" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.error(`HNMS gale fetch failed (${res.status})`);
      return { source: "HNMS", url: HNMS_BULLETIN_URL, text: null, available: false };
    }
    const html = await res.text();

    const printable = html.match(/id="printableArea">([\s\S]*?)<\/div>\s*<\/div>/i);
    if (!printable) {
      return { source: "HNMS", url: HNMS_BULLETIN_URL, text: null, available: false };
    }

    const text = printable[1]
      .replace(/<[^>]+>/g, "\n")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#\d+;/g, "")
      .split("\n").map(l => l.trim()).filter(Boolean)
      .filter(l => l !== "National Meteorological Center")
      .join("\n");

    return { source: "HNMS", url: HNMS_BULLETIN_URL, text: text || null, available: Boolean(text) };
  } catch (e) {
    console.error("fetchHnmsGaleWarning error:", e instanceof Error ? e.message : e);
    return { source: "HNMS", url: HNMS_BULLETIN_URL, text: null, available: false };
  }
}

// ── Gale Warning Fetch ─────────────────────────────────────────────────────────

export async function fetchGreeceGaleWarning(
  onProgress?: (status: string) => void,
): Promise<{ data: Record<string, unknown>; sourceUrls: string[] }> {
  onProgress?.("Lade HNMS Sturmwarnung");
  const hnms = await fetchHnmsGaleWarning();
  const sourceUrls: string[] = [];
  if ((hnms as any).available) {
    sourceUrls.push(`Griechenland Marine Wettervorhersage (inkl. Sturmwarnung) von [HNMS](${HNMS_SOURCE_URL})`);
  }
  return { data: { greeceMarineForecast: hnms }, sourceUrls };
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

function currentLocalDateHour(tz: string): { label: string; hour: number } {
  const now = new Date();
  const datePart = new Intl.DateTimeFormat("sv-SE", { timeZone: tz }).format(now);
  const hour = parseInt(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: tz }).format(now),
    10,
  ) % 24;
  const parts = datePart.split("-");
  const dow = new Date(`${datePart}T12:00:00Z`).getUTCDay();
  return { label: `${DAY_NAMES[dow]} ${parts[2]}.${parts[1]}`, hour };
}

export function isValidGreeceWarningTranslation(text: string | null): boolean {
  if (!text) return false;
  if (/\b(?:Sturm|stürmisch|Orkan|Gewitter|Gewittermöglichkeit|Unwetter)\w*\b/i.test(text)) {
    return true;
  }
  return Array.from(text.matchAll(/(\d+(?:[,.]\d+)?)\s*(?:kt|kn|Knoten)\b/gi))
    .some(match => Number(match[1].replace(",", ".")) >= 34);
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
  const text = galeData?.["text"] as string | null;
  // An unreachable or malformed national bulletin must never be displayed as an
  // all-clear. Its availability is shown separately in the source status.
  if (galeData?.["available"] !== true || !text || !emyName) {
    return { "warnings": { source: "HNMS", url: HNMS_BULLETIN_URL, sailingArea: emyName, text_de: null, checked: false } };
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
      return { "warnings": { source: "HNMS", url: HNMS_BULLETIN_URL, sailingArea: emyName, text_de: noWarningText, checked: true } };
    }
    if (!isValidGreeceWarningTranslation(translated)) {
      console.warn("HNMS warning extraction rejected non-warning forecast text");
      return { "warnings": { source: "HNMS", url: HNMS_BULLETIN_URL, sailingArea: emyName, text_de: null, checked: false } };
    }
    const text_de = `Aktuell ${timeLabel ? timeLabel + " " : ""}Sturmwarnung von HNMS:\n${translated}`;
    return { "warnings": { source: "HNMS", url: HNMS_BULLETIN_URL, sailingArea: emyName, text_de, checked: true } };
  } catch (e) {
    console.error("extractGreeceWarning error:", e instanceof Error ? e.message : e);
    return { "warnings": { source: "HNMS", url: HNMS_BULLETIN_URL, sailingArea: emyName, text_de: null, checked: false } };
  }
}

// ── Open-Meteo Preprocessing ───────────────────────────────────────────────────

function getForecastHourly(rawData: Record<string, unknown>): {
  forecast: any;
  hourly: any;
} {
  const forecast = rawData["openMeteoForecast"] as any;
  return { forecast, hourly: forecast?.sailingArea?.hourly ?? null };
}

function getMarineHourly(rawData: Record<string, unknown>): {
  marine: any;
  hourly: any;
} {
  const marine = rawData["openMeteoMarine"] as any;
  return { marine, hourly: marine?.sailingArea?.hourly ?? null };
}

function degreesToCompass(degrees: unknown): string | null {
  if (typeof degrees !== "number" || !Number.isFinite(degrees)) return null;
  const directions = ["N", "NO", "O", "SO", "S", "SW", "W", "NW"];
  return directions[Math.round(degrees / 45) % directions.length];
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
  const current = currentLocalDateHour(TZ);
  type Row = { time: string; dir: string; spd: number; gust: number };
  const byDate = new Map<string, Row[]>();

  for (let i = 0; i < hourly.timestamps.length; i++) {
    const { label, hour } = toLocalDateHour(hourly.timestamps[i], TZ);
    // For today, omit hours that have already passed; mentioning last night
    // in a current sailing forecast is misleading.
    if (label === current.label && hour < current.hour) continue;
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
- Tag 1: nur die noch bevorstehende Zeit ab jetzt; bereits vergangene Stunden und die vergangene Nacht dürfen nicht erwähnt werden. Detailliert mit Zeitverlauf einschließlich einer kommenden Nacht, Richtung, Windstärke in Knoten, Böen und signifikanten Änderungen.
- Tag 2: detailliert mit Zeitverlauf einschließlich Nacht, Richtung, Windstärke in Knoten, Böen und signifikanten Änderungen.
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
  const days = Array.from(byDate.entries()).slice(0, 6);
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

export function preprocessGreeceLocalTemperature(
  rawData: Record<string, unknown>,
): Record<string, unknown> {
  const forecast = rawData["openMeteoForecast"] as any;
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
  for (let offset = 0; offset <= 2; offset++) {
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
    if (lines.length >= 3) break;
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
  const marine = rawData["openMeteoMarine"] as any;
  return {
    waterTemp: {
      source: "Open-Meteo Marine API",
      url: marine?.url ?? null,
      text_de: null,
    },
  };
}
