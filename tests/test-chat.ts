/**
 * AIWindy — Interaktiver Text-Chat (lokal, ohne UI)
 * Ausführen: npx tsx --env-file=.env tests/test-chat.ts
 *
 * Testet die Segelrevier-Erkennung + JSON-Speicherung.
 * Wetteranalyse wird nicht gestartet.
 */

import readline from "readline";
import Anthropic from "@anthropic-ai/sdk";
import { detectLocation, countryFlag, LAND_TO_COUNTRY_CODE } from "../server/location.js";
import { createAnalysis } from "../server/analysis-store.js";
import { fetchMeteonews, preprocessMeteonews, fetchWetterzentraleChart, buildWetterzentraleCurrentUrl, buildWetterzentraleForecastUrl, fetchKnmiChart, fetchKnmiForecast, METEONEWS_URL, KNMI_BASE_URL, WETTERZENTRALE_BASE_URL } from "../server/weather-europe.js";
import { fetchNationalWeather, preprocessNationalWeather, preprocessLocalWeather } from "../server/weather-national.js";
import { generateWeatherOutput } from "../server/weather-output.js";

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

  const detected = await detectLocation(input, anthropic);

  if (detected === null) {
    console.log(`  ✗ Ort nicht erkannt: "${input}"`);
    console.log();
    return;
  }

  const cityNameFromSonnet = detected.city;
  const geocoded = await geocodeFallback(cityNameFromSonnet);

  const sailingAreaObj = detected.kind === "revier"
    ? {
        name_de: detected.revier.deutsch,
        type: detected.revier.typ === "meer" ? "sea" as const : "lake" as const,
        coordinates: { lat: detected.revier.lat, lon: detected.revier.lon },
      }
    : null;

  const cityObj = geocoded
    ? { name_de: geocoded.cityName ?? cityNameFromSonnet, coordinates: { lat: geocoded.lat, lon: geocoded.lon } }
    : { name_de: cityNameFromSonnet, coordinates: { lat: 0, lon: 0 } };

  const coords = sailingAreaObj?.coordinates ?? cityObj.coordinates;
  const lat = coords.lat;
  const lon = coords.lon;
  const countryCode = geocoded?.countryCode ?? (detected.kind === "revier" ? detected.countryCode : "") ?? "";
  const country = Object.entries(LAND_TO_COUNTRY_CODE).find(([, v]) => v === countryCode)?.[0] ?? countryCode;

  const flag = countryFlag(countryCode);
  if (sailingAreaObj) {
    console.log(`  ✓ Segelrevier: ${sailingAreaObj.name_de} ${flag} | city: ${cityObj.name_de}`);
    console.log(`    Typ: ${sailingAreaObj.type} | Land: ${country} [${countryCode}] | Koord: ${lat}, ${lon}`);
  } else {
    console.log(`  ✓ Ort: ${cityObj.name_de} ${flag} [${countryCode}]`);
    console.log(`    Koordinaten: ${lat.toFixed(4)}, ${lon.toFixed(4)}`);
  }

  const analysis = createAnalysis({
    userInput: input,
    country,
    countryCode,
    sailingArea: sailingAreaObj,
    city: cityObj,
  });
  // meteonews
  const meteonewsText = await fetchMeteonews();
  analysis.data.weatherRaw["generalWeather"] = { source: "meteonews", text_de: meteonewsText || null };
  if (meteonewsText) {
    analysis.data.sources.push(METEONEWS_URL);
    const preprocessed = await preprocessMeteonews(meteonewsText, anthropic);
    analysis.data.weatherPreprocessed.europe["generalWeather"] = { source: "meteonews", text_de: preprocessed || null };
    console.log(`  ✓ meteonews (${meteonewsText.length} Zeichen)`);
  } else {
    analysis.data.weatherPreprocessed.europe["generalWeather"] = { source: "meteonews", text_de: null };
  }
  // Wetterzentrale 850 hPa
  let wzSourceAdded = false;
  const wz850Current = await fetchWetterzentraleChart(buildWetterzentraleCurrentUrl());
  analysis.data.weatherPreprocessed.europe["temp850hpa current"] = { source: "Wetterzentrale", url: wz850Current?.url ?? null, imageBase64: wz850Current?.imageBase64 ?? null };
  if (wz850Current && !wzSourceAdded) { analysis.data.sources.push(WETTERZENTRALE_BASE_URL); wzSourceAdded = true; }
  const wz850Forecast = await fetchWetterzentraleChart(buildWetterzentraleForecastUrl());
  analysis.data.weatherPreprocessed.europe["temp850hpa forecast"] = { source: "Wetterzentrale", url: wz850Forecast?.url ?? null, imageBase64: wz850Forecast?.imageBase64 ?? null };
  if (wz850Forecast && !wzSourceAdded) { analysis.data.sources.push(WETTERZENTRALE_BASE_URL); }
  console.log(`  ✓ Temperatur 850hpa Karten von wetterzentrale.de geladen`);
  // KNMI
  let knmiSourceAdded = false;
  const knmi = await fetchKnmiChart();
  analysis.data.weatherPreprocessed.europe["front current"] = { source: "KNMI", url: knmi?.url ?? null, imageBase64: knmi?.imageBase64 ?? null };
  if (knmi && !knmiSourceAdded) { analysis.data.sources.push(KNMI_BASE_URL); knmiSourceAdded = true; }
  const knmiForecast = await fetchKnmiForecast();
  analysis.data.weatherPreprocessed.europe["front forecast"] = { source: "KNMI", url: knmiForecast?.url ?? null, imageBase64: knmiForecast?.imageBase64 ?? null };
  if (knmiForecast && !knmiSourceAdded) { analysis.data.sources.push(KNMI_BASE_URL); }
  console.log(`  ✓ Fronten Karten von KNMI geladen`);

  const national = await fetchNationalWeather(countryCode, { lat, lon }, sailingAreaObj?.name_de ?? null, sailingAreaObj, cityObj);
  Object.assign(analysis.data.weatherRaw, national.data);
  for (const u of national.sourceUrls) analysis.data.sources.push(u);
  const nationalCount = Object.keys(national.data).length;
  if (nationalCount > 0) console.log(`  ✓ Nationale Wetterdaten (${countryCode}): ${nationalCount} Quellen`);

  const nationalPre = await preprocessNationalWeather(analysis.data.weatherRaw, anthropic, countryCode);
  Object.assign(analysis.data.weatherPreprocessed.national, nationalPre);
  const localPre = await preprocessLocalWeather(
    analysis.data.weatherRaw,
    { userInput: input, city: cityObj.name_de, sailingArea: sailingAreaObj?.name_de ?? null },
    anthropic,
    countryCode,
  );
  Object.assign(analysis.data.weatherPreprocessed.local, localPre);
  console.log(`  ✓ Preprocessing national + local`);

  analysis.save();

  process.stdout.write("  weather output … ");
  const weatherOutput = await generateWeatherOutput(analysis.data, anthropic);
  Object.assign(analysis.data.weatherOutput, weatherOutput);
  analysis.save();
  console.log("✓");
  const wo = weatherOutput as any;
  if (wo.windWaves?.text) console.log(`  windWaves: ${wo.windWaves.text.split("\n")[0]}`);

  console.log(`  → JSON: ${analysis.filePath}`);
  console.log();
}

async function main() {
  if (!process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY) {
    console.error("Fehler: AI_INTEGRATIONS_ANTHROPIC_API_KEY nicht gesetzt.");
    console.error("Starte mit: npx tsx --env-file=.env tests/test-chat.ts");
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
