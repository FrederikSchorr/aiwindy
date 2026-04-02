import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";

// ── Types ──────────────────────────────────────────────────────────────────

export interface SegelRevier {
  deutsch: string;
  typ: "meer" | "see";
  lat: number;
  lon: number;
  orte: string;
  [key: string]: unknown;
}

export interface RevierResult {
  kind: "revier";
  revier: SegelRevier;
  land: string;
  countryCode: string;
  city: string;
}

export interface CityOnlyResult {
  kind: "city";
  city: string;
}

export type DetectLocationResult = RevierResult | CityOnlyResult | null;

/** @deprecated use DetectLocationResult */
export type DetectedRevier = RevierResult;

/** Shared geocode result — compatible with the existing geocodeLocation() shape */
export interface GeocodedLocation {
  lat: number;
  lon: number;
  displayName: string;
  countryCode: string;
  country: string;           // German country name, e.g. "Kroatien"
  // Sailing-area fields (null when no revier found)
  sailingArea: string | null;
  type: "sea" | "lake" | null;
  // When no revier: Nominatim city name
  location: string | null;
  // For downstream model selection (filled later in routes.ts)
  regionalModel: string;
  regionalModelLabel: string;
  regionalModelZoom: number;
  // Original user input
  userInput: string;
}

// ── Country mapping ────────────────────────────────────────────────────────

export const LAND_TO_COUNTRY_CODE: Record<string, string> = {
  "Albanien": "AL",
  "Belgien": "BE",
  "Deutschland": "DE",
  "Dänemark": "DK",
  "Frankreich": "FR",
  "Griechenland": "GR",
  "Irland": "IE",
  "Italien": "IT",
  "Kroatien": "HR",
  "Montenegro": "ME",
  "Niederlande": "NL",
  "Norwegen": "NO",
  "Österreich": "AT",
  "Portugal": "PT",
  "Schweden": "SE",
  "Schweiz": "CH",
  "Slowenien": "SI",
  "Spanien": "ES",
  "Türkei": "TR",
  "Vereinigtes Königreich": "GB",
};

export const COUNTRY_CODE_TO_FLAG: Record<string, string> = {
  AL: "🇦🇱", BE: "🇧🇪", DE: "🇩🇪", DK: "🇩🇰", FR: "🇫🇷",
  GR: "🇬🇷", IE: "🇮🇪", IT: "🇮🇹", HR: "🇭🇷", ME: "🇲🇪",
  NL: "🇳🇱", NO: "🇳🇴", AT: "🇦🇹", PT: "🇵🇹", SE: "🇸🇪",
  CH: "🇨🇭", SI: "🇸🇮", ES: "🇪🇸", TR: "🇹🇷", GB: "🇬🇧",
};

// ── JSON loading ───────────────────────────────────────────────────────────

type SegelreviereData = Record<string, { reviere: SegelRevier[] }>;

let _cache: SegelreviereData | null = null;

function loadSegelreviere(): SegelreviereData {
  if (!_cache) {
    _cache = JSON.parse(
      readFileSync(new URL("../data/sailingareas.json", import.meta.url), "utf-8"),
    ) as SegelreviereData;
  }
  return _cache;
}

function buildRevierList(data: SegelreviereData): string {
  const lines: string[] = [];
  for (const [land, { reviere }] of Object.entries(data)) {
    for (const r of reviere) {
      lines.push(`"${r.deutsch}" [${land}, ${r.lat.toFixed(1)}°N ${r.lon.toFixed(1)}°E] — ${r.orte}`);
    }
  }
  return lines.join("\n");
}

// ── Prompt Caching: statische System-Blöcke ───────────────────────────────

const DETECT_SYSTEM_PROMPT = `Du bist ein Experte für europäische Geografie und Segelreviere.

Gegeben einen Ort (Stadt, Hafen, Bucht, Resort, Campingplatz, See, allgemeine Bezeichnung):
1. Ordne ihn dem passendsten Segelrevier aus der Liste zu (wenn sinnvoll).
2. Nenne die nächstgelegene bedeutsame Stadt oder den repräsentativen Ort.

Wichtig:
- Die angegebenen Orte pro Revier sind nur Beispiele — nutze dein geografisches Wissen auch für nicht explizit gelistete Orte.
- Die Koordinaten (°N °E) jedes Reviers helfen bei der geografischen Einordnung.
- Wenn der Input selbst eine echte Stadt, ein Hafen oder ein bekannter Ort ist (z.B. "Punat", "Biograd", "Vodice", "Fažana"): gib GENAU diesen Ort als city zurück, NICHT eine größere Nachbarstadt.
- Für Resorts, Campingplätze, Buchten: gib die nächste echte Stadt an (z.B. "Seepark Weiden" → city: "Weiden am See").
- Für Segelrevier-Namen ohne Stadtbezug: gib die wichtigste Hafenstadt an (z.B. "Nordadria" → city: "Trieste").
- Bei allgemeinen Bezeichnungen wie "Adria": sailingArea: "Adria Mitte (Kroatien)", city: "Split".
- Falls kein Revier passt (Binnenstadt, Inland): sailingArea: null.
- Falls der Input komplett unverständlich ist: city: null.

Antworte NUR mit einem JSON-Objekt, z.B.:
{"sailingArea": "Adria Mitte (Kroatien)", "city": "Split"}
{"sailingArea": null, "city": "Zagreb"}
{"sailingArea": null, "city": null}`;

let _staticSystemBlocks: Anthropic.Messages.TextBlockParam[] | null = null;

