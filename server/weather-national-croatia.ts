import Anthropic from "@anthropic-ai/sdk";

// ── Constants ─────────────────────────────────────────────────────────────────

export const DHMZ_SOURCE_URL = "https://meteo.hr/prognoze.php?section=prognoze_specp&param=jadran&el=jadran_n";

const HR_ENDPOINTS_SAILING: Record<string, string> = {
  "croatiaAdriaForecast":  "https://prognoza.hr/jadran_h.xml",
  "croatiaAdriaRegional":  "https://prognoza.hr/pomorci.xml",
};
const HR_ENDPOINTS_ALWAYS: Record<string, string> = {
  "croatiaCityForecast":   "https://prognoza.hr/sedam/hrvatska/7d_meteogrami.xml",
};

// ── Fetch ─────────────────────────────────────────────────────────────────────

export async function fetchCroatiaWeather(sailingArea?: string | null): Promise<{ data: Record<string, unknown>; sourceUrls: string[] }> {
  const endpoints = {
    ...(sailingArea ? HR_ENDPOINTS_SAILING : {}),
    ...HR_ENDPOINTS_ALWAYS,
  };
  const data: Record<string, unknown> = {};
  for (const [key, url] of Object.entries(endpoints)) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      data[key] = { source: "DHMZ", url, xml: res.ok ? await res.text() : null };
      if (!res.ok) console.error(`Croatia "${key}" failed (${res.status}): ${url}`);
    } catch (e) {
      data[key] = { source: "DHMZ", url, xml: null };
      console.error(`Croatia "${key}" error:`, e instanceof Error ? e.message : e);
    }
  }
  const sourceUrls = [
    `Kroatien Seewetter von [DHMZ](${DHMZ_SOURCE_URL}) Jadran API`,
    `Wind, Seegang, Wolken, Regen, Sicht von [DHMZ](https://meteo.hr/prognoze.php?section=prognoze_specp&param=pomorci) Pomorci API`,
    `Temperatur von [DHMZ](https://meteo.hr/index.php) Meteogrami API`,
  ];
  return { data, sourceUrls };
}

// ── Preprocessing ─────────────────────────────────────────────────────────────

export async function preprocessDhmzSynopsis(xml: string, anthropic: Anthropic): Promise<string | null> {
  const match = xml.match(/<Stanje_tekst>([\s\S]*?)<\/Stanje_tekst>/);
  if (!match) return null;
  const croatianText = match[1].trim();
  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [{
        role: "user",
        content: `Translate the following Croatian weather text to fluent German. Return only the translated text, no XML tags, no extra newlines:\n\n${croatianText}`,
      }],
    });
    return (msg.content[0] as { type: "text"; text: string }).text.trim() || null;
  } catch (e) {
    console.error("preprocessDhmzSynopsis error:", e instanceof Error ? e.message : e);
    return null;
  }
}

const NORTH_ADRIATIC_KEYWORDS = ["nord", "north", "sjeverni", "northern"];

function isNorthAdriaticSailingArea(sailingArea: string | null): boolean {
  if (!sailingArea) return false;
  return NORTH_ADRIATIC_KEYWORDS.some(k => sailingArea.toLowerCase().includes(k));
}

