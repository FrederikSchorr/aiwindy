import Anthropic from "@anthropic-ai/sdk";

// ── HTML helper ───────────────────────────────────────────────────────────────

export function stripHtml(html: string): string {
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

// ── Europe: meteonews.at ──────────────────────────────────────────────────────

export const METEONEWS_URL = "https://meteonews.at/de/Allgemeine_Lage/K33/Europa";

export async function fetchMeteonews(): Promise<string> {
  try {
    const res = await fetch(METEONEWS_URL, {
      headers: { "User-Agent": "WindyWeatherApp/1.0", "Accept": "text/html" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return "";
    const html = await res.text();

    const bulletinMatch =
      html.match(/class="[^"]*ModuleBulletinsGeneralSituation[^"]*"[^>]*>[\s\S]*?<div[^>]*class="[^"]*bulletin-wrap[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i) ||
      html.match(/<div[^>]*class="[^"]*bulletin-wrap[^"]*"[^>]*>([\s\S]*?)<\/div>/i);

    if (bulletinMatch) return stripHtml(bulletinMatch[1]).trim();

    const plainText = stripHtml(html);
    const startIdx = plainText.indexOf("Europawetter");
    if (startIdx >= 0) return plainText.slice(startIdx).trim();

    return plainText;
  } catch (e) {
    console.error("Meteonews fetch failed:", e);
    return "";
  }
}

// ── Shared time helpers ───────────────────────────────────────────────────────

/** Current ECMWF run: last elapsed 0/6/12/18 UTC slot */
function currentRunHour(): number {
  return Math.floor(new Date().getUTCHours() / 6) * 6;
}

/** Next 00 or 12 UTC that is at least 6 h in the future */
function nextForecastTarget(): Date {
  const now = new Date();
  const minTime = now.getTime() + 6 * 60 * 60 * 1000;
  const y = now.getUTCFullYear(), mo = now.getUTCMonth(), d = now.getUTCDate();
  const candidates = [
    new Date(Date.UTC(y, mo, d, 12)),
    new Date(Date.UTC(y, mo, d + 1, 0)),
    new Date(Date.UTC(y, mo, d + 1, 12)),
  ];
  return candidates.find(c => c.getTime() >= minTime) ?? candidates[2];
}

// ── Europe: KNMI Frontenkarte ─────────────────────────────────────────────────

export function buildKnmiChartUrl(): string {
  const now = new Date();
  const dayStr = now.getUTCDate().toString().padStart(2, "0");
  const chartHour = currentRunHour().toString().padStart(2, "0");
  return `https://cdn.knmi.nl/knmi/map/page/weer/waarschuwingen_verwachtingen/weerkaarten/AL${dayStr}${chartHour}_large.gif`;
}

export const KNMI_BASE_URL = "https://cdn.knmi.nl/knmi/map/page/weer/waarschuwingen_verwachtingen/weerkaarten";

export async function fetchKnmiChart(): Promise<{ url: string; imageBase64: string } | null> {
  const url = buildKnmiChartUrl();
  const dayStr = new Date().getUTCDate().toString().padStart(2, "0");
  const fallbackUrl = `${KNMI_BASE_URL}/AL${dayStr}00_large.gif`;
  try {
    let res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    let usedUrl = url;
    if (!res.ok) {
      console.warn(`KNMI chart not found (${res.status}): ${url} → trying fallback`);
      res = await fetch(fallbackUrl, { signal: AbortSignal.timeout(10000) });
      usedUrl = fallbackUrl;
      if (!res.ok) {
        console.error(`KNMI chart fallback also failed (${res.status}): ${fallbackUrl}`);
        return null;
      }
    }
    const imageBase64 = Buffer.from(await res.arrayBuffer()).toString("base64");
    return { url: usedUrl, imageBase64 };
  } catch (e) {
    console.error("KNMI chart fetch failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

// ── Europe: KNMI Frontenprognose ──────────────────────────────────────────────

export function buildKnmiForecastUrl(): string {
  const target = nextForecastTarget();
  const dd = target.getUTCDate().toString().padStart(2, "0");
  const hh = target.getUTCHours().toString().padStart(2, "0");
  return `${KNMI_BASE_URL}/PL${dd}${hh}_large.gif`;
}

export async function fetchKnmiForecast(): Promise<{ url: string; imageBase64: string } | null> {
  const url = buildKnmiForecastUrl();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      console.error(`KNMI forecast not found (${res.status}): ${url}`);
      return null;
    }
    const imageBase64 = Buffer.from(await res.arrayBuffer()).toString("base64");
    return { url, imageBase64 };
  } catch (e) {
    console.error("KNMI forecast fetch failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

// ── Europe: Wetterzentrale 850 hPa ───────────────────────────────────────────

export const WETTERZENTRALE_BASE_URL = "https://www.wetterzentrale.de/de/topkarten.php?map=1&model=ecm&var=2&time=0&run=18&lid=OP&h=0&tr=6&mv=0";
const WZ_MAPS = "https://www.wetterzentrale.de/maps";

export function buildWetterzentraleCurrentUrl(): string {
  const run = currentRunHour().toString().padStart(2, "0");
  return `${WZ_MAPS}/ECMOPEU${run}_0_2.png`;
}

export function buildWetterzentraleForecastUrl(): string {
  const now = new Date();
  const run = currentRunHour();
  const runDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), run));
  const forecastTarget = nextForecastTarget();
  const offsetHours = (forecastTarget.getTime() - runDate.getTime()) / (3600 * 1000);
  const runStr = run.toString().padStart(2, "0");
  return `${WZ_MAPS}/ECMOPEU${runStr}_${offsetHours}_2.png`;
}

export async function fetchWetterzentraleChart(url: string): Promise<{ url: string; imageBase64: string } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      console.error(`Wetterzentrale chart not found (${res.status}): ${url}`);
      return null;
    }
    const imageBase64 = Buffer.from(await res.arrayBuffer()).toString("base64");
    return { url, imageBase64 };
  } catch (e) {
    console.error("Wetterzentrale fetch failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

// ── Preprocessing ─────────────────────────────────────────────────────────────

export async function preprocessMeteonews(
  text: string,
  anthropic: Anthropic,
): Promise<string> {
  const result = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    temperature: 0,
    messages: [{
      role: "user",
      content: `Entferne aus diesem Europawetterbericht alle konkreten Temperaturangaben (z.B. "5 bis 14 Grad", "13 bis 20 Grad"). Behalte alle anderen Informationen über Drucklagen, Fronten, Niederschlag, Bewölkung und allgemeine Wettermuster unverändert. Gib nur den bereinigten Text zurück, ohne Kommentar.\n\n${text}`,
    }],
  });
  return result.content[0]?.type === "text" ? result.content[0].text.trim() : text;
}
