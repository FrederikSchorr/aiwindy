export const OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
export const OPEN_METEO_MARINE_URL = "https://marine-api.open-meteo.com/v1/marine";
export const OPEN_METEO_FORECAST_SOURCE_URL = "https://open-meteo.com/en/docs";
export const OPEN_METEO_MARINE_SOURCE_URL = "https://open-meteo.com/en/docs/marine-weather-api";

type Coordinates = { lat: number; lon: number };
export type OpenMeteoTarget = {
  name_de: string;
  coordinates: Coordinates;
};

// Tropospheric pressure levels only (1000–200 hPa, ~0–12 km). The remaining
// levels up to 30 hPa are stratospheric and read ~0% cloud cover for sailing
// purposes, so they're intentionally excluded.
const CLOUD_PRESSURE_LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200];

const FORECAST_HOURLY = [
  "temperature_2m",
  "precipitation_probability",
  "rain",
  "weather_code",
  "cloud_cover",
  "wind_speed_10m",
  "wind_direction_10m",
  "wind_gusts_10m",
  "cape",
  "pressure_msl",
  ...CLOUD_PRESSURE_LEVELS.map(level => `cloud_cover_${level}hPa`),
  ...CLOUD_PRESSURE_LEVELS.map(level => `geopotential_height_${level}hPa`),
];

const MARINE_HOURLY = [
  "wave_height",
  "wave_direction",
  "wave_period",
  "wind_wave_height",
  "wind_wave_direction",
  "wind_wave_period",
  "swell_wave_height",
  "swell_wave_direction",
  "swell_wave_period",
];

const COUNTRY_TIMEZONES: Record<string, string> = {
  AL: "Europe/Tirane", AT: "Europe/Vienna", BE: "Europe/Brussels",
  CH: "Europe/Zurich", DE: "Europe/Berlin", DK: "Europe/Copenhagen",
  ES: "Europe/Madrid", FR: "Europe/Paris", GB: "Europe/London",
  GR: "Europe/Athens", HR: "Europe/Zagreb", IE: "Europe/Dublin",
  IT: "Europe/Rome", ME: "Europe/Podgorica", NL: "Europe/Amsterdam",
  NO: "Europe/Oslo", PL: "Europe/Warsaw", PT: "Europe/Lisbon",
  SE: "Europe/Stockholm", SI: "Europe/Ljubljana", TR: "Europe/Istanbul",
};

const DAY_NAMES = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

export function getOpenMeteoTimezone(countryCode: string): string {
  return COUNTRY_TIMEZONES[countryCode] ?? "Europe/Berlin";
}

function formatForecastSource(provided: string[]): string {
  const last = provided[provided.length - 1] ?? "Wetter";
  if (provided.length === 1) return `${last}vorhersage`;
  return `${provided.slice(0, -1).map(label => `${label}-`).join(", ")} und ${last}vorhersage`;
}

function buildUrl(
  endpoint: string,
  coordinates: Coordinates,
  timezone: string,
  hourly: string[],
  extras: Record<string, string> = {},
): string {
  const params = new URLSearchParams({
    latitude: String(coordinates.lat),
    longitude: String(coordinates.lon),
    timezone,
    forecast_days: "6",
    hourly: hourly.join(","),
    ...extras,
  });
  return `${endpoint}?${params.toString()}`;
}

async function fetchJson(url: string, label: string): Promise<Record<string, any> | null> {
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      console.error(`Open-Meteo ${label} failed (${response.status})`);
      return null;
    }
    const payload = await response.json() as Record<string, any>;
    if (!Array.isArray(payload.hourly?.time)) {
      console.error(`Open-Meteo ${label} returned no hourly data`);
      return null;
    }
    return payload;
  } catch (error) {
    console.error(`Open-Meteo ${label} error:`, error instanceof Error ? error.message : error);
    return null;
  }
}

function values(hourly: Record<string, any> | undefined, key: string): unknown[] | null {
  return Array.isArray(hourly?.[key]) ? hourly[key] : null;
}