function getStaticSystemBlocks(): Anthropic.Messages.TextBlockParam[] {
  if (_staticSystemBlocks) return _staticSystemBlocks;
  const data = loadSegelreviere();
  const revierList = buildRevierList(data);
  _staticSystemBlocks = [
    { type: "text", text: DETECT_SYSTEM_PROMPT },
    {
      type: "text",
      text: `Verfügbare Segelreviere:\n${revierList}`,
      cache_control: { type: "ephemeral" },
    },
  ];
  return _staticSystemBlocks;
}

// ── Core detection ─────────────────────────────────────────────────────────

export async function detectLocation(
  locationName: string,
  anthropic: Anthropic,
): Promise<DetectLocationResult> {
  const result = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 100,
    temperature: 0,
    system: getStaticSystemBlocks(),
    messages: [{ role: "user", content: `Ort: "${locationName}"` }],
  });

  const text = result.content[0]?.type === "text" ? result.content[0].text.trim() : "";
  let parsed: { sailingArea: string | null; city: string | null } | null = null;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
  } catch {
    console.error("detectLocation: JSON parse failed for response:", text);
    return null;
  }

  const city = parsed?.city?.trim() || null;
  if (!city) return null; // unrecognisable input — caller will ask user again

  const sailingAreaName = typeof parsed?.sailingArea === "string" ? parsed.sailingArea.trim() : null;
  if (!sailingAreaName) return { kind: "city", city };

  const data = loadSegelreviere();
  for (const [land, { reviere }] of Object.entries(data)) {
    const revier = reviere.find((r) => r.deutsch === sailingAreaName);
    if (revier) {
      return { kind: "revier", revier, land, countryCode: LAND_TO_COUNTRY_CODE[land] ?? "", city };
    }
  }
  console.warn(`detectLocation: unknown sailingArea "${sailingAreaName}", returning city-only`);
  return { kind: "city", city };
}

/** @deprecated use detectLocation */
export async function detectSegelrevier(
  locationName: string,
  anthropic: Anthropic,
): Promise<RevierResult | null> {
  const result = await detectLocation(locationName, anthropic);
  return result?.kind === "revier" ? result : null;
}

// ── Flag helper ────────────────────────────────────────────────────────────

export function countryFlag(countryCode: string): string {
  return COUNTRY_CODE_TO_FLAG[countryCode] ?? "";
}

// ── Regional model selection ───────────────────────────────────────────────

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

export async function getRegionalModelAI(
  lat: number,
  lon: number,
  displayName: string,
  anthropic: Anthropic,
): Promise<{ model: string; label: string; zoom: number }> {
  try {
    const result = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      temperature: 0,
      system: MODEL_SELECTION_PROMPT,
      messages: [{ role: "user", content: `Ort: ${displayName}\nKoordinaten: ${lat.toFixed(4)}°N, ${lon.toFixed(4)}°E\n\nWähle das beste Windmodell.` }],
    });
    const text = result.content[0]?.type === "text" ? result.content[0].text.trim() : "";
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

// ── Message classification ─────────────────────────────────────────────────

export async function classifyMessage(
  message: string,
  hasActiveLocation: boolean,
  anthropic: Anthropic,
): Promise<{ type: "ANALYSE" | "CHAT" | "UNCLEAR"; location?: string }> {
  try {
    const result = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 64,
      temperature: 0,
      system: `Klassifiziere die Benutzernachricht in eine von drei Kategorien:

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
      messages: [{ role: "user", content: message }],
    });
    const text = result.content[0]?.type === "text" ? result.content[0].text.trim() : "";
    if (text.startsWith("ANALYSE")) {
      const location = text.replace("ANALYSE", "").trim();
      return { type: "ANALYSE", location: location || undefined };
    }
    if (text === "UNCLEAR") return { type: "UNCLEAR" };
    return { type: "CHAT" };
  } catch (e) {
    console.error("Message classification failed:", e instanceof Error ? e.message : e);
    return { type: "CHAT" };
  }
}

// ── Nominatim geocoding ────────────────────────────────────────────────────

const WATER_CLASSES = new Set(["water", "waterway"]);
const WATER_NATURAL_TYPES = new Set(["water", "lake", "wetland", "bay", "strait", "sea"]);
const WATER_PLACE_TYPES = new Set(["sea", "ocean"]);

function isWaterFeature(cls: string, type: string): boolean {
  if (WATER_CLASSES.has(cls)) return true;
  if (cls === "natural" && WATER_NATURAL_TYPES.has(type)) return true;
  if (cls === "place" && WATER_PLACE_TYPES.has(type)) return true;
  return false;
}

export async function geocodeLocation(
  locationName: string,
  anthropic: Anthropic,
  hintCoords?: { lat: number; lon: number },
): Promise<{
  lat: number; lon: number; displayName: string;
  regionalModel: string; regionalModelLabel: string; regionalModelZoom: number;
  countryCode?: string; cityName?: string;
} | null> {
  try {
    const viewbox = hintCoords
      ? `&viewbox=${hintCoords.lon - 0.5},${hintCoords.lat + 0.5},${hintCoords.lon + 0.5},${hintCoords.lat - 0.5}&bounded=0`
      : "";
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(locationName)}&limit=1&extratags=1&namedetails=1&accept-language=en${viewbox}`,
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

    const regional = await getRegionalModelAI(lat, lon, result.display_name, anthropic);

    let countryCode: string | undefined;
    const searchName = result.display_name.split(",")[0].trim();
    const nd = result.namedetails || {};
    let cityName: string | undefined = nd["name:de"] || nd["name:en"] || searchName;

    if (isWater) {
      cityName = nd["name:de"] || nd["name"] || searchName;
      try {
        const reverseRes = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=4&addressdetails=1&accept-language=en`,
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
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10&addressdetails=1&accept-language=en`,
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
          const reverseName = reverseData.address?.city || reverseData.address?.town || reverseData.address?.village;
          if (reverseName) cityName = reverseName;
        }
      } catch {}
    }

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
