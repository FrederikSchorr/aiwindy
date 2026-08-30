/**
 * Deterministic regression coverage for the local sailing forecast pipeline.
 *
 * Run with: npm run test:weather
 */

import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  fetchNationalWeather,
  preprocessLocalWeather,
} from "../server/weather-national.js";
import {
  buildSection4WeatherContext,
  preprocessOpenMeteoLocal,
  classifyCloudType,
  estimateCloudBaseM,
} from "../server/weather-open-meteo.js";
import { enforceSection4Output } from "../server/weather-output.js";
import {
  getSanitizedAnalysisExport,
  type AnalysisJson,
} from "../server/analysis-store.js";
import { HNMS_BULLETIN_URL } from "../server/weather-national-greece.js";
import CityMeteogram, { cloudBaseTone, cloudTypeColor, extractCityMeteogram, formatCloudBase, temperatureColor } from "../client/src/components/city-meteogram";
import SeaWindForecast, { extractSeaWindForecast } from "../client/src/components/sea-wind-forecast";

const REAL_DATE = globalThis.Date;
const FIXED_NOW = "2026-08-22T09:00:00.000Z";
const AREA = {
  name_de: "Testrevier",
  type: "lake" as const,
  coordinates: { lat: 47.8, lon: 16.75 },
};
const CITY = {
  name_de: "Teststadt",
  coordinates: { lat: 47.95, lon: 16.84 },
};

type MockResponse = {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<Record<string, unknown>>;
};

function response(body: unknown, status = 200): MockResponse {
  const isText = typeof body === "string";
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => isText ? body as string : JSON.stringify(body),
    json: async () => isText ? JSON.parse(body as string) : body as Record<string, unknown>,
  };
}

function withFixedDate<T>(callback: () => Promise<T>): Promise<T> {
  const DateConstructor = REAL_DATE;
  class FixedDate extends DateConstructor {
    constructor(...args: any[]) {
      super(...(args.length ? args : [FIXED_NOW]) as [any]);
    }

    static now(): number {
      return DateConstructor.parse(FIXED_NOW);
    }
  }
  globalThis.Date = FixedDate as unknown as DateConstructor;
  return callback().finally(() => {
    globalThis.Date = DateConstructor;
  });
}

function hourlyPayload(
  coordinates: { lat: number; lon: number },
  fields: "full" | "temperature" = "full",
): Record<string, unknown> {
  const start = new REAL_DATE(FIXED_NOW);
  const timestamps = Array.from({ length: 144 }, (_, index) =>
    new REAL_DATE(start.getTime() + index * 60 * 60 * 1000).toISOString(),
  );
  const hourly: Record<string, unknown[]> = {
    time: timestamps,
    temperature_2m: timestamps.map((_, index) => 18 + (index % 12)),
  };
  if (fields === "full") {
    hourly.is_day = timestamps.map((_, index) => index % 2);
    hourly.precipitation_probability = timestamps.map(() => 10);
    hourly.rain = timestamps.map(() => 0);
    hourly.weather_code = timestamps.map(() => 1);
    hourly.cloud_cover = timestamps.map((_, index) => index % 2 ? 35 : 25);
    hourly.wind_speed_10m = timestamps.map((_, index) => 8 + (index % 4));
    hourly.wind_direction_10m = timestamps.map(() => 292);
    hourly.wind_gusts_10m = timestamps.map((_, index) => 12 + (index % 4));
    hourly.cape = timestamps.map(() => 0);
  }
  return {
    timezone: "Europe/Vienna",
    latitude: coordinates.lat,
    longitude: coordinates.lon,
    hourly_units: {},
    hourly,
  };
}

function marinePayload(
  coordinates: { lat: number; lon: number },
  withWaves: boolean,
): Record<string, unknown> {
  const timestamps = Array.from({ length: 144 }, (_, index) =>
    new REAL_DATE(new REAL_DATE(FIXED_NOW).getTime() + index * 60 * 60 * 1000).toISOString(),
  );
  const waveValues = timestamps.map(() => withWaves ? 0.8 : null);
  return {
    timezone: "Europe/Vienna",
    latitude: coordinates.lat,
    longitude: coordinates.lon,
    hourly: {
      time: timestamps,
      wave_height: waveValues,
      wave_direction: timestamps.map(() => 270),
      wave_period: timestamps.map(() => 4),
      wind_wave_height: waveValues,
      wind_wave_direction: timestamps.map(() => 270),
      wind_wave_period: timestamps.map(() => 4),
      swell_wave_height: waveValues,
      swell_wave_direction: timestamps.map(() => 270),
      swell_wave_period: timestamps.map(() => 4),
    },
  };
}

function anthropicStub(): Anthropic {
  return {
    messages: {
      create: async (request: any) => {
        const prompt = String(request.messages?.[0]?.content ?? "");
        if (prompt.includes("Windverlauf")) return { content: [{ type: "text", text: "Nationale Winddetails" }] };
        if (prompt.includes("Bewölkung und Niederschlag")) return { content: [{ type: "text", text: "Nationale Wolken- und Regendetails" }] };
        if (prompt.includes("Windprognose für sechs Tage")) {
          return { content: [{ type: "text", text: sixDayText("Windtag") }] };
        }
        if (prompt.includes("Beschreibe NUR die vorherrschende Seegangsstärke")) {
          return { content: [{ type: "text", text: "Sa 22.08.: See 3 leicht bewegt\nSo 23.08.: See 3 leicht bewegt" }] };
        }
        if (prompt.includes("Bewölkung, Niederschlag und Gewitterrisiko")) {
          return { content: [{ type: "text", text: sixDayText("Wettertag") }] };
        }
        return { content: [{ type: "text", text: "NONE" }] };
      },
    },
  } as unknown as Anthropic;
}

function sixDayText(prefix: string): string {
  return [
    "Sa 22.08.: " + prefix + " 1",
    "So 23.08.: " + prefix + " 2",
    "Mo 24.08.: " + prefix + " 3",
    "Di 25.08.: " + prefix + " 4",
    "Mi 26.08.: " + prefix + " 5",
    "Do 27.08.: " + prefix + " 6",
  ].join("\n");
}