function normalizeForecast(
  areaRaw: Record<string, any> | null,
  areaUrl: string,
  cityRaw: Record<string, any> | null,
  cityUrl: string,
  sailingArea: OpenMeteoTarget,
  city: OpenMeteoTarget,
  timezone: string,
): Record<string, unknown> {
  const areaHourly = areaRaw?.hourly;
  const cityHourly = cityRaw?.hourly;
  return {
    source: "Open-Meteo Forecast API",
    url: areaUrl,
    available: Boolean(areaRaw),
    fetchedAt: new Date().toISOString(),
    timezone: areaRaw?.timezone ?? timezone,
    latitude: areaRaw?.latitude ?? sailingArea.coordinates.lat,
    longitude: areaRaw?.longitude ?? sailingArea.coordinates.lon,
    hourlyUnits: areaRaw?.hourly_units ?? {},
    sailingArea: {
      name: sailingArea.name_de,
      coordinates: sailingArea.coordinates,
      hourly: areaRaw ? {
        timestamps: values(areaHourly, "time"),
        windSpeedKt: values(areaHourly, "wind_speed_10m"),
        windDirDeg: values(areaHourly, "wind_direction_10m"),
        gustKt: values(areaHourly, "wind_gusts_10m"),
        cloudCoverPct: values(areaHourly, "cloud_cover"),
        rainMm: values(areaHourly, "rain"),
        precipProbabilityPct: values(areaHourly, "precipitation_probability"),
        weatherCode: values(areaHourly, "weather_code"),
        capeJkg: values(areaHourly, "cape"),
        pressureMslHPa: values(areaHourly, "pressure_msl"),
        cloudCoverLevels: CLOUD_PRESSURE_LEVELS.map(hpa => ({
          hpa,
          heightM: values(areaHourly, `geopotential_height_${hpa}hPa`),
          pct: values(areaHourly, `cloud_cover_${hpa}hPa`),
        })),
      } : null,
    },
    city: {
      name: city.name_de,
      coordinates: city.coordinates,
      url: cityUrl,
      hourly: cityRaw ? {
        timestamps: values(cityHourly, "time"),
        temp2mC: values(cityHourly, "temperature_2m"),
      } : null,
    },
  };
}

function hasUsableWaves(raw: Record<string, any> | null): boolean {
  return Array.isArray(raw?.hourly?.wave_height)
    && raw.hourly.wave_height.some((value: unknown) =>
      typeof value === "number" && Number.isFinite(value),
    );
}

function hasUsableTemperature(raw: Record<string, any> | null): boolean {
  return Array.isArray(raw?.hourly?.temperature_2m)
    && raw.hourly.temperature_2m.some((value: unknown) =>
      typeof value === "number" && Number.isFinite(value),
    );
}

function normalizeMarine(
  raw: Record<string, any> | null,
  url: string,
  sailingArea: OpenMeteoTarget,
  timezone: string,
): Record<string, unknown> {
  const hourly = raw?.hourly;
  return {
    source: "Open-Meteo Marine API",
    url,
    available: hasUsableWaves(raw),
    fetchedAt: new Date().toISOString(),
    timezone: raw?.timezone ?? timezone,
    latitude: raw?.latitude ?? sailingArea.coordinates.lat,
    longitude: raw?.longitude ?? sailingArea.coordinates.lon,
    hourlyUnits: raw?.hourly_units ?? {},
    sailingArea: {
      name: sailingArea.name_de,
      coordinates: sailingArea.coordinates,
      hourly: hasUsableWaves(raw) ? {
        timestamps: values(hourly, "time"),
        waveHeightM: values(hourly, "wave_height"),
        waveDirDeg: values(hourly, "wave_direction"),
        wavePeriodS: values(hourly, "wave_period"),
        windWaveHeightM: values(hourly, "wind_wave_height"),
        windWaveDirDeg: values(hourly, "wind_wave_direction"),
        windWavePeriodS: values(hourly, "wind_wave_period"),
        swellHeightM: values(hourly, "swell_wave_height"),
        swellDirDeg: values(hourly, "swell_wave_direction"),
        swellPeriodS: values(hourly, "swell_wave_period"),
      } : null,
    },
  };
}

