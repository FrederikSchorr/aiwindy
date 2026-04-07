/**
 * AIWindy — Open-Meteo Temperatur-Test für Krk (Punat)
 * Ausführen: npx tsx tests/test-openmeteo-krk.ts
 *
 * Testet die Open-Meteo API als mögliche Quelle für Temperaturdaten.
 * Kein API-Key erforderlich.
 */

// Punat / Krk: lat=45.024, lon=14.652
const LAT = 45.024;
const LON = 14.652;
const TIMEZONE = "Europe/Zagreb";
const FORECAST_DAYS = 3;

const url = new URL("https://api.open-meteo.com/v1/forecast");
url.searchParams.set("latitude", String(LAT));
url.searchParams.set("longitude", String(LON));
url.searchParams.set("hourly", "temperature_2m,apparent_temperature,precipitation_probability,precipitation");
url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max");
url.searchParams.set("forecast_days", String(FORECAST_DAYS));
url.searchParams.set("timezone", TIMEZONE);

console.log(`\n── Open-Meteo Temperatur-Test: Krk / Punat (${LAT}°N, ${LON}°E) ──\n`);
console.log(`URL: ${url}\n`);

process.stdout.write("Fetching … ");
const res = await fetch(url.toString());
if (!res.ok) {
  console.error(`✗ HTTP ${res.status} ${res.statusText}`);
  process.exit(1);
}
const data = await res.json() as any;
console.log("✓\n");

// ── Tägliche Übersicht ────────────────────────────────────────────────────────
console.log("── Tageswerte ──────────────────────────────────────────────────");
const daily = data.daily;
for (let i = 0; i < daily.time.length; i++) {
  const date: string = daily.time[i];
  const min: number = daily.temperature_2m_min[i];
  const max: number = daily.temperature_2m_max[i];
  const precip: number = daily.precipitation_sum[i];
  const precipProb: number = daily.precipitation_probability_max[i];
  console.log(
    `  ${date}  ${min}–${max}°C  Niederschlag: ${precip}mm (${precipProb}%)`
  );
}

// ── Stundenweise (erste 24h) ──────────────────────────────────────────────────
console.log("\n── Stundenwerte (erste 24h) ────────────────────────────────────");
const hourly = data.hourly;
for (let i = 0; i < Math.min(24, hourly.time.length); i++) {
  const time: string = hourly.time[i];
  const temp: number = hourly.temperature_2m[i];
  const feels: number = hourly.apparent_temperature[i];
  const precip: number = hourly.precipitation[i];
  const precipProb: number = hourly.precipitation_probability[i];
  const bar = "█".repeat(Math.max(0, Math.round(temp / 3)));
  console.log(
    `  ${time.slice(11, 16)}  ${String(temp).padStart(5)}°C  (gefühlt ${String(feels).padStart(5)}°C)  ${String(precipProb).padStart(3)}% Regen ${precip > 0 ? `${precip}mm` : "     "}  ${bar}`
  );
}

// ── Rohdaten-Struktur ─────────────────────────────────────────────────────────
console.log("\n── API-Metadaten ───────────────────────────────────────────────");
console.log(`  latitude:   ${data.latitude}`);
console.log(`  longitude:  ${data.longitude}`);
console.log(`  elevation:  ${data.elevation}m`);
console.log(`  timezone:   ${data.timezone}`);
console.log(`  UTC-Offset: ${data.utc_offset_seconds / 3600}h`);
console.log(`  Einheiten:  Temp=${data.hourly_units?.temperature_2m}, Precip=${data.hourly_units?.precipitation}`);

console.log(`\n── Fertig ───────────────────────────────────────────────────────\n`);
