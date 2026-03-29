/**
 * AIWindy — Interaktiver Text-Chat (lokal, ohne UI)
 * Ausführen: npx tsx --env-file=.env server/test-chat.ts
 *
 * Testet die Segelrevier-Erkennung + JSON-Speicherung.
 * Wetteranalyse wird nicht gestartet.
 */

import readline from "readline";
import Anthropic from "@anthropic-ai/sdk";
import { detectSegelrevier, countryFlag, LAND_TO_COUNTRY_CODE } from "./location.js";
import { createAnalysis } from "./analysis-store.js";

// ── Anthropic Client ─────────────────────────────────────────────────────────

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

// ── Inline geocodeLocation (kopiert aus routes.ts, ohne getRegionalModelAI) ──

async function geocodeFallback(locationName: string): Promise<{
  lat: number; lon: number; displayName: string;
  countryCode?: string; cityName?: string;
} | null> {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(locationName)}&limit=1&extratags=1&namedetails=1&accept-language=en`,
      { headers: { "User-Agent": "AIWindy-Test/1.0" } },
    );
    if (!response.ok) return null;
    const results = await response.json() as Array<{
      lat: string; lon: string; display_name: string;
      namedetails?: Record<string, string>;
    }>;
    if (!results.length) return null;
    const r = results[0];
    const lat = parseFloat(r.lat);
    const lon = parseFloat(r.lon);
    const nd = r.namedetails || {};
    const cityName = nd["name:de"] || nd["name:en"] || r.display_name.split(",")[0].trim();

    let countryCode: string | undefined;
    try {
      const rev = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10&addressdetails=1&accept-language=en`,
        { headers: { "User-Agent": "AIWindy-Test/1.0" } },
      );
      if (rev.ok) {
        const revData = await rev.json() as { address?: { country_code?: string } };
        countryCode = revData.address?.country_code?.toUpperCase();
      }
    } catch { /* ignore */ }

    return { lat, lon, displayName: r.display_name, countryCode, cityName };
  } catch {
    return null;
  }
}

// ── Main loop ────────────────────────────────────────────────────────────────

async function handleInput(input: string) {
  console.log();
  console.log("  Erkenne Segelrevier...");

  const detected = await detectSegelrevier(input, anthropic);

  let lat: number, lon: number, countryCode: string, country: string;
  let sailingArea: string | null, revierType: "sea" | "lake" | null;
  let locationName: string | null = null;

  if (detected) {
    lat = detected.revier.lat;
    lon = detected.revier.lon;
    countryCode = detected.countryCode;
    country = detected.land;
    sailingArea = detected.revier.deutsch;
    revierType = detected.revier.typ === "meer" ? "sea" : "lake";

    const flag = countryFlag(countryCode);
    console.log(`  ✓ Segelrevier: ${sailingArea} ${flag}`);
    console.log(`    Typ: ${revierType} | Land: ${country} [${countryCode}]`);
    console.log(`    Koordinaten: ${lat}, ${lon}`);
  } else {
    console.log("    Kein Segelrevier → Geocoding...");
    const fallback = await geocodeFallback(input);
    if (!fallback) {
      console.log(`  ✗ Ort nicht gefunden: "${input}"`);
      console.log();
      return;
    }
    lat = fallback.lat;
    lon = fallback.lon;
    countryCode = fallback.countryCode ?? "";
    country = Object.entries(LAND_TO_COUNTRY_CODE).find(([, v]) => v === countryCode)?.[0] ?? countryCode;
    sailingArea = null;
    revierType = null;
    locationName = fallback.cityName ?? fallback.displayName.split(",")[0].trim();

    const flag = countryFlag(countryCode);
    console.log(`  ✓ Ort: ${locationName} ${flag} [${countryCode}]`);
    console.log(`    Koordinaten: ${lat.toFixed(4)}, ${lon.toFixed(4)}`);
  }

  const analysis = createAnalysis({
    userInput: input,
    sailingArea,
    type: revierType,
    country,
    countryCode,
    coordinates: { lat, lon },
    ...(locationName ? { location: locationName } : {}),
  });
  analysis.save();
  console.log(`  → JSON: ${analysis.filePath}`);
  console.log();
}

async function main() {
  if (!process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY) {
    console.error("Fehler: AI_INTEGRATIONS_ANTHROPIC_API_KEY nicht gesetzt.");
    console.error("Starte mit: npx tsx --env-file=.env server/test-chat.ts");
    process.exit(1);
  }

  console.log("── AIWindy Lokaler Test ────────────────────────────────────────");
  console.log("   Eingabe: Ort/Revier | 'exit' zum Beenden\n");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const prompt = () => rl.question("> ", async (line) => {
    const input = line.trim();
    if (!input || input === "exit" || input === "quit") {
      rl.close();
      return;
    }
    await handleInput(input);
    prompt();
  });
  prompt();
}

main().catch((e) => { console.error(e); process.exit(1); });