export async function fetchOpenMeteoWeather(
  sailingArea: OpenMeteoTarget,
  city: OpenMeteoTarget,
  timezone: string,
  onProgress?: (status: string) => void,
): Promise<{ data: Record<string, unknown>; sourceUrls: string[] }> {
  const forecastUrl = buildUrl(
    OPEN_METEO_FORECAST_URL,
    sailingArea.coordinates,
    timezone,
    FORECAST_HOURLY,
    { wind_speed_unit: "kn" },
  );
  const cityUrl = buildUrl(
    OPEN_METEO_FORECAST_URL,
    city.coordinates,
    timezone,
    ["temperature_2m"],
  );
  const marineUrl = buildUrl(
    OPEN_METEO_MARINE_URL,
    sailingArea.coordinates,
    timezone,
    MARINE_HOURLY,
  );

  onProgress?.("Lade lokale Sechs-Tage-Prognose von Open-Meteo");
  const [forecastRaw, cityRaw, marineRaw] = await Promise.all([
    fetchJson(forecastUrl, "Forecast"),
    fetchJson(cityUrl, "Temperatur"),
    fetchJson(marineUrl, "Marine"),
  ]);

  const sourceUrls: string[] = [];
  if (forecastRaw) {
    const provided = ["Wind", "Wolken", "Regen", "Gewitter"];
    if (hasUsableTemperature(cityRaw)) provided.push("Temperatur");
    sourceUrls.push(
      `Lokale ${formatForecastSource(provided)} von [Open-Meteo Forecast API](${OPEN_METEO_FORECAST_SOURCE_URL})`,
    );
  }
  if (hasUsableWaves(marineRaw)) {
    sourceUrls.push(
      `Lokale Wellen- und Dünungsvorhersage von [Open-Meteo Marine API](${OPEN_METEO_MARINE_SOURCE_URL})`,
    );
  }

  return {
    data: {
      openMeteoForecast: normalizeForecast(
        forecastRaw,
        forecastUrl,
        cityRaw,
        cityUrl,
        sailingArea,
        city,
        timezone,
      ),
      openMeteoMarine: normalizeMarine(marineRaw, marineUrl, sailingArea, timezone),
    },
    sourceUrls,
  };
}

function localDateHour(timestamp: string, timezone: string): {
  dateKey: string;
  label: string;
  hour: number;
} {
  const plain = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):/.exec(timestamp);
  if (plain && !/(Z|[+-]\d{2}:?\d{2})$/i.test(timestamp)) {
    const [, year, month, day, hour] = plain;
    const dateKey = `${year}-${month}-${day}`;
    const weekday = new Date(`${dateKey}T12:00:00Z`).getUTCDay();
    return { dateKey, label: `${DAY_NAMES[weekday]} ${day}.${month}`, hour: Number(hour) };
  }
  const date = new Date(timestamp);
  const dateKey = new Intl.DateTimeFormat("sv-SE", { timeZone: timezone }).format(date);
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: timezone,
    }).format(date),
  ) % 24;
  const [year, month, day] = dateKey.split("-");
  const weekday = new Date(`${year}-${month}-${day}T12:00:00Z`).getUTCDay();
  return { dateKey, label: `${DAY_NAMES[weekday]} ${day}.${month}`, hour };
}

function currentLocalDateHour(timezone: string): { dateKey: string; hour: number } {
  const now = new Date();
  return {
    dateKey: new Intl.DateTimeFormat("sv-SE", { timeZone: timezone }).format(now),
    hour: Number(
      new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        hour12: false,
        timeZone: timezone,
      }).format(now),
    ) % 24,
  };
}

