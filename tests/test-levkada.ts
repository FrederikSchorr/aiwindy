/**
 * AIWindy — Lefkada end-to-end test (OpenSkiron WRF 4km)
 * Ausführen: npx tsx --env-file=.env tests/test-levkada.ts
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

// Lefkada: sailingArea = Ionisches Meer Nord, city = Lefkada Stadt
const LOCATION: AnalysisPosition = {
  userInput: "Lefkada",
  country: "Griechenland",
  countryCode: "GR",
  windyModel: "ICON-EU 7km",
  sailingArea: {
    name_de: "Ionisches Meer Nord (Griechenland)",
    type: "sea",
    coordinates: { lat: 38.8, lon: 20 },
  },
  city: { name_de: "Lefkada", coordinates: { lat: 38.83, lon: 20.71 } },
};

console.log(`\n── AIWindy Lefkada Test (OpenSkiron WRF 4km) ────────────────────\n`);

// ── 1. Europe-Daten ───────────────────────────────────────────────────────────

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

// ── 2. Analyse aufbauen ───────────────────────────────────────────────────────

const analysis = createAnalysis(LOCATION);

analysis.data.weatherRaw["generalWeather"] = { source: "meteonews", text_de: meteonewsText || null };
if (meteonewsText) analysis.data.sources.europe.push(`[Europawetter](${METEONEWS_URL}) von Meteonews`);
analysis.data.weatherPreprocessed.europe["generalWeather"] = { source: "meteonews", text_de: meteonewsPreprocessed };
analysis.data.weatherPreprocessed.europe["temp850hpaCurrent"] = {
  source: "Wetterzentrale", url: wz850Current?.url ?? null, imageBase64: wz850Current?.imageBase64 ?? null,
};
analysis.data.weatherPreprocessed.europe["temp850hpaForecast"] = {
  source: "Wetterzentrale", url: wz850Forecast?.url ?? null, imageBase64: wz850Forecast?.imageBase64 ?? null,
};
if (wz850Current || wz850Forecast) analysis.data.sources.europe.push(`[Bodendruck + 1.500m Luftmassen](${WETTERZENTRALE_BASE_URL}) von Wetterzentrale`);
analysis.data.weatherPreprocessed.europe["frontCurrent"] = {
  source: "KNMI", url: knmi?.url ?? null, imageBase64: knmi?.imageBase64 ?? null,
};
analysis.data.weatherPreprocessed.europe["frontForecast"] = {
  source: "KNMI", url: knmiForecast?.url ?? null, imageBase64: knmiForecast?.imageBase64 ?? null,
};
if (knmi || knmiForecast) analysis.data.sources.europe.push(`[Wetterfronten](${KNMI_BASE_URL}) von KNMI`);

// ── 3. Nationale Daten (HNMS + OpenSkiron) ───────────────────────────────────

process.stdout.write("\n6. national weather (HNMS + OpenSkiron) … ");
const national = await fetchNationalWeather(
  LOCATION.countryCode,
  LOCATION.sailingArea?.coordinates,
  LOCATION.sailingArea?.name_de ?? null,
  LOCATION.sailingArea,
  LOCATION.city,
);
Object.assign(analysis.data.weatherRaw, national.data);
for (const u of national.sourceUrls) analysis.data.sources.national.push(u);
const rawKeys = Object.keys(national.data);
console.log(`✓  ${rawKeys.join(", ")}`);

// Raw preview
const wcr = national.data["greeceWindWaveCloudRain"] as any;
if (wcr?.timestamps?.length) {
  console.log(`   greeceWindCloudRain: ${wcr.timestamps.length} Zeitschritte`);
  console.log(`   Wind[0]: ${wcr.windDir[0]} ${wcr.windSpeedKt[0]} kt, Böe ${wcr.gustKt[0]} kt`);
  console.log(`   Wolken[0]: ${wcr.cloudCover[0]}%, Regen[0]: ${wcr.rainMm[0]}mm, CAPE[0]: ${wcr.cape[0]}`);
  if (wcr.waterTempC?.[0] != null) console.log(`   Wassertemp[0]: ${wcr.waterTempC[0]}°C`);
} else {
  console.log("   greeceWindCloudRain: NULL (OpenSkiron nicht verfügbar oder kein sailingArea)");
}

const gt = national.data["greeceTemperature"] as any;
if (gt?.temp2mC?.length) {
  console.log(`   greeceTemperature: ${gt.temp2mC.length} Werte, t2m[0]=${gt.temp2mC[0]}°C`);
}

const ggw = national.data["greeceGaleWarning"] as any;
if (ggw?.text) {
  console.log(`   greeceGaleWarning: ${ggw.text.length} Zeichen`);
} else {
  console.log("   greeceGaleWarning: NULL");
}

// ── 4. Preprocessing ──────────────────────────────────────────────────────────

process.stdout.write("7. preprocessing national … ");
const nationalPre = await preprocessNationalWeather(analysis.data.weatherRaw, anthropic, LOCATION.countryCode);
Object.assign(analysis.data.weatherPreprocessed.national, nationalPre);
const synopsis = (nationalPre["synopsis"] as any)?.text_de ?? null;
console.log("✓");
if (synopsis) console.log(`   synopsis: ${synopsis.split("\n")[0].slice(0, 100)}`);

process.stdout.write("8. preprocessing local … ");
const localPre = await preprocessLocalWeather(
  analysis.data.weatherRaw,
  { userInput: LOCATION.userInput, city: LOCATION.city?.name_de ?? LOCATION.userInput, sailingArea: LOCATION.sailingArea?.name_de ?? null },
  anthropic,
  LOCATION.countryCode,
);
Object.assign(analysis.data.weatherPreprocessed.local, localPre);
console.log("✓");

// Preview local preprocessed
const wind = (localPre["wind"] as any)?.text_de;
const crt = (localPre["cloudRainThunderstorm"] as any)?.text_de;
const temp = (localPre["temperature"] as any)?.text_de;
const waterTemp = (localPre["waterTemp"] as any)?.text_de;
const warnings = (localPre["warnings"] as any)?.text_de;
if (wind) console.log(`   wind: ${wind.split("\n")[0]}`);
if (crt) console.log(`   cloudRainThunderstorm: ${crt.split("\n")[0]}`);
if (temp) console.log(`   temperature: ${temp.split("\n")[0]}`);
if (waterTemp) console.log(`   waterTemp: ${waterTemp}`);
if (warnings) console.log(`   warnings: ${warnings.split("\n")[0]}`);

analysis.save();

// ── 5. Weather Output ─────────────────────────────────────────────────────────

process.stdout.write("9. weather output … ");
const weatherOutput = await generateWeatherOutput(analysis.data, anthropic);
Object.assign(analysis.data.weatherOutput, weatherOutput);
analysis.save();
console.log("✓");

const wo = weatherOutput as any;
if (wo.windWaves?.text) console.log(`   windWaves: ${wo.windWaves.text.split("\n")[0]}`);

console.log(`\n→ JSON: ${analysis.filePath}`);
console.log(`\n── Fertig ───────────────────────────────────────────────────────\n`);
