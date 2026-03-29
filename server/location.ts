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

export interface DetectedRevier {
  revier: SegelRevier;
  land: string;
  countryCode: string;
}

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
      readFileSync(new URL("../Segelreviere.json", import.meta.url), "utf-8"),
    ) as SegelreviereData;
  }
  return _cache;
}

function buildRevierList(data: SegelreviereData): string {
  const lines: string[] = [];
  for (const [land, { reviere }] of Object.entries(data)) {
    for (const r of reviere) {
      lines.push(`"${r.deutsch}" [${land}] — ${r.orte}`);
    }
  }
  return lines.join("\n");
}

// ── Core detection ─────────────────────────────────────────────────────────

export async function detectSegelrevier(
  locationName: string,
  anthropic: Anthropic,
): Promise<DetectedRevier | null> {
  const data = loadSegelreviere();
  const revierList = buildRevierList(data);

  const result = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 60,
    temperature: 0,
    system: `Du bist ein Experte für europäische Segelreviere.
Ordne den genannten Ort dem passendsten Segelrevier aus der Liste zu.
Berücksichtige dabei: Ortsnamen, Gewässernamen, Regionen, Inseln und gebräuchliche Alternativnamen.
Antworte NUR mit dem exakten Revier-Namen in Anführungszeichen, z.B.: "Adria Mitte (Kroatien)"
Falls kein Revier aus der Liste sinnvoll passt (z.B. Binnenstadt ohne Segelbezug): KEIN_REVIER`,
    messages: [
      {
        role: "user",
        content: `Ort: "${locationName}"\n\nVerfügbare Segelreviere:\n${revierList}`,
      },
    ],
  });

  const text = result.content[0]?.type === "text" ? result.content[0].text.trim() : "";
  if (!text || text === "KEIN_REVIER") return null;

  const nameMatch = text.match(/"([^"]+)"/);
  const matchedName = nameMatch ? nameMatch[1] : text;

  for (const [land, { reviere }] of Object.entries(data)) {
    const revier = reviere.find((r) => r.deutsch === matchedName);
    if (revier) {
      return {
        revier,
        land,
        countryCode: LAND_TO_COUNTRY_CODE[land] ?? "",
      };
    }
  }
  return null;
}

// ── Flag helper ────────────────────────────────────────────────────────────

export function countryFlag(countryCode: string): string {
  return COUNTRY_CODE_TO_FLAG[countryCode] ?? "";
}
