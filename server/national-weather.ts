import Anthropic from "@anthropic-ai/sdk";

// ── National weather dispatcher ───────────────────────────────────────────────

export async function fetchNationalWeather(
  countryCode: string,
): Promise<{ data: Record<string, unknown>; sourceUrl: string | null }> {
  switch (countryCode) {
    case "HR": return { data: await fetchCroatiaWeather(), sourceUrl: DHMZ_SOURCE_URL };
    // Future: case "AT": return { data: await fetchAustriaWeather(), sourceUrl: ... };
    // Future: case "IT": return { data: await fetchItalyWeather(), sourceUrl: ... };
    // Future: case "GR": return { data: await fetchGreeceWeather(), sourceUrl: ... };
    // Future: case "DE": return { data: await fetchGermanyWeather(), sourceUrl: ... };
    default: return { data: {}, sourceUrl: null };
  }
}

export async function preprocessNationalWeather(
  rawData: Record<string, unknown>,
  anthropic: Anthropic,
): Promise<Record<string, unknown>> {
  const adriaXml = (rawData["croatia adria forecast"] as any)?.xml as string | null;
  return {
    "synopsis": {
      source: "DHMZ",
      url: "https://prognoza.hr/jadran_h.xml",
      german: adriaXml ? await preprocessDhmzSynopsis(adriaXml, anthropic) : null,
    },
  };
}

export async function preprocessLocalWeather(
  rawData: Record<string, unknown>,
  position: { userInput: string; sailingArea: string | null },
  anthropic: Anthropic,
): Promise<Record<string, unknown>> {
  const regionalXml = (rawData["croatia adria regional"] as any)?.xml as string | null;
  const forecastXml = (rawData["croatia city forecast"] as any)?.xml as string | null;

  const sailingAreaResult = regionalXml
    ? await preprocessDhmzSailingArea(regionalXml, position.sailingArea, anthropic)
    : null;

  const localResult = forecastXml
    ? await preprocessDhmzLocalTemperature(forecastXml, position.userInput, position.sailingArea, anthropic)
    : null;

  return {
    "sailingarea weather": {
      source: "DHMZ",
      url: "https://prognoza.hr/pomorci.xml",
      sailingArea: position.sailingArea ?? null,
      german: sailingAreaResult,
    },
    "temperature": {
      source: "DHMZ",
      url: "https://prognoza.hr/sedam/hrvatska/7d_meteogrami.xml",
      city: localResult?.city ?? null,
      german: localResult?.german ?? null,
    },
  };
}

// ── Croatia (DHMZ) ────────────────────────────────────────────────────────────

const DHMZ_SOURCE_URL = "https://meteo.hr/prognoze.php?section=prognoze_specp&param=jadran&el=jadran_n";

const HR_ENDPOINTS: Record<string, string> = {
  "croatia adria forecast":  "https://prognoza.hr/jadran_h.xml",
  "croatia adria regional":  "https://prognoza.hr/pomorci.xml",
  "croatia city forecast":   "https://prognoza.hr/sedam/hrvatska/7d_meteogrami.xml",
};

async function fetchCroatiaWeather(): Promise<Record<string, unknown>> {
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

// ── Preprocessing helpers ─────────────────────────────────────────────────────

async function preprocessDhmzSynopsis(xml: string, anthropic: Anthropic): Promise<string | null> {
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

async function preprocessDhmzSailingArea(
  xml: string,
  sailingArea: string | null,
  anthropic: Anthropic,
): Promise<string | null> {
  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      messages: [{
        role: "user",
        content: `From this Croatian maritime weather XML, extract only information relevant to the sailing area "${sailingArea ?? "Adriatic"}". Translate everything to fluent German. Remove all XML tags and extra whitespace. Return only plain text (warning first, then forecast).

Rules:
- Include only the forecast section for the matching region. Remove forecast sections for other Adriatic regions entirely.
- From the warning (Upozorenje), keep only sentences that apply to the relevant region. Remove sentences that refer only to other regions (e.g. remove "Mittel- und Südadria" references when the sailing area is Northern Adriatic, and vice versa).
- Safety rule for Velebit: Velebit gust values are extreme gusts specific to the Northern Adriatic coastline. Always keep Velebit references for Northern Adriatic sailing areas — critical safety information. Remove any sentence containing "Velebit" for Central or Southern Adriatic sailing areas as those values are dangerously misleading there.

XML:\n${xml}`,
      }],
    });
    return (msg.content[0] as { type: "text"; text: string }).text.trim() || null;
  } catch (e) {
    console.error("preprocessDhmzSailingArea error:", e instanceof Error ? e.message : e);
    return null;
  }
}

async function preprocessDhmzLocalTemperature(
  xml: string,
  userInput: string,
  sailingArea: string | null,
  anthropic: Anthropic,
): Promise<{ city: string; german: string } | null> {
  // Step 1: find nearest city — direct match first, LLM fallback
  const cityNames = [...xml.matchAll(/ime="([^"]+)"/g)].map(m => m[1]);
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

  // Step 2: extract temperature data (code-only, no LLM)
  const escapedCity = matchedCity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const cityBlock = xml.match(new RegExp(`<grad ime="${escapedCity}"[^>]*>([\\s\\S]*?)<\\/grad>`))?.[1];
  if (!cityBlock) return null;

  const dayEntries = [...cityBlock.matchAll(/<dan datum="([^"]+)" dtj="([^"]+)" sat="(\d+)">\s*<t_2m>(-?\d+)<\/t_2m>/g)];
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

  const lines = [...byDate.entries()]
    .slice(0, 3)
    .map(([day, temps]) => `${day}: ${Math.min(...temps)}–${Math.max(...temps)}°C`);
  return { city: matchedCity, german: lines.join("\n") };
}
