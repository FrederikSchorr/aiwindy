import Anthropic from "@anthropic-ai/sdk";

// ── Constants ─────────────────────────────────────────────────────────────────

export const DHMZ_SOURCE_URL = "https://meteo.hr/prognoze.php?section=prognoze_specp&param=jadran&el=jadran_n";

const HR_ENDPOINTS: Record<string, string> = {
  "croatia adria forecast":  "https://prognoza.hr/jadran_h.xml",
  "croatia adria regional":  "https://prognoza.hr/pomorci.xml",
  "croatia city forecast":   "https://prognoza.hr/sedam/hrvatska/7d_meteogrami.xml",
};

// ── Fetch ─────────────────────────────────────────────────────────────────────

export async function fetchCroatiaWeather(): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  for (const [key, url] of Object.entries(HR_ENDPOINTS)) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      result[key] = { source: "DHMZ", url, xml: res.ok ? await res.text() : null };
      if (!res.ok) console.error(`Croatia "${key}" failed (${res.status}): ${url}`);
    } catch (e) {
      result[key] = { source: "DHMZ", url, xml: null };
      console.error(`Croatia "${key}" error:`, e instanceof Error ? e.message : e);
    }
  }
  return result;
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

export async function extractDhmzWarning(xml: string, sailingArea: string | null, anthropic: Anthropic): Promise<string | null> {
  const match = xml.match(/<Upozorenje>([\s\S]*?)<\/Upozorenje>/);
  if (!match) return null;
  const croatianText = match[1].trim();
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
    return (msg.content[0] as { type: "text"; text: string }).text.trim() || null;
  } catch (e) {
    console.error("extractDhmzWarning error:", e instanceof Error ? e.message : e);
    return null;
  }
}

export async function extractDhmzSailingAreaForecast(xml: string, sailingArea: string | null, anthropic: Anthropic): Promise<string | null> {
  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [{
        role: "user",
        content: `From this Croatian maritime weather XML, extract only the forecast section most relevant to the sailing area "${sailingArea ?? "Adriatic"}". Translate to fluent German. Remove XML tags and extra whitespace. Return only the forecast text, no warnings.\n\nXML:\n${xml}`,
      }],
    });
    return (msg.content[0] as { type: "text"; text: string }).text.trim() || null;
  } catch (e) {
    console.error("extractDhmzSailingAreaForecast error:", e instanceof Error ? e.message : e);
    return null;
  }
}

export async function preprocessDhmzLocalTemperature(
  xml: string,
  userInput: string,
  sailingArea: string | null,
  anthropic: Anthropic,
): Promise<{ city: string; text_de: string } | null> {
  const cityNames = Array.from(xml.matchAll(/ime="([^"]+)"/g)).map(m => m[1]);
  if (!cityNames.length) return null;

  const normalizedInput = userInput.trim().replace(/\s+/g, "_");
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
          content: `From this list of Croatian cities, return the single city name that best matches "${userInput}"${sailingArea ? ` (sailing area: "${sailingArea}")` : ""}. Prefer exact name matches over geographic proximity. Reply with only the city name, exactly as it appears in the list.\n\nCities:\n${cityNames.join(", ")}`,
        }],
      });
      const llmResult = (msg.content[0] as { type: "text"; text: string }).text.trim();
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

  const byDate = new Map<string, number[]>();
  for (const [, datum, dtj, , temp] of dayEntries) {
    const shortDay = dayNames[dtj] ?? dtj;
    const parts = datum.replace(/\.$/, "").split(".");
    const label = `${shortDay} ${parts[0]}.${parts[1]}`;
    if (!byDate.has(label)) byDate.set(label, []);
    byDate.get(label)!.push(Number(temp));
  }

  const lines = Array.from(byDate.entries())
    .slice(0, 3)
    .map(([day, temps]) => `${day}: ${Math.min(...temps)}–${Math.max(...temps)}°C`);
  return { city: matchedCity, text_de: lines.join("\n") };
}
