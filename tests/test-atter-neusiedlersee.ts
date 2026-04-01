/**
 * AIWindy — Wörthersee + Neusiedler See end-to-end test (raw data only)
 * Ausführen: npx tsx --env-file=.env tests/test-woerthersee.ts
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
    userInput: "Attersee",
    country: "Österreich",
    countryCode: "AT",
    sailingArea: { name_de: "Attersee (Österreich)", type: "lake", coordinates: { lat: 47.87, lon: 13.54 } },
    city: { name_de: "Attersee", coordinates: { lat: 47.87, lon: 13.54 } },
  },
  {
    userInput: "Neusiedler See",
    country: "Österreich",
    countryCode: "AT",
    sailingArea: { name_de: "Neusiedler See (Österreich)", type: "lake", coordinates: { lat: 47.80, lon: 16.75 } },
    city: { name_de: "Neusiedl am See", coordinates: { lat: 47.95, lon: 16.84 } },
  },
];

console.log(`\n── AIWindy Attersee + Neusiedler See Test ───────────────────────\n`);

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

// ── 2. Pro Ort: Nationale Rohdaten + Speichern ───────────────────────────────

for (const position of LOCATIONS) {
  console.log(`\n── ${position.userInput} (${position.sailingArea?.name_de ?? "kein Revier"}) ${"─".repeat(25)}`);

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

  // Nationale Rohdaten (pro Ort, wegen koordinatenabhängiger GeoSphere-Timeseries)
  process.stdout.write("  national weather … ");
  const coords = position.sailingArea?.coordinates ?? position.city?.coordinates ?? { lat: 0, lon: 0 };
  const national = await fetchNationalWeather(
    position.countryCode,
    coords,
    position.sailingArea?.name_de ?? null,
    position.sailingArea,
    position.city,
  );
  Object.assign(analysis.data.weatherRaw, national.data);
  for (const u of national.sourceUrls) analysis.data.sources.push(u);

  const rawKeys = Object.keys(national.data);
  console.log(`✓  ${rawKeys.join(", ")}`);

  // Rohdaten-Preview
  const flightWeather = national.data["austriaFlightWeather"] as any;
  if (flightWeather?.today_de) {
    console.log(`  flight today: ${flightWeather.today_de.slice(0, 100)}…`);
  }
  const windCloudRain = national.data["austriaWindCloudRain"] as any;
  if (windCloudRain?.timestamps?.length) {
    console.log(`  windCloudRain: ${windCloudRain.timestamps.length} Zeitpunkte, erste: ${windCloudRain.timestamps[0]}`);
    console.log(`    Wind[0]: ${windCloudRain.wind_dir[0]} ${windCloudRain.wind_speed_kt[0]} kt, Böe ${windCloudRain.gust_kt[0]} kt`);
  }
  const tempData = national.data["austriaTemperature"] as any;
  if (tempData?.temp_2m_C?.length) {
    console.log(`    Temp[0]: ${tempData.temp_2m_C[0]}°C (city: ${(tempData.city as any)?.name_de ?? "?"})`);
  }
  const lakeWarnings = national.data["austriaNeusiedlerLakeWarnings"] as any;
  if (lakeWarnings?.text_de) {
    console.log(`  LSZ: ${lakeWarnings.text_de.split("\n").slice(0, 3).join(" | ")}`);
  }

  const nationalPre = await preprocessNationalWeather(analysis.data.weatherRaw, anthropic, position.countryCode);
  Object.assign(analysis.data.weatherPreprocessed.national, nationalPre);
  const synopsis = (nationalPre["synopsis"] as any)?.text_de ?? null;
  if (synopsis) console.log(`  synopsis: ${synopsis.split("\n")[0].slice(0, 80)}…`);

  const localPre = await preprocessLocalWeather(
    analysis.data.weatherRaw,
    { userInput: position.userInput, city: position.city?.name_de ?? position.userInput, sailingArea: position.sailingArea?.name_de ?? null },
    anthropic,
    position.countryCode,
  );
  Object.assign(analysis.data.weatherPreprocessed.local, localPre);
  const temp = (localPre["temperature"] as any)?.text_de ?? "–";
  console.log(`  temperature: ${temp.split("\n")[0]}`);

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
