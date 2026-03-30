/**
 * AIWindy — Single-location end-to-end test
 * Ausführen: npx tsx --env-file=.env tests/test-single.ts [Ort]
 * Beispiel:  npx tsx --env-file=.env tests/test-single.ts Punat
 */

import Anthropic from "@anthropic-ai/sdk";
import { createAnalysis } from "../server/analysis-store.js";
import { fetchMeteonews, preprocessMeteonews, fetchKnmiChart, fetchKnmiForecast, fetchWetterzentraleChart, buildWetterzentraleCurrentUrl, buildWetterzentraleForecastUrl, METEONEWS_URL, KNMI_BASE_URL, WETTERZENTRALE_BASE_URL } from "../server/weather-sources.js";
import { fetchNationalWeather, preprocessNationalWeather, preprocessLocalWeather } from "../server/national-weather.js";

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

console.log(`\n── AIWindy Single Test ─────────────────────────────────────────\n`);

// ── Position (fest) ───────────────────────────────────────────────────────────

const analysis = createAnalysis({
  userInput: "Hvar",
  sailingArea: "Adria Süd (Kroatien)",
  type: "sea",
  country: "Kroatien",
  countryCode: "HR",
  coordinates: { lat: 42.6702, lon: 17.1459 },
});
console.log(`1. Position    ✓ ${analysis.data.position.sailingArea} 🇭🇷 [HR]`);

// ── 2. Wetterdaten scrapen ────────────────────────────────────────────────────

process.stdout.write("2. meteonews … ");
const meteonewsText = await fetchMeteonews();
analysis.data.weatherData.raw["general weather"] = { source: "meteonews", german: meteonewsText || null };
if (meteonewsText) {
  analysis.data.sources.push(METEONEWS_URL);
  console.log(`✓ ${meteonewsText.length} Zeichen`);
  console.log(`   Preview: ${meteonewsText.slice(0, 120)}…`);
  process.stdout.write("   preprocessing … ");
  const preprocessed = await preprocessMeteonews(meteonewsText, anthropic);
  analysis.data.weatherData.preprocessed.europe["general weather"] = {
    source: "meteonews", german: preprocessed || null,
  };
  console.log(`✓ ${preprocessed.length} Zeichen`);
} else {
  analysis.data.weatherData.preprocessed.europe["general weather"] = {
    source: "meteonews", german: null,
  };
  console.log("✗ nicht verfügbar");
}

// ── 3. Wetterzentrale 850 hPa ─────────────────────────────────────────────────

let wzSourceAdded = false;
process.stdout.write("3. temp850hpa current … ");
const wz850Current = await fetchWetterzentraleChart(buildWetterzentraleCurrentUrl());
analysis.data.weatherData.preprocessed.europe["temp850hpa current"] = {
  source: "Wetterzentrale", url: wz850Current?.url ?? null, imageBase64: wz850Current?.imageBase64 ?? null,
};
if (wz850Current) {
  if (!wzSourceAdded) { analysis.data.sources.push(WETTERZENTRALE_BASE_URL); wzSourceAdded = true; }
  console.log(`✓ ${wz850Current.imageBase64.length} Bytes → ${wz850Current.url}`);
} else {
  console.log("✗ nicht verfügbar");
}

process.stdout.write("4. temp850hpa forecast … ");
const wz850Forecast = await fetchWetterzentraleChart(buildWetterzentraleForecastUrl());
analysis.data.weatherData.preprocessed.europe["temp850hpa forecast"] = {
  source: "Wetterzentrale", url: wz850Forecast?.url ?? null, imageBase64: wz850Forecast?.imageBase64 ?? null,
};
if (wz850Forecast) {
  if (!wzSourceAdded) { analysis.data.sources.push(WETTERZENTRALE_BASE_URL); wzSourceAdded = true; }
  console.log(`✓ ${wz850Forecast.imageBase64.length} Bytes → ${wz850Forecast.url}`);
} else {
  console.log("✗ nicht verfügbar");
}

// ── 5. KNMI Karten ────────────────────────────────────────────────────────────

let knmiSourceAdded = false;
process.stdout.write("5. KNMI chart … ");
const knmi = await fetchKnmiChart();
analysis.data.weatherData.preprocessed.europe["front current"] = {
  source: "KNMI", url: knmi?.url ?? null, imageBase64: knmi?.imageBase64 ?? null,
};
if (knmi) {
  if (!knmiSourceAdded) { analysis.data.sources.push(KNMI_BASE_URL); knmiSourceAdded = true; }
  console.log(`✓ ${knmi.imageBase64.length} Bytes → ${knmi.url}`);
} else {
  console.log("✗ nicht verfügbar");
}

process.stdout.write("6. KNMI forecast … ");
const knmiForecast = await fetchKnmiForecast();
analysis.data.weatherData.preprocessed.europe["front forecast"] = {
  source: "KNMI", url: knmiForecast?.url ?? null, imageBase64: knmiForecast?.imageBase64 ?? null,
};
if (knmiForecast) {
  if (!knmiSourceAdded) { analysis.data.sources.push(KNMI_BASE_URL); knmiSourceAdded = true; }
  console.log(`✓ ${knmiForecast.imageBase64.length} Bytes → ${knmiForecast.url}`);
} else {
  console.log("✗ nicht verfügbar");
}

// ── 7. Nationale Wetterdaten ──────────────────────────────────────────────────

process.stdout.write("7. national weather … ");
const national = await fetchNationalWeather(analysis.data.position.countryCode);
Object.assign(analysis.data.weatherData.raw, national.data);
if (national.sourceUrl) analysis.data.sources.push(national.sourceUrl);
const nationalCount = Object.keys(national.data).length;
console.log(nationalCount > 0 ? `✓ ${nationalCount} Quellen (${analysis.data.position.countryCode})` : "— nicht konfiguriert");

// ── 8. Preprocessing national ────────────────────────────────────────────────

process.stdout.write("8. preprocessing national … ");
const nationalPre = await preprocessNationalWeather(analysis.data.weatherData.raw, anthropic);
Object.assign(analysis.data.weatherData.preprocessed.national, nationalPre);
console.log(`✓`);

// ── 9. Preprocessing local ────────────────────────────────────────────────────

process.stdout.write("9. preprocessing local … ");
const localPre = await preprocessLocalWeather(
  analysis.data.weatherData.raw,
  { userInput: analysis.data.position.userInput, sailingArea: analysis.data.position.sailingArea },
  anthropic,
);
Object.assign(analysis.data.weatherData.preprocessed.local, localPre);
console.log(`✓`);

// ── Speichern ─────────────────────────────────────────────────────────────────

analysis.save();
console.log(`\n→ JSON: ${analysis.filePath}\n`);