function compass(degrees: unknown): string {
  const directions = ["N", "NNO", "NO", "ONO", "O", "OSO", "SO", "SSO", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return typeof degrees === "number" && Number.isFinite(degrees)
    ? directions[Math.round(degrees / 22.5) % directions.length]
    : "?";
}

function finiteNumbers(values: unknown[]): number[] {
  return values.filter((value): value is number =>
    typeof value === "number" && Number.isFinite(value),
  );
}

function range(values: number[]): string | null {
  if (!values.length) return null;
  return `${Math.round(Math.min(...values))}–${Math.round(Math.max(...values))}`;
}

function mostFrequent(values: string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "?";
}

const DOUGLAS_SCALE: Array<{ max: number; label: string }> = [
  { max: 0, label: "0 glatt" },
  { max: 0.1, label: "1 ruhig" },
  { max: 0.5, label: "2 schwach bewegt" },
  { max: 1.25, label: "3 leicht bewegt" },
  { max: 2.5, label: "4 mäßig bewegt" },
  { max: 4, label: "5 grob" },
  { max: 6, label: "6 sehr grob" },
  { max: 9, label: "7 hoch" },
  { max: 14, label: "8 sehr hoch" },
  { max: Infinity, label: "9 phänomenal" },
];

function douglas(height: number): string {
  return DOUGLAS_SCALE.find(entry => height <= entry.max)?.label ?? "9 phänomenal";
}

function cloudDescription(avgCloud: number): string {
  if (avgCloud < 20) return "klar bis sonnig";
  if (avgCloud < 50) return "leicht bis wechselnd bewölkt";
  if (avgCloud < 80) return "wechselnd bis stark bewölkt";
  return "meist stark bewölkt";
}

export function preprocessOpenMeteoLocal(
  rawData: Record<string, unknown>,
  timezone: string,
): Record<string, unknown> {
  const forecast = rawData["openMeteoForecast"] as any;
  const marine = rawData["openMeteoMarine"] as any;
  const hourly = forecast?.sailingArea?.hourly;
  const cityHourly = forecast?.city?.hourly;
  const forecastUrl = forecast?.url ?? null;
  const marineUrl = marine?.url ?? null;
  const sailingArea = forecast?.sailingArea?.name ?? null;
  const city = forecast?.city?.name ?? null;
  const empty = {
    wind: { source: "Open-Meteo Forecast API", url: forecastUrl, sailingArea, text_de: null },
    wave: { source: "Open-Meteo Marine API", url: marineUrl, sailingArea, text_de: null },
    cloudRainThunderstorm: { source: "Open-Meteo Forecast API", url: forecastUrl, text_de: null },
    temperature: { source: "Open-Meteo Forecast API", url: forecastUrl, city, text_de: null },
  };
  if (!Array.isArray(hourly?.timestamps)) return empty;

  const now = currentLocalDateHour(timezone);
  type WindRow = { label: string; dateKey: string; hour: number; speed: number; gust: number; direction: string };
  type WeatherRow = { label: string; dateKey: string; cloud: number; rain: number; cape: number; weatherCode: number | null };
  const windDays = new Map<string, WindRow[]>();
  const weatherDays = new Map<string, WeatherRow[]>();

  for (let index = 0; index < hourly.timestamps.length; index++) {
    const timestamp = hourly.timestamps[index];
    if (typeof timestamp !== "string") continue;
    const local = localDateHour(timestamp, timezone);
    const speed = hourly.windSpeedKt?.[index];
    if (typeof speed === "number" && Number.isFinite(speed)) {
      if (!(local.dateKey === now.dateKey && local.hour < now.hour)) {
        const rows = windDays.get(local.dateKey) ?? [];
        rows.push({
          label: local.label,
          dateKey: local.dateKey,
          hour: local.hour,
          speed,
          gust: typeof hourly.gustKt?.[index] === "number" ? hourly.gustKt[index] : speed,
          direction: compass(hourly.windDirDeg?.[index]),
        });
        windDays.set(local.dateKey, rows);
      }
    }
    const cloud = hourly.cloudCoverPct?.[index];
    const rain = hourly.rainMm?.[index];
    if (typeof cloud === "number" && typeof rain === "number") {
      const rows = weatherDays.get(local.dateKey) ?? [];
      rows.push({
        label: local.label,
        dateKey: local.dateKey,
        cloud,
        rain,
        cape: typeof hourly.capeJkg?.[index] === "number" ? hourly.capeJkg[index] : 0,
        weatherCode: typeof hourly.weatherCode?.[index] === "number" ? hourly.weatherCode[index] : null,
      });
      weatherDays.set(local.dateKey, rows);
    }
  }

  const windText = Array.from(windDays.values()).slice(0, 6).map(rows => {
    const samples = rows.filter((_, index) =>
      index === 0 || index === rows.length - 1 || index % Math.max(1, Math.round(rows.length / 3)) === 0,
    ).slice(0, 4).map(row =>
      `${String(row.hour).padStart(2, "0")}:00 ${row.direction} ${Math.round(row.speed)}-${Math.round(row.gust)} kt`,
    );
    const speeds = finiteNumbers(rows.map(row => row.speed));
    const gusts = finiteNumbers(rows.map(row => row.gust));
    return `${rows[0].label}: ${samples.join(", ")}; Wind ${range(speeds) ?? "?"} kt, Böen ${range(gusts) ?? "?"} kt, vorherrschend ${mostFrequent(rows.map(row => row.direction))}.`;
  }).join("\n");

  const cloudText = Array.from(weatherDays.values()).slice(0, 6).map(rows => {
    const avgCloud = rows.reduce((sum, row) => sum + row.cloud, 0) / rows.length;
    const rain = rows.reduce((sum, row) => sum + row.rain, 0);
    const thunderstorm = rows.some(row =>
      row.cape >= 1000 || [95, 96, 99].includes(row.weatherCode ?? -1),
    );
    return `${rows[0].label}: ${cloudDescription(avgCloud)}, ${rain >= 0.2 ? `${rain.toFixed(1)} mm Regen` : "trocken"}${thunderstorm ? ", Gewitterrisiko" : ", kein Gewitterrisiko"}.`;
  }).join("\n");

  const marineHourly = marine?.sailingArea?.hourly;
  const waveDays = new Map<string, Array<{ label: string; dateKey: string; hour: number; height: number }>>();
  if (Array.isArray(marineHourly?.timestamps) && Array.isArray(marineHourly?.waveHeightM)) {
    for (let index = 0; index < marineHourly.timestamps.length; index++) {
      const timestamp = marineHourly.timestamps[index];
      const height = marineHourly.waveHeightM[index];
      if (typeof timestamp !== "string" || typeof height !== "number" || !Number.isFinite(height)) continue;
      const local = localDateHour(timestamp, timezone);
      if (local.dateKey === now.dateKey && local.hour < now.hour) continue;
      const rows = waveDays.get(local.dateKey) ?? [];
      rows.push({ label: local.label, dateKey: local.dateKey, hour: local.hour, height });
      waveDays.set(local.dateKey, rows);
    }
  }
  const waveText = Array.from(waveDays.values()).slice(0, 2).map(rows => {
    const representative = Math.max(...rows.map(row => row.height));
    return `${rows[0].label}: See ${douglas(representative)}.`;
  }).join("\n");

  const temperatureDays = new Map<string, { label: string; values: number[] }>();
  if (Array.isArray(cityHourly?.timestamps) && Array.isArray(cityHourly?.temp2mC)) {
    for (let index = 0; index < cityHourly.timestamps.length; index++) {
      const timestamp = cityHourly.timestamps[index];
      const temperature = cityHourly.temp2mC[index];
      if (typeof timestamp !== "string" || typeof temperature !== "number" || !Number.isFinite(temperature)) continue;
      const local = localDateHour(timestamp, timezone);
      const entry = temperatureDays.get(local.dateKey) ?? { label: local.label, values: [] };
      entry.values.push(temperature);
      temperatureDays.set(local.dateKey, entry);
    }
  }
  const temperatureText = Array.from(temperatureDays.values()).slice(0, 3).map(day =>
    `${day.label}: ${range(day.values)}°C`,
  ).join("\n");

  return {
    wind: { ...empty.wind, text_de: windText || null },
    wave: { ...empty.wave, text_de: waveText || null },
    cloudRainThunderstorm: { ...empty.cloudRainThunderstorm, text_de: cloudText || null },
    temperature: { ...empty.temperature, text_de: temperatureText || null },
  };
}