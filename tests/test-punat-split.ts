/**
 * AIWindy — Punat + Split + Zagreb end-to-end test
 * Ausführen: npx tsx --env-file=.env tests/test-punat-split.ts
 */

import Anthropic from "@anthropic-ai/sdk";
import { createAnalysis, type AnalysisPosition } from "../server/analysis-store.js";
import {
  fetchMeteonews, preprocessMeteonews,
  fetchKnmiChart, fetchKnmiForecast,
  fetchWetterzentraleChart, buildWetterzentraleCurrentUrl, buildWetterzentraleForecastUrl,
  METEONEWS_URL, KNMI_BASE_URL, WETTERZENTRALE_BASE_URL,
} from "../server/weather-europe.js";
import { fetchNationalWeather, preprocessNationalWeather, preprocessLocalWeather } from "../server/weather-national.js";
import { generateWeatherOutput } from "../server/weather-output.js";

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

const LOCATIONS: AnalysisPosition[] = [
  {
    userInput: "Punat",
    sailingArea: "Adria Nord (Kroatien)",
    type: "sea",
    country: "Kroatien",
    countryCode: "HR",
    coordinates: { lat: 44.6284, lon: 13.8522 },
  },
  {
    userInput: "Split",
    sailingArea: "Adria Mitte (Kroatien)",
    type: "sea",
    country: "Kroatien",
    countryCode: "HR",
    coordinates: { lat: 43.5081, lon: 16.4402 },
  },
  {
    userInput: "Zagreb",
    sailingArea: null,
    type: null,
    country: "Kroatien",
    countryCode: "HR",
    coordinates: { lat: 45.8150, lon: 15.9819 },
  },
];

console.log(`\n── AIWindy Punat + Split + Zagreb Test ─────────────────────────\n`);

// ── 1. Europe-Daten (einmalig) ────────────────────────────────────────────────

process.stdout.write("1. meteonews … ");
const meteonewsText = await fetchMeteonews();
let meteonewsPreprocessed: string | null = null;
if (meteonewsText) {
  console.log(`✓ ${meteonewsText.length} Zeichen`);
  process.stdout.write("   preprocessing … ");
  meteonewsPreprocessed = await preprocessMeteonews(meteonewsText, anthropic);
  console.log(`✓ ${meteonewsPreprocessed.length} Zeichen`);
} else {
  console.log("✗ nicht verfügbar");
}

process.stdout.write("2. temp850hpa current … ");
const wz850Current = await fetchWetterzentraleChart(buildWetterzentraleCurrentUrl());
console.log(wz850Current ? `✓ ${wz850Current.imageBase64.length} Bytes` : "✗");

process.stdout.write("3. temp850hpa forecast … ");
const wz850Forecast = await fetchWetterzentraleChart(buildWetterzentraleForecastUrl());
console.log(wz850Forecast ? `✓ ${wz850Forecast.imageBase64.length} Bytes` : "✗");

process.stdout.write("4. KNMI chart … ");
const knmi = await fetchKnmiChart();
console.log(knmi ? `✓ ${knmi.imageBase64.length} Bytes` : "✗");

process.stdout.write("5. KNMI forecast … ");
const knmiForecast = await fetchKnmiForecast();
console.log(knmiForecast ? `✓ ${knmiForecast.imageBase64.length} Bytes` : "✗");

// ── 2. Pro Ort: Nationale Rohdaten + Preprocessing + Speichern ───────────────

for (const position of LOCATIONS) {
  console.log(`\n── ${position.userInput} (${position.sailingArea ?? "kein Revier"}) ${"─".repeat(25)}`);

  const analysis = createAnalysis(position);

  // Europe raw + preprocessed
  analysis.data.weatherRaw["general weather"] = { source: "meteonews", text_de: meteonewsText || null };
  if (meteonewsText) analysis.data.sources.push(METEONEWS_URL);
  analysis.data.weatherPreprocessed.europe["general weather"] = { source: "meteonews", text_de: meteonewsPreprocessed };
  analysis.data.weatherPreprocessed.europe["temp850hpa current"] = {
    source: "Wetterzentrale", url: wz850Current?.url ?? null, imageBase64: wz850Current?.imageBase64 ?? null,
  };
  analysis.data.weatherPreprocessed.europe["temp850hpa forecast"] = {
    source: "Wetterzentrale", url: wz850Forecast?.url ?? null, imageBase64: wz850Forecast?.imageBase64 ?? null,
  };
  if (wz850Current || wz850Forecast) analysis.data.sources.push(WETTERZENTRALE_BASE_URL);
  analysis.data.weatherPreprocessed.europe["front current"] = {
    source: "KNMI", url: knmi?.url ?? null, imageBase64: knmi?.imageBase64 ?? null,
  };
  analysis.data.weatherPreprocessed.europe["front forecast"] = {
    source: "KNMI", url: knmiForecast?.url ?? null, imageBase64: knmiForecast?.imageBase64 ?? null,
  };
  if (knmi || knmiForecast) analysis.data.sources.push(KNMI_BASE_URL);

  // Nationale Rohdaten pro Ort (sailingArea-abhängig)
  process.stdout.write("  national weather … ");
  const national = await fetchNationalWeather(position.countryCode, position.coordinates, position.sailingArea);
  Object.assign(analysis.data.weatherRaw, national.data);
  for (const u of national.sourceUrls) analysis.data.sources.push(u);
  console.log(`✓  ${Object.keys(national.data).join(", ")}`);

  // Preprocessing national
  process.stdout.write("  preprocessing national … ");
  const nationalPre = await preprocessNationalWeather(analysis.data.weatherRaw, anthropic, position.countryCode);
  Object.assign(analysis.data.weatherPreprocessed.national, nationalPre);
  console.log("✓");

  // Preprocessing local
  process.stdout.write("  preprocessing local … ");
  const localPre = await preprocessLocalWeather(
    analysis.data.weatherRaw,
    { userInput: position.userInput, sailingArea: position.sailingArea },
    anthropic,
    position.countryCode,
  );
  Object.assign(analysis.data.weatherPreprocessed.local, localPre);
  const city = (localPre["temperature"] as any)?.city ?? "?";
  const temp = (localPre["temperature"] as any)?.text_de?.split("\n")[0] ?? "";
  console.log(`✓  city: ${city} | ${temp}`);

  analysis.save();

  process.stdout.write("  weather output … ");
  const weatherOutput = await generateWeatherOutput(analysis.data, anthropic);
  Object.assign(analysis.data.weatherOutput, weatherOutput);
  analysis.save();
  console.log("✓");
  const wo = weatherOutput as any;
  if (wo.windWaves?.text) console.log(`  windWaves: ${wo.windWaves.text.split("\n")[0]}`);

  console.log(`  → JSON: ${analysis.filePath}`);
}

console.log(`\n── Fertig ───────────────────────────────────────────────────────\n`);
