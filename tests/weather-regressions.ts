/**
 * Deterministic regression coverage for the local sailing forecast pipeline.
 *
 * Run with: npm run test:weather
 */

import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import {
  fetchNationalWeather,
  preprocessLocalWeather,
} from "../server/weather-national.js";
import { preprocessOpenMeteoLocal, classifyCloudType, estimateCloudBaseM } from "../server/weather-open-meteo.js";
import { HNMS_BULLETIN_URL } from "../server/weather-national-greece.js";

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

    const local = await preprocessLocalWeather(
      national.data,
      { userInput: "Neusiedler See", city: CITY.name_de, sailingArea: "Neusiedler See (Österreich)" },
      anthropicStub(),
      "AT",
    );
    assert.equal((local.wind as any).source, "Open-Meteo Forecast API");
    assert.equal((local.nationalWind as any).text_de, "Nationale Winddetails");
    assert.equal((local.nationalCloudRain as any).text_de, "Nationale Wolken- und Regendetails");
    assert.match((local.warnings as any).text_de, /Starkwindwarnung/);
    assert.equal((local.wave as any).text_de, null, "absent lake waves must stay silent");
    assert.equal((local.wind as any).text_de.split("\n").length, 6, "national areas keep all six baseline days");
    assert.equal(mock.calls.filter((url) => url.startsWith("https://api.open-meteo.com/v1/forecast")).length, 2);
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
    // Cloud/rain/thunderstorm data now lives on the city coordinate, not the
    // sailing area; the mock only fabricates "full" fields (incl. cloud_cover,
    // rain, cape) for the area URL, so this stays null until the mock is
    // extended for CITY_HOURLY. See weather-open-meteo.ts CITY_HOURLY.
    assert.equal((local.cloudRainThunderstorm as any).text_de, null);
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

function testCloudBaseEstimate(): void {
  assert.equal(estimateCloudBaseM(30.7, 21.2), 1188, "125m per °C dew point depression");
  assert.equal(estimateCloudBaseM(20, 20), 0, "saturated air has cloud base at the surface");
  assert.equal(estimateCloudBaseM(null, 20), null, "missing temperature yields no estimate");
  assert.equal(estimateCloudBaseM(20, null), null, "missing dew point yields no estimate");
}

async function main(): Promise<void> {
  testCloudTypeClassification();
  testCloudBaseEstimate();
  await withFixedDate(async () => {
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