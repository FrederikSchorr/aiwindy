/**
 * AIWindy — Open-Meteo Test: Forecast API (Krk/Punat) + Marine API (Kythira-See)
 * Ausführen: npx tsx tests/test-openmeteo-krk.ts
 *
 * Testet Open-Meteo als mögliche Quelle für Wind/Regen/CAPE/Temperatur (Forecast API)
 * und Welle/Wassertemperatur (Marine API) — als Ersatz-Kandidat für OpenSkiron (Griechenland).
 * Kein API-Key erforderlich.
 *
 * Gibt bei beiden APIs das zurückgemeldete `model`-Feld (falls vorhanden) sowie
 * generationtime_ms aus, damit sich prüfen lässt, welches Modell Open-Meteo
 * für die jeweilige Koordinate tatsächlich verwendet.
 */

// ── 1. Forecast API: Punat/Krk (Kroatien) ──────────────────────────────────────
const KRK_LAT = 45.024;
const KRK_LON = 14.652;
const KRK_TZ = "Europe/Zagreb";

// ── 2. Marine API: Kythira-See (Griechenland, EMY-Revier #29, windyModel iconEu) ──
const KITHIRA_LAT = 36.5;
const KITHIRA_LON = 22.8;
const KITHIRA_TZ = "Europe/Athens";

const FORECAST_DAYS = 3;

async function fetchJson(url: URL): Promise<any> {
  const res = await fetch(url.toString());
  if (!res.ok) {
    console.error(`✗ HTTP ${res.status} ${res.statusText} — ${url}`);
    return null;
  }
  return res.json();
}

// ── Forecast API (Wind, Regen, CAPE, Wolken, Lufttemp) ─────────────────────────

async function testForecastApi() {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(KRK_LAT));
  url.searchParams.set("longitude", String(KRK_LON));
  url.searchParams.set(
    "hourly",
    "temperature_2m,apparent_temperature,precipitation_probability,precipitation,cape,cloudcover,windspeed_10m,winddirection_10m,windgusts_10m",
  );
  url.searchParams.set(
    "daily",
    "temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max",
  );
  url.searchParams.set("forecast_days", String(FORECAST_DAYS));
  url.searchParams.set("timezone", KRK_TZ);
  url.searchParams.set("models", "best_match");

  console.log(`\n── Open-Meteo Forecast API: Krk / Punat (${KRK_LAT}°N, ${KRK_LON}°E) ──\n`);
  console.log(`URL: ${url}\n`);

  process.stdout.write("Fetching … ");
  const data = await fetchJson(url);
  if (!data) return;
  console.log("✓\n");

  console.log(`  Modell (best_match aufgelöst zu):     ${data.model ?? "— nicht im Response enthalten —"}`);
  console.log(`  Generation time:                      ${data.generationtime_ms} ms`);
  console.log(`  Elevation:                             ${data.elevation}m`);
  console.log(`  Timezone:                              ${data.timezone} (UTC${data.utc_offset_seconds >= 0 ? "+" : ""}${data.utc_offset_seconds / 3600})`);

  console.log("\n── Tageswerte ──────────────────────────────────────────────────");
  const daily = data.daily;
  for (let i = 0; i < daily.time.length; i++) {
    console.log(
      `  ${daily.time[i]}  ${daily.temperature_2m_min[i]}–${daily.temperature_2m_max[i]}°C  Niederschlag: ${daily.precipitation_sum[i]}mm (${daily.precipitation_probability_max[i]}%)`,
    );
  }

  console.log("\n── Stundenwerte (erste 24h) ────────────────────────────────────");
  const h = data.hourly;
  for (let i = 0; i < Math.min(24, h.time.length); i++) {
    const capeFlag = h.cape[i] >= 1000 ? " ⛈️ CAPE≥1000" : "";
    console.log(
      `  ${h.time[i].slice(11, 16)}  ${String(h.temperature_2m[i]).padStart(5)}°C  Wind ${String(h.winddirection_10m[i]).padStart(3)}° ${String(h.windspeed_10m[i]).padStart(4)}km/h Böe ${String(h.windgusts_10m[i]).padStart(4)}km/h  Wolken ${String(h.cloudcover[i]).padStart(3)}%  Regen ${h.precipitation[i]}mm (${h.precipitation_probability[i]}%)  CAPE=${h.cape[i]}${capeFlag}`,
    );
  }

  console.log(`\n  Einheiten: Temp=${data.hourly_units?.temperature_2m}, Wind=${data.hourly_units?.windspeed_10m}, CAPE=${data.hourly_units?.cape}`);
}

// ── Marine API (Welle, Wassertemperatur) ────────────────────────────────────────

async function testMarineApi() {
  const url = new URL("https://marine-api.open-meteo.com/v1/marine");
  url.searchParams.set("latitude", String(KITHIRA_LAT));
  url.searchParams.set("longitude", String(KITHIRA_LON));
  url.searchParams.set(
    "hourly",
    "wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,sea_surface_temperature",
  );
  url.searchParams.set("forecast_days", String(FORECAST_DAYS));
  url.searchParams.set("timezone", KITHIRA_TZ);

  console.log(`\n\n── Open-Meteo Marine API: Kythira-See (${KITHIRA_LAT}°N, ${KITHIRA_LON}°E) ──\n`);
  console.log(`URL: ${url}\n`);

  process.stdout.write("Fetching … ");
  const data = await fetchJson(url);
  if (!data) {
    console.log("✗ nicht verfügbar (evtl. Koordinate außerhalb Modellabdeckung oder API down)");
    return;
  }
  console.log("✓\n");

  console.log(`  Modell (falls im Response enthalten):  ${data.model ?? "— nicht im Response enthalten —"}`);
  console.log(`  Generation time:                       ${data.generationtime_ms} ms`);
  console.log(`  Timezone:                               ${data.timezone}`);

  console.log("\n── Stundenwerte Welle + Wassertemp (erste 24h) ──────────────────");
  const h = data.hourly;
  if (!h) {
    console.log("  keine hourly-Daten im Response — Koordinate evtl. außerhalb Modellabdeckung");
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  for (let i = 0; i < Math.min(24, h.time.length); i++) {
    const sst = h.sea_surface_temperature?.[i];
    console.log(
      `  ${h.time[i].slice(11, 16)}  Welle ${String(h.wave_height[i]).padStart(4)}m aus ${String(h.wave_direction[i]).padStart(3)}° Periode ${String(h.wave_period[i]).padStart(4)}s  Dünung ${String(h.swell_wave_height[i]).padStart(4)}m/${String(h.swell_wave_period[i]).padStart(4)}s  Wassertemp ${sst != null ? sst + "°C" : "—"}`,
    );
  }

  console.log(`\n  Einheiten: Welle=${data.hourly_units?.wave_height}, SST=${data.hourly_units?.sea_surface_temperature ?? "?"}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

await testForecastApi();
await testMarineApi();

console.log(`\n── Fertig ───────────────────────────────────────────────────────\n`);