function installFetch(
  resolver: (url: string) => MockResponse,
): { calls: string[]; restore: () => void } {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    return resolver(url) as unknown as Response;
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

function openMeteoResponse(url: string, withWaves = false): MockResponse {
  const parsed = new URL(url);
  const coordinates = {
    lat: Number(parsed.searchParams.get("latitude")),
    lon: Number(parsed.searchParams.get("longitude")),
  };
  if (url.startsWith("https://marine-api.open-meteo.com")) {
    return response(marinePayload(coordinates, withWaves));
  }
  const fields = parsed.searchParams.get("hourly") === "temperature_2m"
    ? "temperature"
    : "full";
  return response(hourlyPayload(coordinates, fields));
}

async function testNationalCoverageAndPrecedence(): Promise<void> {
  const mock = installFetch((url) => {
    if (url === HNMS_BULLETIN_URL) return response("", 404);
    if (url.includes("austrocontrol.at")) {
      return response("<html>FXOS1 WETTERLAGE: sonnig. WETTERABLAUF FXOS2 WETTERLAGE: trocken. WETTERABLAUF</html>");
    }
    if (url.includes("geosphere.at") && url.includes("parameters=t2m")) {
      return response({
        timestamps: Array.from({ length: 48 }, (_, index) => new REAL_DATE(new REAL_DATE(FIXED_NOW).getTime() + index * 3600000).toISOString()),
        features: [{ properties: { parameters: { t2m: { data: Array.from({ length: 48 }, () => 22) } } } }],
      });
    }
    if (url.includes("geosphere.at")) {
      return response({
        timestamps: Array.from({ length: 48 }, (_, index) => new REAL_DATE(new REAL_DATE(FIXED_NOW).getTime() + index * 3600000).toISOString()),
        features: [{ properties: { parameters: {
          u10m: { data: Array.from({ length: 48 }, () => -4) },
          v10m: { data: Array.from({ length: 48 }, () => -4) },
          ugust: { data: Array.from({ length: 48 }, () => -7) },
          vgust: { data: Array.from({ length: 48 }, () => -7) },
          tcc: { data: Array.from({ length: 48 }, () => 0.4) },
          rr_acc: { data: Array.from({ length: 48 }, () => 0) },
        } } }],
      });
    }
    if (url.includes("lsz-b.at")) return response("<title>Windwarnung<br />Böen am See</title>");
    return openMeteoResponse(url, false);
  });

  try {
    const national = await fetchNationalWeather(
      "AT",
      AREA.coordinates,
      "Neusiedler See (Österreich)",
      { ...AREA, name_de: "Neusiedler See (Österreich)" },
      CITY,
    );
    const forecastSources = national.sourceUrls.filter((source) => source.includes("Open-Meteo Forecast API"));
    assert.equal(forecastSources.length, 2, "Open-Meteo Forecast must be attributed once for area wind and once for city temperature/pressure/clouds/rain");
    assert.equal(national.sourceUrls.some((source) => source.includes("Marine API")), false, "inland marine data must not be cited");
    assert.equal(national.warningCenter.status, "integrated");
    assert.equal(national.warningCenter.label, "LSZ Burgenland");
    assert.ok(national.sourceUrls.some((source) => source.includes("GeoSphere Austria")));
    assert.ok(national.sourceUrls.some((source) => source.includes("LSZ Burgenland")));
    assert.deepEqual(
      (national.data.openMeteoForecast as any).city.hourly.isDay.slice(0, 4),
      [0, 1, 0, 1],
      "Open-Meteo is_day values must reach the city meteogram unchanged",
    );

    const local = await preprocessLocalWeather(
      national.data,
      { userInput: "Neusiedler See", city: CITY.name_de, sailingArea: "Neusiedler See (Österreich)" },
      anthropicStub(),
      "AT",
    );
    assert.equal((local.wind as any).source, "Open-Meteo Forecast API");
    assert.equal((local.nationalWind as any).text_de, "Nationale Winddetails");
    assert.equal((local.nationalCloudRain as any).text_de, "Nationale Wolken- und Regendetails");
    assert.deepEqual(
      (local.nationalCloudRain as any).coordinates,
      CITY.coordinates,
      "national cloud/rain data must use city coordinates",
    );
    const geoSphereCalls = mock.calls.filter((url) => url.includes("geosphere.at"));
    assert.ok(
      geoSphereCalls.some((url) => url.includes(`lat_lon=${AREA.coordinates.lat},${AREA.coordinates.lon}`)),
      "national wind must stay on sailing-area coordinates",
    );
    assert.ok(
      geoSphereCalls.some((url) => url.includes(`lat_lon=${CITY.coordinates.lat},${CITY.coordinates.lon}`)),
      "national cloud/rain must be fetched on city coordinates",
    );
    assert.match((local.warnings as any).text_de, /Starkwindwarnung/);
    assert.equal((local.wave as any).text_de, null, "absent lake waves must stay silent");
    assert.equal((local.wind as any).text_de.split("\n").length, 6, "national areas keep all six baseline days");
    assert.equal(mock.calls.filter((url) => url.startsWith("https://api.open-meteo.com/v1/forecast")).length, 2);
    const cityForecastCall = mock.calls.find((url) =>
      url.startsWith("https://api.open-meteo.com/v1/forecast")
      && url.includes(`latitude=${CITY.coordinates.lat}`),
    );
    assert.ok(cityForecastCall?.includes("cloud_cover_low"), "city forecast must request aggregate low cloud cover");
    assert.ok(cityForecastCall?.includes("cloud_cover_mid"), "city forecast must request aggregate middle cloud cover");
    assert.ok(cityForecastCall?.includes("cloud_cover_high"), "city forecast must request aggregate high cloud cover");
    assert.ok(!cityForecastCall?.includes("cloud_cover_550hPa"), "city forecast must not request unused pressure-level cloud data");
    assert.ok(!cityForecastCall?.includes("geopotential_height_"), "city forecast must not request unused geopotential-height data");
  } finally {
    mock.restore();
  }
}

async function testUnsupportedAreaCoverage(): Promise<void> {
  const mock = installFetch((url) => openMeteoResponse(url, false));
  try {
    const national = await fetchNationalWeather(
      "IT",
      { lat: 42.0, lon: 12.0 },
      null,
      null,
      { name_de: "Rom", coordinates: { lat: 41.9, lon: 12.5 } },
    );
    assert.deepEqual(national.warningCenter, { status: "unsupported", label: "Italien" });
    assert.equal(national.sourceUrls.filter((source) => source.includes("Open-Meteo Forecast API")).length, 2);
    assert.equal(national.sourceUrls.some((source) => source.includes("Marine API")), false);
    const local = preprocessOpenMeteoLocal(national.data, "Europe/Rome");
    assert.equal((local.wind as any).text_de.split("\n").length, 6);
    assert.equal((local.cloudRainThunderstorm as any).text_de.split("\n").length, 6);
    assert.deepEqual(
      (local.cloudRainThunderstorm as any).coordinates,
      { lat: 41.9, lon: 12.5 },
      "cloud/rain summary must carry city coordinates, never sailing-area coordinates",
    );
    assert.equal((local.cloudRainThunderstorm as any).city, "Rom");
    assert.equal((local.wave as any).text_de, null);
  } finally {
    mock.restore();
  }
}

async function testFailedNationalProvidersStayTransparent(): Promise<void> {
  const mock = installFetch((url) => {
    if (url.includes("austrocontrol.at") || url.includes("geosphere.at") || url.includes("lsz-b.at")) {
      return response("", 503);
    }
    return openMeteoResponse(url, false);
  });
  try {
    const national = await fetchNationalWeather(
      "AT",
      AREA.coordinates,
      "Neusiedler See (Österreich)",
      { ...AREA, name_de: "Neusiedler See (Österreich)" },
      CITY,
    );
    assert.equal(national.warningCenter.status, "unavailable");
    assert.equal(national.sourceUrls.some((source) => source.includes("Austrocontrol")), false);
    assert.equal(national.sourceUrls.some((source) => source.includes("GeoSphere Austria")), false);
    assert.equal(national.sourceUrls.some((source) => source.includes("LSZ Burgenland")), false);
    assert.equal(national.sourceUrls.filter((source) => source.includes("Open-Meteo Forecast API")).length, 2);

    const local = await preprocessLocalWeather(
      national.data,
      { userInput: "Neusiedler See", city: CITY.name_de, sailingArea: "Neusiedler See (Österreich)" },
      anthropicStub(),
      "AT",
    );
    assert.equal((local.warnings as any).text_de, null);
    assert.equal((local.wind as any).text_de.split("\n").length, 6);
  } finally {
    mock.restore();
  }
}

async function testHnmsFailureIsNotAllClear(): Promise<void> {
  const mock = installFetch((url) => {
    if (url === HNMS_BULLETIN_URL) return response("", 503);
    return openMeteoResponse(url, true);
  });
  try {
    const national = await fetchNationalWeather(
      "GR",
      { lat: 38.8, lon: 20 },
      "Ionisches Meer Nord (Griechenland)",
      { name_de: "Ionisches Meer Nord (Griechenland)", type: "sea", coordinates: { lat: 38.8, lon: 20 } },
      { name_de: "Lefkada", coordinates: { lat: 38.83, lon: 20.71 } },
    );
    assert.equal(national.warningCenter.status, "unavailable");
    assert.equal(national.sourceUrls.some((source) => source.includes("HNMS")), false);
    assert.equal(national.sourceUrls.filter((source) => source.includes("Open-Meteo Forecast API")).length, 2);
    assert.equal(national.sourceUrls.filter((source) => source.includes("Open-Meteo Marine API")).length, 1);

    const local = await preprocessLocalWeather(
      national.data,
      { userInput: "Lefkada", city: "Lefkada", sailingArea: "Ionisches Meer Nord (Griechenland)" },
      anthropicStub(),
      "GR",
    );
    assert.equal((local.warnings as any).text_de, null);
    assert.doesNotMatch(JSON.stringify(local.warnings), /Keine Sturmwarnung/);
    assert.match((local.wind as any).text_de, /Do 27\.08\./);
    assert.equal((local.wave as any).text_de, "Sa 22.08.: See 3 leicht bewegt\nSo 23.08.: See 3 leicht bewegt");
  } finally {
    mock.restore();
  }
}

function testCloudTypeClassification(): void {
  const base = {
    totalPct: 0, lowPct: 0, midPct: 0, highPct: 0,
    capeJkg: 0, weatherCode: 1, rainMm: 0,
  };
  assert.equal(classifyCloudType({ ...base, totalPct: 5 }), "clear", "near-zero cover reads as clear");
  assert.equal(
    classifyCloudType({ ...base, weatherCode: 95, totalPct: 80, lowPct: 50, highPct: 50 }),
    "cumulonimbus",
    "explicit thunderstorm code always wins",
  );
  assert.equal(
    classifyCloudType({ ...base, totalPct: 70, lowPct: 40, highPct: 40, capeJkg: 1200 }),
    "cumulonimbus",
    "tall convective column (low+high cover, high CAPE) without a weather code",
  );
  assert.equal(
    classifyCloudType({ ...base, totalPct: 30, lowPct: 30, midPct: 10, capeJkg: 700 }),
    "cumulus",
    "growing convective cloud with real CAPE but not yet a full storm",
  );
  assert.equal(
    classifyCloudType({ ...base, totalPct: 90, lowPct: 80, capeJkg: 50, rainMm: 2 }),
    "stratus",
    "widespread low deck with steady rain and little instability",
  );
  assert.equal(
    classifyCloudType({ ...base, totalPct: 30, lowPct: 30, capeJkg: 100 }),
    "cumulus",
    "fair-weather cumulus: modest low cover, clear aloft, no rain",
  );
  assert.equal(
    classifyCloudType({ ...base, totalPct: 60, midPct: 60 }),
    "altostratus",
    "mid-level-dominant deck",
  );
  assert.equal(
    classifyCloudType({ ...base, totalPct: 30, highPct: 30 }),
    "cirrus",
    "high-only thin cover",
  );
  assert.equal(
    classifyCloudType({ ...base, totalPct: 50, lowPct: 25, midPct: 25, highPct: 25 }),
    "mixed",
    "cover spread across levels without a clear dominant pattern falls back to mixed",
  );
}

function testSection4DevelopmentSignals(): void {
  const timestamps = [
    "2026-08-22T09:00:00",
    "2026-08-22T12:00:00",
    "2026-08-22T15:00:00",
    "2026-08-22T18:00:00",
    "2026-08-23T06:00:00",
    "2026-08-23T12:00:00",
    "2026-08-23T18:00:00",
    "2026-08-24T12:00:00",
    "2026-08-25T12:00:00",
    "2026-08-26T12:00:00",
    "2026-08-27T12:00:00",
  ];
  const rawData = {
    openMeteoForecast: {
      city: {
        name: "Teststadt",
        coordinates: { lat: 47.95, lon: 16.84 },
        hourly: {
          timestamps,
          temp2mC: [30, 29, 24, 22, 20, 25, 21, 23, 24, 22, 21],
          pressureMslHPa: [1018, 1014, 1011, 1010, 1011, 1014, 1016, 1017, 1018, 1019, 1020],
          rainMm: [0, 5, 1, 0, 0, 0.2, 0, 0, 0, 0, 0],
          precipProbabilityPct: [10, 90, 70, 20, 10, 30, 10, 5, 5, 5, 5],
          cloudCoverPct: [20, 90, 80, 40, 20, 50, 30, 20, 10, 20, 10],
          weatherCode: [1, 63, 95, 2, 1, 51, 1, 1, 0, 1, 0],
          cloudType: [
            "cumulus",
            "stratus",
            "mixed",
            "cumulus",
            "clear",
            "stratus",
            "cumulus",
            "cumulus",
            "clear",
            "cumulus",
            "clear",
          ],
          capeJkg: new Array(timestamps.length).fill(5000),
        },
      },
    },
  };

  const context = buildSection4WeatherContext(
    rawData,
    "Europe/Vienna",
    new REAL_DATE("2026-08-22T07:00:00.000Z"),
  ) as any;
  assert.ok(context, "structured section-4 context should be available");
  assert.equal(context.days.length, 6, "section 4 should cover all six forecast days");

  const today = context.days[0];
  assert.equal(today.detailLevel, "granular");
  assert.equal(today.summary.pressure.changeHPa, -8);
  assert.equal(today.summary.pressure.significant, true);
  assert.deepEqual(today.summary.pressure.steepestDrop, {
    from: "09:00",
    to: "12:00",
    change: -4,
  });
  assert.equal(today.summary.rain.totalMm, 6);
  assert.deepEqual(today.summary.rain.periods, [{
    period: "12:00–15:00",
    totalMm: 6,
    peakMm: 5,
  }]);
  assert.deepEqual(today.summary.temperature.steepestDrop, {
    from: "12:00",
    to: "15:00",
    change: -5,
  });
  assert.deepEqual(today.summary.thunderstorm, {
    signal: true,
    times: ["15:00"],
  });
  assert.ok(Array.isArray(today.timeline), "today should retain the granular timeline");
  assert.ok(Array.isArray(context.days[1].timeline), "tomorrow should retain a reduced timeline");
  assert.equal(context.days[2].timeline, undefined, "later days should only expose trend summaries");
  assert.doesNotMatch(
    JSON.stringify(context),
    /cape/i,
    "raw CAPE must not reach the section-4 interpretation context",
  );
  assert.doesNotMatch(
    JSON.stringify(context),
    /cloudCover/i,
    "cloud-cover percentages must not reach the section-4 interpretation context",
  );

  const capeOnlyRaw = structuredClone(rawData) as any;
  capeOnlyRaw.openMeteoForecast.city.hourly.weatherCode.fill(1);
  capeOnlyRaw.openMeteoForecast.city.hourly.cloudType.fill("cumulus");
  const capeOnly = buildSection4WeatherContext(
    capeOnlyRaw,
    "Europe/Vienna",
    new REAL_DATE("2026-08-22T07:00:00.000Z"),
  ) as any;
  assert.equal(
    capeOnly.days[0].summary.thunderstorm.signal,
    false,
    "high CAPE without a weather-code or cumulonimbus signal must not create thunderstorm risk",
  );

  const minorPressureRaw = structuredClone(capeOnlyRaw) as any;
  minorPressureRaw.openMeteoForecast.city.hourly.pressureMslHPa.splice(
    0,
    4,
    1016,
    1015,
    1014,
    1015,
  );
  const minorPressure = buildSection4WeatherContext(
    minorPressureRaw,
    "Europe/Vienna",
    new REAL_DATE("2026-08-22T07:00:00.000Z"),
  ) as any;
  assert.equal(
    minorPressure.days[0].summary.pressure.significant,
    false,
    "a two-hectopascal daily fluctuation must not be treated as a notable pressure signal",
  );

  const local = preprocessOpenMeteoLocal(capeOnlyRaw, "Europe/Vienna") as any;
  assert.match(
    local.cloudRainThunderstorm.text_de,
    /kein Gewitterrisiko/,
    "the generic local summary must use the same evidence rule as the meteogram",
  );
}

function testSection4OutputContract(): void {
  const output = enforceSection4Output(
    [
      "- Heute: 🌧️ gegen 12:00 Uhr kräftiger Regen.",
      "- Morgen: ⛈️ Gewittersignal gegen 23:00 Uhr.",
      "- Di–Fr 24.–27.08.: ☀️ Stabilisierung.",
      "- Zusätzlicher unerlaubter Bullet.",
    ].join("\n"),
    {
      todayLabel: "Sa 22.08.",
      tomorrowLabel: "So 23.08.",
      forecastOverviewLabel: "Mo–Do 24.–27.08.",
    },
  );
  assert.ok(output);
  const bullets = output.split("\n");
  assert.equal(bullets.length, 3, "section 4 must contain exactly three bullets");
  assert.match(bullets[0], /^- Heute \(Sa 22\.08\.\):/);
  assert.match(bullets[1], /^- Morgen \(So 23\.08\.\):/);
  assert.match(bullets[1], /nachts/, "tomorrow's exact clock time should become a broad day period");
  assert.doesNotMatch(bullets[1], /\d{1,2}:\d{2}\s*Uhr/, "tomorrow must not contain exact clock times");
  assert.match(bullets[2], /^- Mo–Do 24\.–27\.08\.:/);

  const missingBullets = enforceSection4Output(
    "- Heute: Ruhiger Verlauf.",
    {
      todayLabel: "Sa 22.08.",
      tomorrowLabel: "So 23.08.",
      forecastOverviewLabel: "Mo–Do 24.–27.08.",
    },
  );
  assert.equal(
    missingBullets?.split("\n").length,
    3,
    "missing LLM bullets should be completed transparently rather than changing the contract",
  );
  assert.match(missingBullets ?? "", /Lokale Entwicklungsdaten nicht verfügbar/);

  const sanitized = enforceSection4Output(
    [
      "- Heute: ☁️ Cumulus-Bewölkung 53–76 %; 📉 Druck fällt von 1016 auf 1014 hPa; 🌡️ Maximum 33,8°C, abends rascher Rückgang auf rund 26°C; 🌡️ rascher Temperaturrückgang um ca. 2°C zwischen 18:00 und 19:00 Uhr; 🌡️ rascher Temperaturabfall ab 18:00–19:00 Uhr.",
      "- Morgen: ⛅ Nebelfelder möglich (WMO-Code 45); ⛈️ Gewittersignal bei Cumulonimbus; 📉 Druck bleibt bei 1014 hPa.",
      "- Mo–Do 24.–27.08.: ☀️ Stabil; Di früh 7,2 mm Regen; kein Gewitterrisiko; 📈 Druck steigt auf 1018,4 hPa.",
    ].join("\n"),
    {
      todayLabel: "Sa 22.08.",
      tomorrowLabel: "So 23.08.",
      forecastOverviewLabel: "Mo–Do 24.–27.08.",
    },
    {
      pressureSignificant: [false, false, false],
      thunderstormAllowed: [false, false, false],
      rainDays: [
        [{ label: "Sa 22.08", totalMm: 0 }],
        [{ label: "So 23.08", totalMm: 0 }],
        [
          { label: "Mo 24.08", totalMm: 0 },
          { label: "Di 25.08", totalMm: 3 },
          { label: "Mi 26.08", totalMm: 0 },
          { label: "Do 27.08", totalMm: 0 },
        ],
      ],
    },
  ) ?? "";
  assert.doesNotMatch(sanitized, /%|Druck|hPa|Gewitter|Cumulonimbus|⛈️|WMO[-\s]?Code/i);
  assert.match(sanitized, /Cumulus-Bewölkung/);
  assert.match(sanitized, /Nebelfelder möglich/);
  assert.match(sanitized, /Maximum 34°C/);
  assert.doesNotMatch(sanitized, /rascher Temperaturrückgang|abends rascher Rückgang|18:00|19:00/);
  assert.match(sanitized, /⛅ Nebelfelder möglich/);
  assert.match(sanitized, /Di früh 3 mm Regen/);
  assert.doesNotMatch(sanitized, /7[,.]2 mm Regen|1018[,.]4 hPa/);
  assert.doesNotMatch(sanitized, /\d+[,.]\d+\s*(?:mm|hPa|°C)/i);

  const informativeFallback = enforceSection4Output(
    [
      "- Heute: 📉 Druckschwankung von 1016 auf 1014 hPa; ⛈️ Gewitterrisiko.",
      "- Morgen: 📉 Druck bleibt bei 1014 hPa; ⛈️ Gewittersignal.",
      "- Mo–Do 24.–27.08.: 📈 Druck bleibt stabil.",
    ].join("\n"),
    {
      todayLabel: "Sa 22.08.",
      tomorrowLabel: "So 23.08.",
      forecastOverviewLabel: "Mo–Do 24.–27.08.",
    },
    {
      pressureSignificant: [false, false, false],
      thunderstormAllowed: [false, false, false],
    },
    [
      "- Heute (Sa 22.08.): Ruhiger Verlauf: trocken; wechselnd bewölkt mit Cumulus-Bewölkung; sommerlich warm.",
      "- Morgen (So 23.08.): Wechselhaft, aber überwiegend trocken mit Cumulus-Bewölkung.",
      "- Mo–Do 24.–27.08.: Stabile Entwicklung; überwiegend trocken und sommerlich.",
    ],
  ) ?? "";
  assert.doesNotMatch(informativeFallback, /Keine markante Wetterentwicklung erkennbar/);
  assert.match(informativeFallback, /Ruhiger Verlauf: trocken/);
  assert.match(informativeFallback, /Cumulus-Bewölkung/);

  const expandedOverview = enforceSection4Output(
    [
      "- Heute: Ruhiger Verlauf.",
      "- Morgen: Wechselnd bewölkt.",
      "- Mo–Do 24.–27.08.: ☀️ Mittelmeerraum unter stabiler Hochdrucklage",
    ].join("\n"),
    {
      todayLabel: "Sa 22.08.",
      tomorrowLabel: "So 23.08.",
      forecastOverviewLabel: "Mo–Do 24.–27.08.",
    },
    undefined,
    [
      "- Heute (Sa 22.08.): Ruhiger Verlauf.",
      "- Morgen (So 23.08.): Wechselnd bewölkt.",
      "- Mo–Do 24.–27.08.: Mittelmeerraum unter stabiler Hochdrucklage; verbreitet sonnig und heiß; Höchstwerte bis 34°C; überwiegend trocken; die Stabilität hält bis zum Ende des Zeitraums an.",
    ],
  ) ?? "";
  assert.match(expandedOverview, /Hochdrucklage; verbreitet sonnig und heiß/);
  assert.match(expandedOverview, /Höchstwerte bis 34°C/);
  assert.match(expandedOverview, /bis zum Ende des Zeitraums/);
}

function testCloudBaseEstimate(): void {
  assert.equal(estimateCloudBaseM(30.7, 21.2), 1188, "125m per °C dew point depression");
  assert.equal(estimateCloudBaseM(20, 20), 0, "saturated air has cloud base at the surface");
  assert.equal(estimateCloudBaseM(null, 20), null, "missing temperature yields no estimate");
  assert.equal(estimateCloudBaseM(20, null), null, "missing dew point yields no estimate");
}

function cityMeteogramAnalysis(
  dewPoints: Array<number | null>,
  clouds: { low?: Array<number | null>; mid?: Array<number | null>; high?: Array<number | null> } = {},
): Record<string, unknown> {
  const timestamps = dewPoints.map((_, index) => `2026-08-22T${String(9 + index).padStart(2, "0")}:00:00+02:00`);
  return {
    weatherRaw: {
      openMeteoForecast: {
        timezone: "Europe/Vienna",
        city: {
          name: "Teststadt",
          coordinates: { lat: 47.95, lon: 16.84 },
          url: "https://open-meteo.com/",
          hourly: {
            timestamps,
            temp2mC: timestamps.map((_, index) => 20 + index),
            dewPoint2mC: dewPoints,
            isDay: timestamps.map((_, index) => index % 2),
            pressureMslHPa: timestamps.map(() => 1013),
            rainMm: timestamps.map(() => 0),
            precipProbabilityPct: timestamps.map(() => 0),
            weatherCode: timestamps.map(() => 1),
            cloudBaseM: timestamps.map(() => null),
            cloudType: timestamps.map((_, index) => index % 2 === 0 ? "cumulus" : "cirrus"),
            cloudCoverLowPct: clouds.low ?? timestamps.map(() => null),
            cloudCoverMidPct: clouds.mid ?? timestamps.map(() => null),
            cloudCoverHighPct: clouds.high ?? timestamps.map(() => null),
          },
        },
      },
    },
  };
}

function testCityMeteogramCloudBands(): void {
  const data = extractCityMeteogram(cityMeteogramAnalysis([12], { low: [70], mid: [40], high: [10] }));
  assert.ok(data, "meteogram data should be extracted");
  const point = data.points[0];
  assert.deepEqual(
    point.cloudBands.map((band) => ({ key: band.key, label: band.label, pct: band.pct })),
    [
      { key: "high", label: "HOCH", pct: 10 },
      { key: "mid", label: "MITTEL", pct: 40 },
      { key: "low", label: "TIEF", pct: 70 },
    ],
    "the meteogram should expose exactly the three aggregate cloud bands",
  );
  assert.equal(data.bands.length, 3, "the chart must render only three cloud bands");
}

function seaWindAnalysis(): Record<string, unknown> {
  const timestamps = Array.from({ length: 144 }, (_, index) => {
    const day = 22 + Math.floor(index / 24);
    const hour = index % 24;
    return `2026-08-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00`;
  });
  return {
    weatherRaw: {
      openMeteoForecast: {
        timezone: "Europe/Vienna",
        sailingArea: {
          name: "Testrevier",
          coordinates: AREA.coordinates,
          hourly: {
            timestamps,
            windSpeedKt: timestamps.map((_, index) => index % 16),
            gustKt: timestamps.map((_, index) => 3 + (index % 16)),
            windDirDeg: timestamps.map(() => 292),
          },
        },
      },
    },
  };
}

function compactedSeaWindAnalysis(): Record<string, unknown> {
  const analysis = seaWindAnalysis();
  const hourly = (analysis.weatherRaw as any).openMeteoForecast.sailingArea.hourly;
  for (const key of ["timestamps", "windSpeedKt", "gustKt", "windDirDeg"]) {
    hourly[key] = hourly[key].filter((_: unknown, index: number) => index % 3 === 0);
  }
  return analysis;
}

function testSeaWindForecast(): void {
  const analysis = seaWindAnalysis();
  const data = extractSeaWindForecast(analysis);
  assert.ok(data, "seegebiet wind data should be extracted");
  assert.equal(data.points.length, 48, "the chart should sample exactly 48 three-hour points from six days");
  assert.equal(data.points[0].timestamp, "2026-08-22T00:00", "the first three-hour point should preserve its source timestamp");
  assert.equal(data.points[1].speed, 3, "three-hour sampling should retain aligned wind values");
  assert.equal(data.latitude, AREA.coordinates.lat, "the chart should retain sailing-area latitude");
  assert.equal(data.longitude, AREA.coordinates.lon, "the chart should retain sailing-area longitude");

  const markup = renderToStaticMarkup(createElement(SeaWindForecast, { analysisJson: analysis }));
  assert.match(markup, /data-testid="sea-wind-forecast"[^>]*data-forecast-status="ready"/, "available wind data should render the ready chart");
  assert.match(markup, /data-forecast-days="6"[^>]*data-forecast-points="48"/, "the chart should expose six days and 48 points");
  assert.match(markup, /data-sailing-area-lat="47\.8"[^>]*data-sailing-area-lon="16\.75"/, "the chart metadata must use sailing-area coordinates");
  assert.match(markup, /data-testid="sea-wind-forecast-scroll"/, "the chart should provide a horizontal scroll container");
  assert.match(markup, /role="region"/, "the horizontal forecast should be exposed as a named region");
  assert.match(markup, /tabindex="0"/, "keyboard users should be able to focus and scroll the timeline");
  assert.match(markup, /Wind/, "the chart should include the wind row");
  assert.match(markup, /Böen/, "the chart should include the gust row");
  assert.match(markup, /Windrichtung/, "the chart should include the direction row");
  assert.doesNotMatch(markup, /Temperatur|Regen|Druck|Wolken/, "the wind chart must not include unrelated weather rows");
  assert.match(markup, /Sonntag 23/, "day headings should use normal capitalization");
  assert.doesNotMatch(markup, /SONNTAG/, "day headings should not use all caps");
  assert.match(markup, /data-hour-label="3">3<\/div>/, "hour labels should not have a leading zero");
  assert.match(markup, /data-night-overlay-layer="true"/, "night shading should use the shared overlay treatment");
  assert.match(markup, /bg-\[#63709b\]\/\[\.075\]/, "night shading should match the city meteogram");
  assert.match(markup, /data-label-rail-width="108"/, "the fixed label rail should expose the shared width");
  assert.match(markup, /data-testid="forecast-clock-glyph"/, "the wind forecast should use the shared clock glyph");
  assert.match(markup, /data-testid="sea-wind-hours-row"[^>]*data-row-height="21"[^>]*data-font-size="13"/, "the wind forecast should expose the compact shared hour-row dimensions");
  const windLabelRail = markup.match(/<aside[^>]*data-testid="sea-wind-label-rail"[^>]*>(.*?)<\/aside>/)?.[1] ?? "";
  assert.equal((windLabelRail.match(/>kt</g) ?? []).length, 2, "wind and gust labels should show kt");
  assert.doesNotMatch(windLabelRail, /⚑/, "the wind direction label should not show a flag glyph");
  assert.match(markup, /data-testid="sea-wind-current-column"[^>]*border-dashed/, "the wind forecast should keep a dashed current-time line without a visible label");
  assert.match(markup, /background-color:#f1f2f2/, "zero-knot wind should use the lightest approved color");
  assert.match(markup, /src="\/assets\/wind-arrows\/wind-arrow-ESE-112\.svg"/, "a wind reported from NW should use an arrow pointing toward SE");
  assert.match(markup, /role="img" aria-label="Windrichtung 292°"/, "direction values should be available to assistive technology");

  const compacted = compactedSeaWindAnalysis();
  assert.equal(
    extractSeaWindForecast(compacted)?.points.length,
    48,
    "an already compacted three-hour frontend export must not be sampled a second time",
  );

  const invalidTimezone = seaWindAnalysis();
  const invalidTimezoneForecast = (invalidTimezone.weatherRaw as any).openMeteoForecast;
  invalidTimezoneForecast.timezone = "Not/A-Timezone";
  invalidTimezoneForecast.sailingArea.hourly.timestamps = invalidTimezoneForecast.sailingArea.hourly.timestamps.map(
    (timestamp: string) => `${timestamp}:00Z`,
  );
  assert.doesNotThrow(
    () => extractSeaWindForecast(invalidTimezone),
    "an invalid timezone must not crash timestamp parsing",
  );
  assert.equal(
    extractSeaWindForecast(invalidTimezone)?.points.length,
    48,
    "invalid timezone metadata should fall back safely while preserving a complete forecast",
  );

  const loadingMarkup = renderToStaticMarkup(
    createElement(SeaWindForecast, { analysisJson: null, isLoading: true }),
  );
  assert.match(loadingMarkup, /data-forecast-status="loading"/, "the chart should expose a loading state before analysis data arrives");
  const unavailableMarkup = renderToStaticMarkup(
    createElement(SeaWindForecast, { analysisJson: { weatherRaw: {} } }),
  );
  assert.match(unavailableMarkup, /data-forecast-status="unavailable"/, "missing wind data should render an explicit unavailable state");

  const malformed = seaWindAnalysis();
  const malformedHourly = (malformed.weatherRaw as any).openMeteoForecast.sailingArea.hourly;
  malformedHourly.timestamps[3] = null;
  const malformedData = extractSeaWindForecast(malformed);
  assert.equal(malformedData, null, "a missing three-hour slot should produce the explicit unavailable state instead of a shortened chart");
  const partial = seaWindAnalysis();
  const partialHourly = (partial.weatherRaw as any).openMeteoForecast.sailingArea.hourly;
  for (const key of ["timestamps", "windSpeedKt", "gustKt", "windDirDeg"]) {
    partialHourly[key] = partialHourly[key].slice(0, 72);
  }
  assert.equal(extractSeaWindForecast(partial), null, "a partial forecast must not render fewer than six days");

  for (const key of ["windSpeedKt", "gustKt", "windDirDeg"]) {
    const shortened = compactedSeaWindAnalysis();
    const shortenedHourly = (shortened.weatherRaw as any).openMeteoForecast.sailingArea.hourly;
    shortenedHourly[key] = shortenedHourly[key].slice(0, 47);
    assert.equal(extractSeaWindForecast(shortened), null, `a shortened ${key} series must render unavailable`);

    const withNull = compactedSeaWindAnalysis();
    const withNullHourly = (withNull.weatherRaw as any).openMeteoForecast.sailingArea.hourly;
    withNullHourly[key][10] = null;
    assert.equal(extractSeaWindForecast(withNull), null, `a null ${key} value must render unavailable`);
  }

  const duplicateTimestamp = compactedSeaWindAnalysis();
  const duplicateHourly = (duplicateTimestamp.weatherRaw as any).openMeteoForecast.sailingArea.hourly;
  duplicateHourly.timestamps[10] = duplicateHourly.timestamps[9];
  assert.equal(extractSeaWindForecast(duplicateTimestamp), null, "duplicate timestamps must render unavailable");

  const timestampGap = compactedSeaWindAnalysis();
  const timestampGapHourly = (timestampGap.weatherRaw as any).openMeteoForecast.sailingArea.hourly;
  timestampGapHourly.timestamps[10] = "2026-08-23T07:00";
  assert.equal(extractSeaWindForecast(timestampGap), null, "non-contiguous three-hour timestamps must render unavailable");
}

function testCityMeteogramDewPointVisibility(): void {
  const noDewPoint = cityMeteogramAnalysis([null, Number.NaN], []);
  const noDewPointMarkup = renderToStaticMarkup(
    createElement(CityMeteogram, { analysisJson: noDewPoint }),
  );
  assert.doesNotMatch(noDewPointMarkup, /Taupunkt/, "the complete Taupunkt legend, label and row should be absent");
  assert.doesNotMatch(noDewPointMarkup, /JETZT/, "the meteogram should use only the dashed current-time line");

  const partialDewPoint = cityMeteogramAnalysis([null, 12.4], []);
  const partialData = extractCityMeteogram(partialDewPoint);
  assert.ok(partialData, "partial dew point data should still produce a meteogram");
  assert.deepEqual(
    partialData.points.map((point) => point.dewPoint),
    [null, 12.4],
    "missing dew point values must stay missing instead of being estimated",
  );
  const partialMarkup = renderToStaticMarkup(
    createElement(CityMeteogram, { analysisJson: partialDewPoint }),
  );
  assert.equal((partialMarkup.match(/Taupunkt/g) ?? []).length, 2, "partial data should show the Taupunkt legend and row label");
  assert.match(partialMarkup, />12°<\/div>/, "the finite dew point should be rendered");
}

function testCityMeteogramLoadingState(): void {
  const markup = renderToStaticMarkup(
    createElement(CityMeteogram, { analysisJson: null, isLoading: true }),
  );
  assert.match(markup, /data-meteogram-status="loading"/, "loading state should be marked as loading");
  assert.doesNotMatch(markup, /bounce-loader|animate-bounce/, "the meteogram must not render animated dots");
  assert.doesNotMatch(markup, /Meteogramm wird vorbereitet …/, "the shared icon status remains outside the meteogram");
}

function testForecastExportPreservesRainTotals(): void {
  const timestamps = Array.from(
    { length: 24 },
    (_, hour) => `2026-09-01T${String(hour).padStart(2, "0")}:00`,
  );
  const rainMm = [3, 3.9, 0.3, ...Array.from({ length: 21 }, () => 0)];
  const analysis = {
    meta: {
      app: "aiWindy",
      version: "test",
      website: "",
      github: "",
      copyright: "",
      requestDate: FIXED_NOW,
    },
    position: {
      userInput: "Teststadt",
      country: "Österreich",
      countryCode: "AT",
      windyModel: "iconD2",
      sailingArea: null,
      city: CITY,
    },
    sources: { windy: [], national: [], europe: [] },
    weatherRaw: {
      openMeteoForecast: {
        city: {
          hourly: {
            timestamps,
            rainMm,
            temp2mC: Array.from({ length: 24 }, (_, index) => 20 + index),
          },
        },
      },
    },
    weatherPreprocessed: { europe: {}, national: {}, local: {} },
    weatherOutput: {},
  } satisfies AnalysisJson;

  const exported = getSanitizedAnalysisExport(analysis) as any;
  const exportedHourly = exported.weatherRaw.openMeteoForecast.city.hourly;
  assert.equal(exportedHourly.timestamps.length, 8, "the frontend export should retain its three-hour resolution");
  assert.equal(exportedHourly.rainMm[0], 7.2, "rain within each three-hour block must be summed, not sampled");
  assert.deepEqual(
    exportedHourly.rainMm3h[0],
    [3, 3.9, 0.3],
    "the frontend export must retain all three hourly rain bars inside each three-hour block",
  );
  assert.equal(
    exportedHourly.rainMm.reduce((sum: number, amount: number) => sum + amount, 0),
    7.2,
    "forecast export compaction must preserve the daily rain total shown to the LLM",
  );
  assert.deepEqual(
    exportedHourly.temp2mC.slice(0, 3),
    [20, 23, 26],
    "non-accumulating weather values should remain sampled at three-hour intervals",
  );
  const meteogram = extractCityMeteogram(exported);
  assert.ok(meteogram, "the compacted frontend export should render as a meteogram");
  assert.deepEqual(
    meteogram.points[0].rainBars,
    [3, 3.9, 0.3],
    "the meteogram must receive the three hourly bars without collapsing them",
  );
  const markup = renderToStaticMarkup(
    createElement(CityMeteogram, { analysisJson: exported }),
  );
  assert.match(markup, /data-rain-bar-count="3"/, "the rainy three-hour column must declare three sub-bars");
  assert.equal(
    (markup.match(/data-rain-bar-amount=/g) ?? []).length,
    3,
    "all three non-zero hourly rain amounts must render as separate SVG bars",
  );
  assert.match(markup, /data-rain-amount="3\.9mm"/, "the hourly rain label must show the highest hourly value");
  assert.doesNotMatch(markup, /data-rain-amount="7\.2mm"/, "the daily total must not be used as the hourly bar label");
}

function testCityMeteogramVisualLayers(): void {
  const analysis = cityMeteogramAnalysis(
    [12, 13],
    { low: [65, 45], mid: [20, 55], high: [5, 70] },
  );
  const hourly = (analysis.weatherRaw as any).openMeteoForecast.city.hourly;
  hourly.cloudBaseM = [900, 1400];
  hourly.rainMm = [0.3, 2.2];
  hourly.pressureMslHPa = [1010, 1020];

  const data = extractCityMeteogram(analysis);
  assert.ok(data, "visual-layer fixture should produce a meteogram");
  assert.deepEqual(
    data.points.map((point) => point.isDay),
    [false, true],
    "numeric Open-Meteo is_day values must map to night/day booleans",
  );
  assert.deepEqual(
    data.points.map((point) => point.cloudType),
    ["cumulus", "cirrus"],
    "heuristic cloud types must stay aligned with their timestamps",
  );

  const markup = renderToStaticMarkup(
    createElement(CityMeteogram, { analysisJson: analysis }),
  );
  assert.match(
    markup,
    /data-chart-night-column="true"[^>]*data-night-shading="true"/,
    "nighttime must use the full-height chart background column",
  );
  assert.match(
    markup,
    /data-chart-night-column="true"[^>]*data-night-index="0"/,
    "night columns should retain their source index for visual regression tooling",
  );
  assert.match(
    markup,
    /data-testid="meteogram-temperature-area"[^>]*data-temperature-layer="behind-forecast-rows"/,
    "the filled temperature chart must be the background layer behind icons and temperature values",
  );
  assert.equal(
    (markup.match(/data-series="temperature"/g) ?? []).length,
    2,
    "the temperature chart must contain one filled area and one line",
  );
  assert.doesNotMatch(
    markup,
    /data-series="dew-point"/,
    "dew point must never be rendered as an SVG curve",
  );
  assert.ok(
    markup.indexOf('data-testid="meteogram-temperature-area"')
      < markup.indexOf('data-testid="meteogram-dew-point-row"'),
    "the overlaid temperature area must remain above the numeric dew-point row",
  );
  assert.match(markup, /data-testid="meteogram-cloud-field"/, "cloud field must remain testable");
  assert.equal((markup.match(/data-cloud-shape-band="(?:high|mid|low)"/g) ?? []).length, 6, "three cloud bands should render for each populated timestamp");
  assert.equal(
    (markup.match(/data-cloud-band-clip="(?:high|mid|low)"[^>]*clip-path="url\(#meteogram-cloud-band-(?:high|mid|low)\)"/g) ?? []).length,
    3,
    "each cloud texture must be clipped to its own altitude band",
  );
  assert.doesNotMatch(markup, /data-testid="meteogram-cloud-type-row"/, "the separate cloud type row should be removed");
  assert.equal((markup.match(/data-weather-cloud-type="/g) ?? []).length, 2, "each weather cell should carry the cloud type once");
  assert.equal((markup.match(/data-cloud-type-icon="/g) ?? []).length, 2, "each weather cell should render one integrated cloud-type icon");
  assert.equal((markup.match(/data-fixed-cloud-band="(?:high|mid|low)"/g) ?? []).length, 3, "all three cloud-band labels should remain in the fixed rail");
  assert.equal((markup.match(/data-weather-cloud-type="[^"]+"[^>]*role="img"[^>]*aria-label="/g) ?? []).length, 2, "each integrated weather icon should have an accessible description");
  assert.match(markup, /data-weather-cloud-type="cumulus"/, "weather icons should expose the heuristic classification");
  assert.match(markup, /data-weather-cloud-type="cirrus"/, "weather icons should retain neutral cloud types");
  assert.match(markup, /Cumulus.*tief.*mittel.*hoch.*CAPE.*Regen/, "cloud icon tooltips should include type and underlying model values");
  assert.match(markup, /#898781/, "non-warning cloud types should use the neutral axis gray");
  assert.equal(cloudTypeColor("stratus"), "#fab219", "stratus should use the reserved warning color");
  assert.equal(cloudTypeColor("cumulonimbus"), "#d03b3b", "cumulonimbus should use the reserved critical color");
  assert.equal(cloudTypeColor("cirrus"), "#898781", "non-warning cloud types should remain neutral");
  assert.match(markup, /data-rain-amount="0.3mm"/, "rain columns should show their measured amount");
  assert.match(markup, /data-rain-amount="2.2mm"/, "larger rain columns should show their measured amount");
  assert.match(markup, /data-testid="meteogram-daily-rain"[^>]*data-rain-total="2.5"[^>]*data-rain-pill-placement="cloud-chart"/, "the cloud chart should show the summed rain amount at the end of the day");
  assert.ok(
    markup.indexOf('data-testid="meteogram-daily-rain"') > markup.indexOf('data-testid="meteogram-cloud-field"'),
    "the daily rain pill should be positioned inside the cloud/rain chart, not in the day header",
  );
  assert.doesNotMatch(
    markup,
    /data-testid="meteogram-cloud-field"[^>]*bg-\[#/,
    "the cloud field must stay transparent so full-height night shading remains visible",
  );
  assert.doesNotMatch(markup, /data-testid="meteogram-lcl-line"/, "estimated LCL line must stay hidden");
  assert.doesNotMatch(markup, /key="lcl-/, "estimated LCL point markers must stay hidden");
  assert.match(markup, /linearGradient id="temperature-gradient"/, "temperature should use a stable horizontal SVG gradient");
  assert.match(markup, /gradientUnits="userSpaceOnUse"/, "temperature colors should follow the actual timeline");
  assert.match(markup, /data-temperature="20"/, "temperature gradient should include data-driven stops");
  assert.notEqual(temperatureColor(19), temperatureColor(33), "cool and hot temperatures should use visibly different colors");
  assert.match(temperatureColor(33), /^#(?:[a-f0-9]{6})$/i, "temperature colors should be valid SVG hex colors");
  assert.match(markup, /linearGradient id="temperature-fade"/, "temperature fill should fade vertically");
  assert.match(markup, /data-testid="meteogram-pressure-line"/, "pressure path should remain directly measurable");
  assert.match(markup, /data-testid="meteogram-pressure-line"[^>]*data-pressure-y-min="1"[^>]*data-pressure-y-max="105"[^>]*data-pressure-row-height="106"/, "pressure should use nearly the full pressure/rain row height");
  assert.match(markup, /font-size="10"/, "pressure labels should be readable");
  assert.match(markup, /stroke="#587b90"/, "pressure should be blue-gray and distinct from cloud fill");
  assert.match(markup, /data-testid="meteogram-current-column"/, "the current forecast column should be highlighted");
  assert.match(
    markup,
    /data-testid="meteogram-current-column"[^>]*role="img"[^>]*aria-label="Aktueller Prognosezeitpunkt:/,
    "the current forecast column should expose its timestamp to assistive technology",
  );
  assert.match(markup, /border-l border-dashed/, "the current column should use a subtle Windy-like dashed marker");
  assert.match(markup, /data-night-overlay-layer="true"[^>]*z-\[15\]/, "night shading should overlay opaque chart rows");
  assert.match(markup, /data-testid="city-meteogram-hours-row"[^>]*data-row-height="21"[^>]*data-font-size="13"/, "the meteogram hour row should match the compact wind forecast");
  const cityLabelRail = markup.match(/<aside[^>]*data-testid="city-meteogram-label-rail"[^>]*>(.*?)<\/aside>/)?.[1] ?? "";
  assert.doesNotMatch(cityLabelRail, />kt<|>hPa<|>mm<|>°C</, "the meteogram label rail should not repeat measurement units");
  assert.match(cityLabelRail, /Bewölkung/, "the meteogram should label the icon row as Bewölkung");
  assert.match(cityLabelRail, /height:44px[^>]*>Bewölkung/, "Bewölkung should align with the icon row");
  assert.match(cityLabelRail, /height:42px[^>]*>Temperatur/, "Temperatur should align with its own row");
  assert.match(cityLabelRail, /height:30px[^>]*>Taupunkt/, "Taupunkt should align with its own row");
  assert.match(cityLabelRail, /Druck<br\/>Regen/, "Druck and Regen should share one neutral label treatment");
  assert.doesNotMatch(cityLabelRail, /text-\[#3275a0\]|text-\[#a85e42\]/, "temperature, pressure, and rain labels should use the same gray color");
  assert.match(markup, /data-testid="meteogram-dew-point-row"[\s\S]*?style="top:93px"/, "dew point values should be vertically centered in their own row");
  assert.match(
    markup,
    /data-testid="meteogram-pressure-rain-overlay"/,
    "pressure and rain must share one overlaid plot",
  );
  assert.doesNotMatch(
    markup,
    /data-testid="meteogram-pressure-rain-overlay"[^>]*bg-\[#/,
    "the lower plot must stay transparent so full-height night shading remains visible",
  );
  assert.match(markup, /heuristisch aus Modelldaten/, "cloud types must be described as heuristic model output");
  assert.match(markup, /keine Beobachtung/, "the cloud-base estimate must not be presented as observed");

  const southernWesternAnalysis = cityMeteogramAnalysis([12]);
  const city = (southernWesternAnalysis.weatherRaw as any).openMeteoForecast.city;
  city.coordinates = { lat: -33.869, lon: -151.209 };
  const southernWesternMarkup = renderToStaticMarkup(
    createElement(CityMeteogram, { analysisJson: southernWesternAnalysis }),
  );
  assert.match(
    southernWesternMarkup,
    /33\.869° S · 151\.209° W/,
    "coordinate labels should derive hemispheres from latitude and longitude signs",
  );

  const capeOnlyAnalysis = cityMeteogramAnalysis([12]);
  const capeOnlyHourly = (capeOnlyAnalysis.weatherRaw as any).openMeteoForecast.city.hourly;
  capeOnlyHourly.capeJkg = [900];
  capeOnlyHourly.cloudType = ["cumulus"];
  const capeOnlyMarkup = renderToStaticMarkup(
    createElement(CityMeteogram, { analysisJson: capeOnlyAnalysis }),
  );
  assert.doesNotMatch(
    capeOnlyMarkup,
    /Gewitterrisiko/,
    "CAPE alone must not receive the warning-color treatment reserved for Cumulonimbus",
  );

  capeOnlyHourly.cloudType = ["cumulonimbus"];
  const cumulonimbusMarkup = renderToStaticMarkup(
    createElement(CityMeteogram, { analysisJson: capeOnlyAnalysis }),
  );
  assert.match(
    cumulonimbusMarkup,
    /Gewitterrisiko/,
    "Cumulonimbus should retain the critical warning treatment",
  );
}

function testMeteogramFormatting(): void {
  assert.equal(formatCloudBase(42), "50", "small bases should be rounded to useful 50 m increments");
  assert.equal(formatCloudBase(688), "700", "sub-kilometre bases should round to useful 50 m increments");
  assert.equal(formatCloudBase(1925), "1900", "higher bases should use compact hundreds");
  assert.equal(formatCloudBase(7600), "7500", "high bases should round to 500 m increments");
  assert.equal(formatCloudBase(12400), "12k", "very high bases should use compact kilometre notation");
  assert.match(cloudBaseTone(120), /bg-rose/, "very low bases should have a red cell background");
  assert.match(cloudBaseTone(500), /bg-orange/, "low bases should have an orange cell background");
  assert.match(cloudBaseTone(800), /bg-amber/, "caution bases should have an amber cell background");
  assert.match(cloudBaseTone(1200), /bg-lime/, "medium bases should have a yellow-green cell background");
  assert.match(cloudBaseTone(2400), /bg-emerald/, "high bases should have a green cell background");
}

function testCityMeteogramDoesNotInventCloudsInEmptyBands(): void {
  const analysis = cityMeteogramAnalysis(
    [12, 13],
    { low: [0, 0], mid: [0, 0], high: [70, 70] },
  );
  const hourly = (analysis.weatherRaw as any).openMeteoForecast.city.hourly;
  hourly.cloudType = ["cirrus", "cirrus"];

  const markup = renderToStaticMarkup(
    createElement(CityMeteogram, { analysisJson: analysis }),
  );
  assert.equal(
    (markup.match(/data-cloud-shape-band="high"/g) ?? []).length,
    2,
    "high-cloud texture should render only where its source band has coverage",
  );
  assert.doesNotMatch(
    markup,
    /data-cloud-shape-band="(?:mid|low)"/,
    "the hourly cloud type must not invent clouds in empty lower bands",
  );
}

function testCityMeteogramMalformedArrays(): void {
  const malformed = cityMeteogramAnalysis(
    [12, 13],
    { low: [20, 30], mid: [40, 50], high: [60, 70] },
  );
  const city = (malformed.weatherRaw as any).openMeteoForecast.city;
  city.hourly.timestamps = [
    "2026-08-22T09:00:00+02:00",
    null,
    "2026-08-22T11:00:00+02:00",
  ];
  city.hourly.temp2mC = [20, 21, 22];
  city.hourly.pressureMslHPa = [1013];
  city.hourly.cloudCoverHighPct = [60, "malformed", 80];

  let data: ReturnType<typeof extractCityMeteogram>;
  assert.doesNotThrow(() => {
    data = extractCityMeteogram(malformed);
  }, "mismatched timestamps and value arrays must not throw");
  assert.ok(data, "valid timestamp entries should still produce a meteogram");
  assert.deepEqual(
    data.points.map((point) => point.timestamp),
    ["2026-08-22T09:00:00+02:00", "2026-08-22T11:00:00+02:00"],
    "invalid timestamps should be skipped without shifting later array values",
  );
  assert.deepEqual(
    data.points.map((point) => point.temperature),
    [20, 22],
    "values should stay aligned with their original timestamp indexes",
  );
  assert.deepEqual(
    data.points.map((point) => point.pressure),
    [1013, null],
    "short value arrays should become missing values instead of throwing",
  );
  assert.deepEqual(
    data.points.map((point) => point.cloudBands.map((band) => band.pct)),
    [[60, 40, 20], [80, null, null]],
    "aggregate cloud bands should stay aligned and malformed values should remain missing",
  );

  const missingTimestamps = cityMeteogramAnalysis([12], []);
  const missingCity = (missingTimestamps.weatherRaw as any).openMeteoForecast.city;
  missingCity.hourly.timestamps = null;
  assert.equal(
    extractCityMeteogram(missingTimestamps),
    null,
    "missing core timestamp data should remain unavailable",
  );
  const unavailableMarkup = renderToStaticMarkup(
    createElement(CityMeteogram, { analysisJson: missingTimestamps }),
  );
  assert.match(
    unavailableMarkup,
    /data-meteogram-status="unavailable"/,
    "missing core timestamp data should render the existing unavailable state",
  );
}

async function main(): Promise<void> {
  testCloudTypeClassification();
  testSection4OutputContract();
  testCloudBaseEstimate();
  testCityMeteogramCloudBands();
  testSeaWindForecast();
  testCityMeteogramDewPointVisibility();
  testForecastExportPreservesRainTotals();
  testCityMeteogramVisualLayers();
  testMeteogramFormatting();
  testCityMeteogramDoesNotInventCloudsInEmptyBands();
  testCityMeteogramMalformedArrays();
  await withFixedDate(async () => {
    testSection4DevelopmentSignals();
    await testNationalCoverageAndPrecedence();
    await testUnsupportedAreaCoverage();
    await testFailedNationalProvidersStayTransparent();
    await testHnmsFailureIsNotAllClear();
  });
  console.log("weather regressions: all checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});