function utcToCroatiaLocal(dateStr: string, timeStr: string): string {
  // dateStr: "01.04.2026", timeStr: "06:00" or "06" — both accepted
  const [d, mo, y] = dateStr.split(".");
  const hh = timeStr.slice(0, 2);
  const utcDate = new Date(`${y}-${mo}-${d}T${hh}:00:00Z`);
  const fmt = new Intl.DateTimeFormat("de-AT", {
    timeZone: "Europe/Zagreb",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
  const parts = fmt.formatToParts(utcDate);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "";
  const localTime = `${get("day")}.${get("month")}.${get("year")}, ${get("hour")}:${get("minute")}`;
  // MESZ = UTC+2 (Apr–Oct), MEZ = UTC+1 (Nov–Mar)
  const month = utcDate.getUTCMonth() + 1;
  const tz = month >= 4 && month <= 10 ? "MESZ" : "MEZ";
  return `${localTime} ${tz}`;
}

function extractDhmzReportTimestamp(xml: string): string | null {
  const m = xml.match(/dan\s+(\d{2}\.\d{2}\.\d{4})\s+u\s+(\d{2}:\d{2})/);
  return m ? utcToCroatiaLocal(m[1], m[2]) : null;
}

export async function extractDhmzWarning(xml: string, sailingArea: string | null, anthropic: Anthropic): Promise<string | null> {
  const match = xml.match(/<Upozorenje>([\s\S]*?)<\/Upozorenje>/);
  if (!match) return null;
  const croatianText = match[1].trim();
  const timestamp = extractDhmzReportTimestamp(xml);
  const isNorth = isNorthAdriaticSailingArea(sailingArea);
  try {
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 400,
      messages: [{
        role: "user",
        content: `Translate the following Croatian maritime warning to fluent German. Then filter it for the sailing area "${sailingArea ?? "Adriatic"}".

Filtering rules:
- Keep sentences that apply to all Adriatic regions or specifically to the relevant region.
- Remove sentences that apply only to other regions (e.g. remove South Adriatic sentences for a North Adriatic sailing area).
- Velebit rule: "podno Velebita" refers to extreme gusts at the Northern Adriatic coastline near Senj.${isNorth
  ? "\n- This is a NORTHERN Adriatic sailing area: KEEP all Velebit references — they are critical safety information."
  : "\n- This is NOT a Northern Adriatic sailing area: REMOVE the entire Velebit sentence including all wind values and time references that belong to it (e.g. 'podno Velebita do 80, a poslijepodne i do 95 čvorova' and any continuation). Keep the non-Velebit wind values that apply to the general Adriatic."}

Return only the filtered German text, no labels, no XML.

Croatian text:\n${croatianText}`,
      }],
    });
    const text = (msg.content[0] as { type: "text"; text: string }).text.trim();
    if (!text) return null;
    return timestamp ? `Aktuell (${timestamp}): ${text}` : text;
  } catch (e) {
    console.error("extractDhmzWarning error:", e instanceof Error ? e.message : e);
    return null;
  }
}

function extractDhmzForecastValidity(xml: string): string | null {
  // <Prognoza_zaglavlje>Vremenska prognoza za sljedeća 24 sata, vrijedi do: 02.04.2026 u 06 sati</Prognoza_zaglavlje>
  const m = xml.match(/vrijedi do:\s*(\d{2}\.\d{2}\.\d{4})\s+u\s+(\d{2})/);
  return m ? `Nächste 24h (bis ${utcToCroatiaLocal(m[1], m[2])})` : null;
}

export async function extractDhmzSailingAreaForecast(xml: string, sailingArea: string | null, anthropic: Anthropic): Promise<string | null> {
  const isNorth = isNorthAdriaticSailingArea(sailingArea);
  const validity = extractDhmzForecastValidity(xml);
  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [{
        role: "user",
        content: `From this Croatian maritime weather XML, extract only the forecast section most relevant to the sailing area "${sailingArea ?? "Adriatic"}". Translate to fluent German. Remove XML tags, headers and extra whitespace. Return only the forecast text, no warnings, no headings.
${isNorth
  ? "This is a NORTHERN Adriatic sailing area: keep all Velebit references."
  : "This is NOT a Northern Adriatic sailing area: REMOVE sentences that apply only to the northern Adriatic (e.g. Velebit, Rijeka, sjevernom Jadranu) that don't apply here. Keep info relevant to this area."}

XML:\n${xml}`,
      }],
    });
    const text = (msg.content[0] as { type: "text"; text: string }).text.trim();
    if (!text) return null;
    return validity ? `${validity}: ${text}` : text;
  } catch (e) {
    console.error("extractDhmzSailingAreaForecast error:", e instanceof Error ? e.message : e);
    return null;
  }
}

