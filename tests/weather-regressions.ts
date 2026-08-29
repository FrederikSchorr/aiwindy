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
import { preprocessOpenMeteoLocal, classifyCloudType, estimateCloudBaseM } from "../server/weather-open-meteo.js";
import { HNMS_BULLETIN_URL } from "../server/weather-national-greece.js";
import CityMeteogram, { extractCityMeteogram } from "../client/src/components/city-meteogram";

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

function testCloudBaseEstimate(): void {
  assert.equal(estimateCloudBaseM(30.7, 21.2), 1188, "125m per °C dew point depression");
  assert.equal(estimateCloudBaseM(20, 20), 0, "saturated air has cloud base at the surface");
  assert.equal(estimateCloudBaseM(null, 20), null, "missing temperature yields no estimate");
  assert.equal(estimateCloudBaseM(20, null), null, "missing dew point yields no estimate");
}

function cityMeteogramAnalysis(
  dewPoints: Array<number | null>,
  cloudLevels: Array<{ hpa: number; heightM: number; pct: number }>,
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
            cloudCoverLevels: cloudLevels.map((level) => ({
              hpa: level.hpa,
              heightM: timestamps.map(() => level.heightM),
              pct: timestamps.map(() => level.pct),
            })),
          },
        },
      },
    },
  };
}

function testCityMeteogramCloudBands(): void {
  const levels = [
    { hpa: 300, heightM: 9000, pct: 10 },
    { hpa: 250, heightM: 8000, pct: 20 },
    { hpa: 200, heightM: 6000, pct: 30 },
    { hpa: 175, heightM: 5500, pct: 40 },
    { hpa: 150, heightM: 5000, pct: 50 },
    { hpa: 125, heightM: 4500, pct: 60 },
    { hpa: 100, heightM: 4000, pct: 70 },
    { hpa: 75, heightM: 3500, pct: 80 },
    { hpa: 50, heightM: 3000, pct: 90 },
    { hpa: 25, heightM: 2500, pct: 15 },
    { hpa: 20, heightM: 2000, pct: 25 },
    { hpa: 15, heightM: 1500, pct: 35 },
    { hpa: 10, heightM: 1000, pct: 45 },
    { hpa: 5, heightM: 0, pct: 55 },
    { hpa: 1, heightM: 13000, pct: 65 },
  ];
  const data = extractCityMeteogram(cityMeteogramAnalysis([12], levels));
  assert.ok(data, "meteogram data should be extracted");
  const point = data.points[0];
  const bandsByLabel = new Map(point.cloudBands.map((band) => [band.label, band]));

  const expectedBandSources = {
    FL300: [300, 250],
    FL200: [200, 175],
    FL150: [150, 125],
    FL130: [100, 75],
    FL100: [50, 25],
    FL065: [20, 15],
    AGL: [10, 5],
  };
  for (const [label, expectedSources] of Object.entries(expectedBandSources)) {
    assert.deepEqual(
      bandsByLabel.get(label)?.sourceLevels,
      expectedSources,
      `${label} should contain only its half-open height interval`,
    );
  }
  assert.deepEqual(
    point.cloudBands.flatMap((band) => band.sourceLevels),
    levels.filter((level) => level.heightM < 13000).map((level) => level.hpa),
    "every in-range pressure surface should be represented exactly once",
  );

  const renderedSourceLevels = point.cloudBands.flatMap((band) => band.sourceLevels);
  for (const level of levels) {
    assert.ok(
      renderedSourceLevels.filter((sourceLevel) => sourceLevel === level.hpa).length <= 1,
      `${level.hpa} hPa must not render in two cloud bands`,
    );
  }
}

function testCityMeteogramDewPointVisibility(): void {
  const noDewPoint = cityMeteogramAnalysis([null, Number.NaN], []);
  const noDewPointMarkup = renderToStaticMarkup(
    createElement(CityMeteogram, { analysisJson: noDewPoint }),
  );
  assert.doesNotMatch(noDewPointMarkup, /Taupunkt/, "the complete Taupunkt legend, label and row should be absent");

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

function testCityMeteogramVisualLayers(): void {
  const analysis = cityMeteogramAnalysis(
    [12, 13],
    [{ hpa: 850, heightM: 1800, pct: 65 }],
  );
  const hourly = (analysis.weatherRaw as any).openMeteoForecast.city.hourly;
  hourly.cloudBaseM = [900, 1400];

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
  assert.match(markup, /data-night-shading="true"/, "nighttime must receive explicit chart shading");
  assert.match(markup, /data-testid="meteogram-cloud-field"/, "cloud field must remain testable");
  assert.match(markup, /data-testid="meteogram-lcl-line"/, "estimated LCL must be integrated in the cloud field");
  assert.match(
    markup,
    /data-testid="meteogram-pressure-rain-overlay"/,
    "pressure and rain must share one overlaid plot",
  );
  assert.match(markup, /heuristisch aus Modelldaten/, "cloud types must be described as heuristic model output");
  assert.match(markup, /keine Beobachtung/, "the LCL must not be presented as an observed cloud base");
}

function testCityMeteogramDoesNotInventCloudsInEmptyBands(): void {
  const analysis = cityMeteogramAnalysis(
    [12, 13],
    [{ hpa: 300, heightM: 9000, pct: 70 }],
  );
  const hourly = (analysis.weatherRaw as any).openMeteoForecast.city.hourly;
  hourly.cloudType = ["cirrus", "cirrus"];

  const markup = renderToStaticMarkup(
    createElement(CityMeteogram, { analysisJson: analysis }),
  );
  assert.equal(
    (markup.match(/data-cloud-shape-band="FL300"/g) ?? []).length,
    2,
    "high-cloud texture should render only where its source band has coverage",
  );
  assert.doesNotMatch(
    markup,
    /data-cloud-shape-band="(?:FL200|FL150|FL130|FL100|FL065|AGL)"/,
    "the hourly cloud type must not invent clouds in empty lower bands",
  );
}

function testCityMeteogramMalformedArrays(): void {
  const malformed = cityMeteogramAnalysis(
    [12, 13],
    [{ hpa: 300, heightM: 9000, pct: 20 }],
  );
  const city = (malformed.weatherRaw as any).openMeteoForecast.city;
  city.hourly.timestamps = [
    "2026-08-22T09:00:00+02:00",
    null,
    "2026-08-22T11:00:00+02:00",
  ];
  city.hourly.temp2mC = [20, 21, 22];
  city.hourly.pressureMslHPa = [1013];
  city.hourly.cloudCoverLevels = [
    {
      hpa: 300,
      heightM: [9000, 9000, 9000],
      pct: [20, 20, 20],
    },
    {
      hpa: 300,
      heightM: [9000, "malformed", 9000],
      pct: [20, 20, 20],
    },
    {
      hpa: "malformed",
      heightM: [9000, 9000, 9000],
      pct: [20, 20, 20],
    },
    null,
  ];

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
    data.points.map((point) => point.cloudBands[0].sourceLevels),
    [[300], [300]],
    "invalid and duplicate cloud levels must not duplicate valid pressure surfaces",
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
  testCloudBaseEstimate();
  testCityMeteogramCloudBands();
  testCityMeteogramDewPointVisibility();
  testCityMeteogramVisualLayers();
  testCityMeteogramDoesNotInventCloudsInEmptyBands();
  testCityMeteogramMalformedArrays();
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