export async function preprocessDhmzLocalTemperature(
  xml: string,
  locationHint: string,
  sailingArea: string | null,
  anthropic: Anthropic,
): Promise<{ city: string; text_de: string } | null> {
  const cityNames = Array.from(xml.matchAll(/ime="([^"]+)"/g)).map(m => m[1]);
  if (!cityNames.length) return null;

  const normalizedInput = locationHint.trim().replace(/\s+/g, "_");
  let matchedCity: string | undefined =
    cityNames.find(c => c.toLowerCase() === normalizedInput.toLowerCase()) ??
    cityNames.find(c => c.toLowerCase().startsWith(normalizedInput.toLowerCase()));

  if (!matchedCity) {
    try {
      const msg = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 50,
        messages: [{
          role: "user",
          content: `From this list of Croatian cities, return the single city name that is geographically closest to "${locationHint}"${sailingArea ? ` (sailing area: "${sailingArea}")` : ""}. Always prefer the nearest city in the list — if "${locationHint}" is on an island and that island's city is listed, pick the island city (e.g. Punat→Krk, Bol→Hvar, Vela Luka→Korcula). Reply with only the city name, exactly as it appears in the list.\n\nCities:\n${cityNames.join(", ")}`,
        }],
      });
      const llmResult = (msg.content[0] as { type: "text"; text: string }).text.trim();
      console.log(`[dhmz-temperature] LLM city match: "${locationHint}" → "${llmResult}"`);
      matchedCity = cityNames.includes(llmResult)
        ? llmResult
        : cityNames.find(c => c.toLowerCase() === llmResult.toLowerCase());
    } catch (e) {
      console.error("preprocessDhmzLocalTemperature city-match error:", e instanceof Error ? e.message : e);
      return null;
    }
  }

  if (!matchedCity) return null;

  const escapedCity = matchedCity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const cityBlock = xml.match(new RegExp(`<grad ime="${escapedCity}"[^>]*>([\\s\\S]*?)<\\/grad>`))?.[1];
  if (!cityBlock) return null;

  const dayEntries = Array.from(cityBlock.matchAll(/<dan datum="([^"]+)" dtj="([^"]+)" sat="(\d+)">\s*<t_2m>(-?\d+)<\/t_2m>/g));
  if (!dayEntries.length) return null;

  const dayNames: Record<string, string> = {
    "Ponedjeljak": "Mo", "Utorak": "Di", "Srijeda": "Mi",
    "Cetvrtak": "Do", "Petak": "Fr", "Subota": "Sa", "Nedjelja": "So",
  };

  // Local hour at city (HR = Europe/Zagreb)
  const tz = "Europe/Zagreb";
  const localHour = parseInt(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: tz }).format(new Date())) % 24;
  const todayStr = new Intl.DateTimeFormat("sv-SE", { timeZone: tz }).format(new Date()); // "YYYY-MM-DD"
  const todayParts = todayStr.split("-");
  const DOW: Record<number, string> = { 0: "So", 1: "Mo", 2: "Di", 3: "Mi", 4: "Do", 5: "Fr", 6: "Sa" };
  const todayDow = new Date(`${todayStr}T12:00:00Z`).getUTCDay();
  const todayLabel = `${DOW[todayDow]} ${todayParts[2]}.${todayParts[1]}`;

  const byDate = new Map<string, number[]>();
  const hasDaytime = new Set<string>();
  for (const [, datum, dtj, sat, temp] of dayEntries) {
    const shortDay = dayNames[dtj] ?? dtj;
    const parts = datum.replace(/\.$/, "").split(".");
    const label = `${shortDay} ${parts[0]}.${parts[1]}`;
    if (!byDate.has(label)) byDate.set(label, []);
    byDate.get(label)!.push(Number(temp));
    if (Number(sat) >= 6 && Number(sat) <= 18) hasDaytime.add(label);
  }

  const lines: string[] = [];
  for (const [day, temps] of Array.from(byDate)) {
    if (day === todayLabel) {
      if (localHour >= 13) continue;
      if (localHour >= 5) {
        lines.push(`${day}: max ${Math.round(Math.max(...temps))}°C`);
      } else {
        lines.push(`${day}: ${Math.round(Math.min(...temps))}–${Math.round(Math.max(...temps))}°C`);
      }
    } else {
      if (!hasDaytime.has(day)) continue;
      lines.push(`${day}: ${Math.round(Math.min(...temps))}–${Math.round(Math.max(...temps))}°C`);
    }
    if (lines.length >= 3) break;
  }
  return { city: matchedCity, text_de: lines.join("\n") };
}
