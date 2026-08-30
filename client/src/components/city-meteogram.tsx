import React from "react";
import { WeatherIcon, type WeatherIconKind } from "./meteogram-weather-icon";

type JsonRecord = Record<string, unknown>;
type CloudType = "clear" | "cirrus" | "altostratus" | "stratus" | "cumulus" | "cumulonimbus" | "mixed";
type CloudBand = { key: "high" | "mid" | "low"; label: string; altitude: string };
type MeteogramPoint = {
  timestamp: string;
  dateKey: string;
  dayLabel: string;
  hourLabel: string;
  temperature: number | null;
  dewPoint: number | null;
  pressure: number | null;
  rain: number | null;
  precipProbability: number | null;
  weatherCode: number | null;
  cloudBase: number | null;
  cloudType: CloudType | null;
  cloudCover: number | null;
  cape: number | null;
  isDay: boolean | null;
  cloudBands: Array<{ key: CloudBand["key"]; label: string; pct: number | null }>;
};
type CityMeteogramData = {
  cityName: string;
  latitude: number | null;
  longitude: number | null;
  timezone: string;
  sourceUrl: string | null;
  points: MeteogramPoint[];
  bands: CloudBand[];
};
type CityMeteogramProps = { analysisJson: Record<string, unknown> | null; cityName?: string; isLoading?: boolean };

const DAY_NAMES = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const MAX_FORECAST_DAYS = 6;
const POINT_WIDTH = 44;
const MAX_RAIN_MM = 10;
const ROW = {
  day: 30,
  hours: 34,
  icons: 44,
  temperature: 42,
  dewPoint: 30,
  pressure: 106,
  cloudBand: 70,
  cloudBase: 35,
} as const;
const FORECAST_BLOCK_HEIGHT = ROW.icons + ROW.temperature;
const CLOUD_CHART_HEIGHT = ROW.cloudBand * 3;
const PRESSURE_RAIN_HEIGHT = CLOUD_CHART_HEIGHT;
const CLOUD_BANDS: CloudBand[] = [
  { key: "high", label: "HOCH", altitude: "6–13 km" },
  { key: "mid", label: "MITTEL", altitude: "2–6 km" },
  { key: "low", label: "TIEF", altitude: "0–2 km" },
];

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}
function asArray(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function asNumber(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function asString(value: unknown): string | null { return typeof value === "string" && value.length > 0 ? value : null; }
function asCloudType(value: unknown): CloudType | null {
  return typeof value === "string" && ["clear", "cirrus", "altostratus", "stratus", "cumulus", "cumulonimbus", "mixed"].includes(value)
    ? value as CloudType : null;
}
function asIsDay(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === 0 || value === 1) return value === 1;
  return null;
}
function cloudTypeLabel(type: CloudType | null): string {
  return ({ clear: "klarer Himmel", cirrus: "Cirrus", altostratus: "Altostratus", stratus: "Stratus", cumulus: "Cumulus", cumulonimbus: "Cumulonimbus", mixed: "gemischte Bewölkung" } as Record<CloudType, string>)[type ?? "mixed"];
}
export function cloudTypeColor(type: CloudType | null): string {
  if (type === "stratus") return "#fab219";
  if (type === "cumulonimbus") return "#d03b3b";
  return "#898781";
}
function cloudTypeTooltip(point: MeteogramPoint): string {
  const cloudValues = (["low", "mid", "high"] as const).map((key) => {
    const band = point.cloudBands.find((candidate) => candidate.key === key);
    return `${key === "low" ? "tief" : key === "mid" ? "mittel" : "hoch"} ${band?.pct === null || band?.pct === undefined ? "k. A." : `${Math.round(band.pct)}%`}`;
  }).join(" · ");
  const cape = point.cape === null ? "k. A." : `${Math.round(point.cape)} J/kg`;
  const rain = point.rain === null ? "k. A." : `${point.rain.toFixed(1)} mm`;
  return `${cloudTypeLabel(point.cloudType)} – ${cloudValues} · CAPE ${cape} · Regen ${rain} · heuristisch aus Modelldaten, keine Beobachtung`;
}
function parseLocalTimestamp(timestamp: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})/.exec(timestamp);
  if (!match) return null;
  const [, year, month, day, hour] = match;
  const date = new Date(`${year}-${month}-${day}T12:00:00Z`);
  return { dateKey: `${year}-${month}-${day}`, dayLabel: `${DAY_NAMES[date.getUTCDay()]} ${day}`, hourLabel: hour };
}
function localTimestampValue(timestamp: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})(?::(\d{2}))?/.exec(timestamp);
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5] ?? 0)) : null;
}
function localNowValue(timezone: string): number {
  try {
    const values = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(new Date()).map((part) => [part.type, part.value]),
    );
    return Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute));
  } catch {
    return Date.now();
  }
}

function weatherIconKind(point: MeteogramPoint): WeatherIconKind {
  const rain = point.rain ?? 0;
  const storm = point.cloudType === "cumulonimbus" || (point.weatherCode !== null && [95, 96, 99].includes(point.weatherCode));
  if (storm) return "thunderstorm";
  if (rain >= .5) return "heavy-rain";
  if (rain > 0) return "light-rain";

  const cloudCover = point.cloudCover ?? Math.max(0, ...point.cloudBands.map((band) => band.pct ?? 0));
  const amount = cloudCover < 10 ? "clear" : cloudCover < 40 ? "few" : cloudCover < 75 ? "broken" : "overcast";
  if (point.isDay === false) {
    if (amount === "clear") return "clear-night";
    if (amount === "few") return "partly-cloudy-night";
    return "overcast-night";
  }
  if (amount === "clear") return "clear-day";
  if (amount === "few") return "few-clouds-day";
  if (amount === "broken") return "partly-cloudy-day";
  return "overcast-day";
}

function weatherIcon(code: number | null, cloudType: CloudType | null) {
  const point = {
    weatherCode: code,
    cloudType,
    rain: code !== null && code >= 51 && code < 95 ? 1 : 0,
    cloudCover: cloudType === "clear" ? 0 : cloudType === "cirrus" ? 25 : 80,
    cloudBands: [],
    isDay: true,
  } as unknown as MeteogramPoint;
  return <span data-cloud-type-icon={cloudType ?? "mixed"}><WeatherIcon kind={weatherIconKind(point)} className="h-9 w-9" /></span>;
}

function MeteogramLoadingState() {
  return (
    <span className="inline-flex items-center gap-0.5 ml-1 mt-2 align-baseline" role="status" aria-live="polite" aria-label="Lädt" data-testid="bounce-loader">
      <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "0ms" }} />
      <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "150ms" }} />
      <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "300ms" }} />
    </span>
  );
}

function smoothPath(points: Array<[number, number]>) {
  if (!points.length) return "";
  return points.reduce((path, [x, y], index) => {
    if (!index) return `M ${x} ${y}`;
    const [px, py] = points[index - 1];
    const cx = (px + x) / 2;
    return `${path} C ${cx} ${py}, ${cx} ${y}, ${x} ${y}`;
  }, "");
}

export function extractCityMeteogram(analysisJson: Record<string, unknown> | null): CityMeteogramData | null {
  const weatherRaw = asRecord(analysisJson?.weatherRaw);
  const forecast = asRecord(weatherRaw?.openMeteoForecast);
  const city = asRecord(forecast?.city);
  if (!forecast || !city) return null;
  const hourly = asRecord(city.hourly);
  const entries = asArray(hourly?.timestamps).flatMap((value, index) => {
    const timestamp = asString(value);
    const local = timestamp ? parseLocalTimestamp(timestamp) : null;
    return timestamp && local ? [{ timestamp, index, local }] : [];
  });
  if (!entries.length) return null;
  const temperatures = asArray(hourly?.temp2mC);
  const dewPoints = asArray(hourly?.dewPoint2mC);
  const pressures = asArray(hourly?.pressureMslHPa);
  const rain = asArray(hourly?.rainMm);
  const precip = asArray(hourly?.precipProbabilityPct);
  const codes = asArray(hourly?.weatherCode);
  const bases = asArray(hourly?.cloudBaseM);
  const types = asArray(hourly?.cloudType);
  const cloudCover = asArray(hourly?.cloudCoverPct);
  const capeValues = asArray(hourly?.capeJkg);
  const days = asArray(hourly?.isDay);
  const cloudCoverByBand: Record<CloudBand["key"], unknown[]> = {
    high: asArray(hourly?.cloudCoverHighPct),
    mid: asArray(hourly?.cloudCoverMidPct),
    low: asArray(hourly?.cloudCoverLowPct),
  };
  const allPoints = entries.map(({ timestamp, index, local }) => ({
    timestamp,
    ...local,
    temperature: asNumber(temperatures[index]),
    dewPoint: asNumber(dewPoints[index]),
    pressure: asNumber(pressures[index]),
    rain: asNumber(rain[index]),
    precipProbability: asNumber(precip[index]),
    weatherCode: asNumber(codes[index]),
    cloudBase: asNumber(bases[index]),
    cloudType: asCloudType(types[index]),
    cloudCover: asNumber(cloudCover[index]),
    cape: asNumber(capeValues[index]),
    isDay: asIsDay(days[index]),
    cloudBands: CLOUD_BANDS.map((band) => ({ key: band.key, label: band.label, pct: asNumber(cloudCoverByBand[band.key][index]) })),
  }));
  const forecastDays = Array.from(new Set(allPoints.map((point) => point.dateKey))).slice(0, MAX_FORECAST_DAYS);
  const points = allPoints.filter((point) => forecastDays.includes(point.dateKey));
  const coordinates = asRecord(city.coordinates);
  return {
    cityName: asString(city.name) ?? "Stadt",
    latitude: asNumber(coordinates?.lat),
    longitude: asNumber(coordinates?.lon),
    timezone: asString(forecast.timezone) ?? "Ortszeit",
    sourceUrl: asString(city.url),
    points,
    bands: CLOUD_BANDS,
  };
}

export function formatCloudBase(heightM: number): string {
  if (heightM >= 10000) return `${Math.round(heightM / 1000)}k`;
  if (heightM >= 5000) return `${Math.round(heightM / 500) * 500}`;
  if (heightM >= 1000) return `${Math.round(heightM / 100) * 100}`;
  return `${Math.round(heightM / 50) * 50}`;
}
export function cloudBaseTone(heightM: number): string {
  if (heightM < 300) return "bg-rose-200/65 text-rose-800 dark:bg-rose-950/45 dark:text-rose-200";
  if (heightM < 600) return "bg-orange-200/65 text-orange-800 dark:bg-orange-950/45 dark:text-orange-200";
  if (heightM < 1000) return "bg-amber-200/60 text-amber-800 dark:bg-amber-950/45 dark:text-amber-200";
  if (heightM < 2000) return "bg-lime-200/50 text-lime-800 dark:bg-lime-950/40 dark:text-lime-200";
  if (heightM < 5000) return "bg-emerald-200/45 text-emerald-800 dark:bg-emerald-950/35 dark:text-emerald-200";
  return "text-slate-600 dark:text-slate-300";
}

const TEMPERATURE_COLORS: Array<[number, string]> = [
  [-5, "#1da8d1"],
  [5, "#51c6bd"],
  [10, "#a6d66e"],
  [18, "#f1dc6b"],
  [24, "#f49c5a"],
  [30, "#ec5d91"],
  [36, "#b84cc4"],
];
export function temperatureColor(value: number): string {
  if (value <= TEMPERATURE_COLORS[0][0]) return TEMPERATURE_COLORS[0][1];
  for (let index = 1; index < TEMPERATURE_COLORS.length; index += 1) {
    const [upperValue, upperColor] = TEMPERATURE_COLORS[index];
    const [lowerValue, lowerColor] = TEMPERATURE_COLORS[index - 1];
    if (value <= upperValue) {
      const ratio = (value - lowerValue) / (upperValue - lowerValue);
      const channels = [1, 3, 5].map((offset) => Math.round(parseInt(lowerColor.slice(offset, offset + 2), 16) + (parseInt(upperColor.slice(offset, offset + 2), 16) - parseInt(lowerColor.slice(offset, offset + 2), 16)) * ratio).toString(16).padStart(2, "0"));
      return `#${channels.join("")}`;
    }
  }
  return TEMPERATURE_COLORS[TEMPERATURE_COLORS.length - 1][1];
}

function formatRainAmount(value: number): string {
  return `${value < 10 ? value.toFixed(1) : Math.round(value)}mm`;
}
type RainDayGroup = { label: string; count: number; startIndex: number; rainTotal: number };
function rainDayGroups(points: MeteogramPoint[]): RainDayGroup[] {
  const groups: RainDayGroup[] = [];
  points.forEach((point, index) => {
    const last = groups[groups.length - 1];
    const rain = point.rain !== null && point.rain > 0 ? point.rain : 0;
    if (last?.label === point.dayLabel) {
      last.count += 1;
      last.rainTotal += rain;
    } else {
      groups.push({ label: point.dayLabel, count: 1, startIndex: index, rainTotal: rain });
    }
  });
  return groups;
}

function DayHeaders({ points }: { points: MeteogramPoint[] }) {
  const groups = rainDayGroups(points);
  return <div className="grid border-b border-[#d5d9de] bg-[#f7f8fa] text-[15px] font-medium tracking-[.03em] text-[#555c63]" style={{ height: ROW.day, gridTemplateColumns: `repeat(${points.length}, ${POINT_WIDTH}px)` }}>
    {groups.map((group, index) => <div key={`${group.label}-${index}`} className="flex items-center justify-start border-r border-[#d5d9de] pl-4" style={{ gridColumn: `span ${group.count}` }}><span>{group.label}</span></div>)}
  </div>;
}

function CloudTexture({ points, bandIndex, bandHeight }: { points: MeteogramPoint[]; bandIndex: number; bandHeight: number }) {
  return <g>
    {points.map((point, index) => {
      const pct = point.cloudBands[bandIndex]?.pct;
      if (pct === null || pct === undefined || pct <= 0) return null;
      const typeScale = point.cloudType === "cumulonimbus" ? 1.18 : point.cloudType === "cirrus" ? .68 : point.cloudType === "stratus" ? 1.08 : 1;
      const height = Math.max(10, Math.min(bandHeight * .88, bandHeight * (.18 + pct / 130) * typeScale));
      const width = Math.max(25, Math.min(POINT_WIDTH * 1.8, POINT_WIDTH * (.66 + pct / 115) * typeScale));
      const x = index * POINT_WIDTH + POINT_WIDTH / 2;
      const y = bandIndex * bandHeight + bandHeight * .74 - (pct / 100) * bandHeight * .32;
      return <g key={`cloud-${point.timestamp}-${bandIndex}`} data-cloud-shape-band={CLOUD_BANDS[bandIndex].key}>
        <ellipse cx={x} cy={y} rx={width / 2} ry={height / 2} fill="#818991" opacity={.17 + pct / 500} filter="url(#meteogram-cloud-soften)" />
        <ellipse cx={x - width * .12} cy={y - height * .1} rx={width * .32} ry={height * .36} fill="#69737a" opacity={.12 + pct / 520} filter="url(#meteogram-cloud-soften)" />
        {pct > 35 && <path d={`M ${x - width / 2} ${y + height * .14} Q ${x} ${y - height * .6} ${x + width / 2} ${y + height * .14}`} fill="none" stroke="#657078" strokeOpacity=".13" strokeWidth="1.5" />}
      </g>;
    })}
  </g>;
}

function LegacyCityMeteogram({ analysisJson, cityName, isLoading }: CityMeteogramProps) {
  const data = extractCityMeteogram(analysisJson);
  if (!data) {
    return isLoading
      ? <div data-testid="city-meteogram" data-meteogram-status="loading"><MeteogramLoadingState /></div>
      : <div className="border border-slate-300/70 bg-slate-100/70 px-3 py-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300" data-testid="city-meteogram" data-meteogram-status="unavailable">Meteogramm für die Stadtdaten nicht verfügbar.</div>;
  }

  const chartWidth = Math.max(data.points.length * POINT_WIDTH, POINT_WIDTH);
  const pressureValues = data.points.map((point) => point.pressure).filter((value): value is number => value !== null);
  const pressureRawMin = pressureValues.length ? Math.min(...pressureValues) : 980;
  const pressureRawMax = pressureValues.length ? Math.max(...pressureValues) : 1030;
  const pressureMidpoint = (pressureRawMin + pressureRawMax) / 2;
  const pressureHalfSpan = Math.max(3, (pressureRawMax - pressureRawMin) * .62);
  const pressureMin = pressureMidpoint - pressureHalfSpan;
  const pressureMax = pressureMidpoint + pressureHalfSpan;
  const maxRain = Math.max(1, ...data.points.map((point) => point.rain ?? 0));
  const layerHeight = CLOUD_CHART_HEIGHT / data.bands.length;
  const hasDewPoint = data.points.some((point) => point.dewPoint !== null);
  const hasCloudBase = data.points.some((point) => point.cloudBase !== null);
  const dayCount = new Set(data.points.map((point) => point.dateKey)).size;
  const temperatureValues = data.points.map((point) => point.temperature).filter((value): value is number => value !== null);
  const temperatureMin = temperatureValues.length ? Math.floor(Math.min(...temperatureValues) - 2) : 0;
  const temperatureMax = temperatureValues.length ? Math.ceil(Math.max(...temperatureValues) + 2) : 30;
  const temperatureY = (value: number) => 7 + (1 - (value - temperatureMin) / Math.max(1, temperatureMax - temperatureMin)) * (FORECAST_BLOCK_HEIGHT - 14);
  const tempPoints = data.points.flatMap((point, index) => point.temperature === null ? [] : [[index * POINT_WIDTH + POINT_WIDTH / 2, temperatureY(point.temperature)] as [number, number]]);
  const temperaturePath = smoothPath(tempPoints);
  const temperatureGradientStops = data.points.flatMap((point, index) => point.temperature === null ? [] : [{
    offset: data.points.length > 1 ? index / (data.points.length - 1) : 0,
    value: point.temperature,
    color: temperatureColor(point.temperature),
  }]);
  const temperatureArea = tempPoints.length ? `${smoothPath([[0, tempPoints[0][1]], ...tempPoints, [chartWidth, tempPoints[tempPoints.length - 1][1]]])} L ${chartWidth} ${FORECAST_BLOCK_HEIGHT} L 0 ${FORECAST_BLOCK_HEIGHT} Z` : "";
  const pressurePoints = data.points.flatMap((point, index) => point.pressure === null ? [] : [[index * POINT_WIDTH + POINT_WIDTH / 2, 18 + (1 - (point.pressure - pressureMin) / Math.max(1, pressureMax - pressureMin)) * (PRESSURE_RAIN_HEIGHT - 36), point.pressure] as [number, number, number]]);
  const nowValue = localNowValue(data.timezone);
  const currentPointIndex = data.points.reduce((bestIndex, point, index) => {
    const pointValue = localTimestampValue(point.timestamp);
    const bestValue = localTimestampValue(data.points[bestIndex]?.timestamp ?? "");
    return pointValue !== null && (bestValue === null || Math.abs(pointValue - nowValue) < Math.abs(bestValue - nowValue)) ? index : bestIndex;
  }, 0);
  const cityLabel = cityName || data.cityName;
  const grid = `repeat(${data.points.length}, ${POINT_WIDTH}px)`;
  const rainGroups = rainDayGroups(data.points);
  const firstRain = data.points.find((point) => (point.rain ?? 0) >= .05);
  const stormRisk = data.points.some((point) => point.cloudType === "cumulonimbus");
  const coordinateLabel = data.latitude !== null && data.longitude !== null
    ? `${Math.abs(data.latitude).toFixed(3)}° ${data.latitude < 0 ? "S" : "N"} · ${Math.abs(data.longitude).toFixed(3)}° ${data.longitude < 0 ? "W" : "E"}`
    : "Koordinaten nicht verfügbar";

  return <section className="meteogram-windy-shell relative left-0 w-full max-w-full translate-x-0 overflow-hidden border border-[#cbd0d6] bg-[#f5f6f8] text-[#30353a] shadow-[0_8px_24px_rgba(38,47,57,.1)] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 md:left-1/2 md:w-[min(1120px,calc(100vw-48px))] md:-translate-x-1/2" data-testid="city-meteogram" data-meteogram-status="ready" data-city-name={data.cityName} data-city-lat={data.latitude ?? ""} data-city-lon={data.longitude ?? ""} data-timezone={data.timezone} data-forecast-days={dayCount} data-forecast-points={data.points.length} aria-label={`Wettervorhersage für ${cityLabel} · ${dayCount} Tage, horizontal scrollbar`}>
    <header className="flex flex-col gap-2 border-b border-[#cbd0d6] bg-[#f1f3f5] px-4 py-3 sm:flex-row sm:items-end sm:justify-between sm:px-5">
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#737b84]">Wettervorhersage · {dayCount} Tage</div>
        <h3 className="truncate text-[23px] font-medium tracking-[-.025em] text-[#343a40] dark:text-slate-100">{cityLabel}</h3>
        <p className="text-[11px] text-[#7a828a]">{coordinateLabel} · Ortszeit {data.timezone}</p>
      </div>
      <div className="flex flex-wrap gap-1.5 text-[10px] font-semibold text-[#64707a]">
        <span className="border border-[#c7cdd2] bg-white px-2 py-1">Modellprognose</span>
        {firstRain && <span className="border border-[#a9cde1] bg-[#e3f0f8] px-2 py-1 text-[#27678d]">Regen ab {firstRain.dayLabel} {firstRain.hourLabel}:00</span>}
        {stormRisk && <span className="border border-[#e1b5b5] bg-[#fae5e5] px-2 py-1 text-[#a34848]">Gewitterrisiko</span>}
      </div>
    </header>
    <div className="border-b border-[#d3d7dc] bg-[#fafbfc] px-4 py-1.5 text-[10px] leading-4 text-[#7a828a] sm:px-5"><strong className="font-semibold text-[#555d65]">Lesart:</strong> Farben und Wolkenflächen zeigen den prognostizierten Verlauf. Wolkentypen sind heuristische Modelldaten, keine Beobachtung.</div>
    <div className="flex min-w-0">
      <aside className="w-[112px] shrink-0 border-r border-[#cbd0d6] bg-[#eceff2] text-[10px] leading-[12px] text-[#737b82] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 md:w-[176px]" aria-label="Feste Legende">
        <div style={{ height: ROW.day }} className="flex min-w-0 flex-col justify-center border-b border-[#d4d8dc] px-3">
          <div className="truncate text-[12px] font-semibold text-[#4a5158] dark:text-slate-100">{cityLabel}</div>
          <div className="mt-0.5 truncate text-[9px] text-[#858c93]">{data.timezone} · {data.points.length} Werte</div>
          {data.sourceUrl && <a href={data.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-1 w-fit text-[9px] font-semibold text-[#5e6870] underline-offset-2 hover:text-[#1d74a4] hover:underline" data-testid="meteogram-source-link">Open-Meteo ↗</a>}
        </div>
        <div style={{ height: ROW.hours }} className="flex items-center justify-center border-b border-[#d4d8dc] px-2 font-semibold">Stunden</div>
        <div style={{ height: ROW.icons }} className="flex items-center justify-center border-b border-[#d4d8dc] px-2">Wetter</div>
        <div style={{ height: ROW.temperature }} className="flex items-center justify-center border-b border-[#d4d8dc] px-2 text-[#a85e42]">Temperatur<br />°C</div>
        {hasDewPoint && <div style={{ height: ROW.dewPoint }} className="flex items-center justify-center border-b border-[#d4d8dc] px-2">Taupunkt</div>}
        <div data-testid="meteogram-fixed-cloud-labels" style={{ height: CLOUD_CHART_HEIGHT }} className="relative">
          <div className="absolute inset-y-0 left-0 flex w-[50%] flex-col items-center justify-center px-1 text-center text-[10px] text-[#69737b] md:text-[12px]"><span>Wolken</span><span className="mt-1 text-[#3275a0]">Regen</span><span className="text-[#3275a0]">· Druck</span><span className="text-[9px]">mm · hPa</span></div>
          <div className="absolute inset-y-0 right-0 flex w-[50%] flex-col">{data.bands.map((band) => <div key={band.key} data-fixed-cloud-band={band.key} className="flex min-h-0 flex-1 flex-col items-center justify-center border-b border-[#d7dbe0] px-1 text-center last:border-b-0"><strong className="text-[9px] tracking-[.03em] text-[#5d666e] md:text-[10px]">{band.label}</strong><span className="text-[8px] text-[#858c93] md:text-[9px]">{band.altitude}</span></div>)}</div>
        </div>
        {hasCloudBase && <div data-testid="meteogram-cloud-base-label" style={{ height: ROW.cloudBase }} className="flex items-center justify-center gap-1 bg-[#dff1df] px-2 text-center text-[#65716b]">Wolkenbasis <span className="underline">m</span></div>}
      </aside>
      <div className="meteogram-scroller min-w-0 flex-1 overflow-x-auto" data-testid="city-meteogram-scroll" aria-label={`${dayCount}-Tage-Meteogramm, horizontal scrollen für weitere Stunden`}>
        <div className="relative" style={{ width: chartWidth, minWidth: chartWidth }}>
          <div data-night-overlay-layer="true" className="pointer-events-none absolute inset-0 z-[15] flex">
            {data.points.map((point, index) => point.isDay === false
              ? <div key={`night-${point.timestamp}`} data-chart-night-column="true" data-night-shading="true" data-night-index={index} className="h-full shrink-0 bg-[#63709b]/[.075]" style={{ width: POINT_WIDTH }}><title>Nacht</title></div>
              : <div key={`day-${point.timestamp}`} className="h-full shrink-0" style={{ width: POINT_WIDTH }} />)}
          </div>
          <div className="relative z-10">
            <DayHeaders points={data.points} />
            <div className="grid border-b border-[#d5d9de] bg-[#fafbfc] text-[16px] font-normal text-[#717880]" style={{ height: ROW.hours, gridTemplateColumns: grid }}>{data.points.map((point, index) => <div key={`hour-${point.timestamp}-${index}`} title={point.timestamp} className="flex items-center justify-center">{Number(point.hourLabel)}</div>)}</div>
            <div className="relative border-b border-[#d5d9de]" style={{ height: FORECAST_BLOCK_HEIGHT }}>
              <svg data-testid="meteogram-temperature-area" data-temperature-layer="behind-forecast-rows" viewBox={`0 0 ${chartWidth} ${FORECAST_BLOCK_HEIGHT}`} width={chartWidth} height={FORECAST_BLOCK_HEIGHT} className="pointer-events-none absolute inset-0 z-0 block" role="img" aria-label="Temperaturverlauf">
                <defs>
                  <linearGradient id="temperature-gradient" gradientUnits="userSpaceOnUse" x1="0" x2={chartWidth} y1="0" y2="0">{temperatureGradientStops.map((stop, index) => <stop key={`temperature-stop-${index}`} data-temperature={stop.value} offset={`${stop.offset * 100}%`} stopColor={stop.color} />)}</linearGradient>
                  <linearGradient id="temperature-fade" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="white" stopOpacity=".82" /><stop offset="100%" stopColor="white" stopOpacity=".12" /></linearGradient>
                  <mask id="temperature-soft-fade"><rect width={chartWidth} height={FORECAST_BLOCK_HEIGHT} fill="url(#temperature-fade)" /></mask>
                </defs>
                {[ROW.icons, FORECAST_BLOCK_HEIGHT - 1].map((y) => <line key={y} x1="0" x2={chartWidth} y1={y} y2={y} stroke="#aeb6be" strokeOpacity=".3" strokeDasharray="2 4" />)}
                {temperatureArea && <path data-series="temperature" d={temperatureArea} fill="url(#temperature-gradient)" fillOpacity=".65" mask="url(#temperature-soft-fade)" />}
                {temperaturePath && <path data-series="temperature" d={temperaturePath} fill="none" stroke="url(#temperature-gradient)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />}
              </svg>
              <div className="relative z-10 grid" style={{ height: ROW.icons, gridTemplateColumns: grid }}>{data.points.map((point, index) => { const weatherDescription = `${point.hourLabel} Uhr · ${point.weatherCode === null ? "Wetterzustand nicht verfügbar" : `Wettercode ${point.weatherCode}`} · ${cloudTypeTooltip(point)}`; return <div key={`icon-${point.timestamp}-${index}`} data-weather-cloud-type={point.cloudType ?? "unknown"} className="flex items-center justify-center" role="img" aria-label={weatherDescription} title={weatherDescription}>{weatherIcon(point.weatherCode, point.cloudType)}</div>; })}</div>
              <div className="relative z-10 grid text-[21px] font-medium text-[#20252a]" style={{ height: ROW.temperature, gridTemplateColumns: grid }}>{data.points.map((point, index) => <div key={`temp-${point.timestamp}-${index}`} className="flex items-center justify-center">{point.temperature !== null ? `${Math.round(point.temperature)}°` : "—"}</div>)}</div>
            </div>
            {hasDewPoint && <div data-testid="meteogram-dew-point-row" aria-label="Taupunkt" className="grid border-b border-[#d5d9de] bg-[#fafbfc] text-[15px] text-[#7b838b]" style={{ height: ROW.dewPoint, gridTemplateColumns: grid }}>{data.points.map((point, index) => <div key={`dew-${point.timestamp}-${index}`} className="flex items-center justify-center">{point.dewPoint !== null ? `${Math.round(point.dewPoint)}°` : "—"}</div>)}</div>}
            <div className="relative border-b border-[#d5d9de] bg-[#f7f8fa]" style={{ height: CLOUD_CHART_HEIGHT }}>
              <svg data-testid="meteogram-cloud-field" viewBox={`0 0 ${chartWidth} ${CLOUD_CHART_HEIGHT}`} width={chartWidth} height={CLOUD_CHART_HEIGHT} className="pointer-events-none absolute inset-0 z-[1] block" role="img" aria-label="Mehrschichtige Wolkenbedeckung nach Höhe">
                <defs>
                  <filter id="meteogram-cloud-soften" x="-30%" y="-40%" width="160%" height="180%"><feGaussianBlur stdDeviation="4.6" /></filter>
                  {data.bands.map((band, bandIndex) => <clipPath key={`cloud-band-clip-${band.key}`} id={`meteogram-cloud-band-${band.key}`}><rect x="0" y={bandIndex * layerHeight} width={chartWidth} height={layerHeight} /></clipPath>)}
                </defs>
                {data.bands.map((band, bandIndex) => <g key={band.key}>
                  <rect x="0" y={bandIndex * layerHeight} width={chartWidth} height={layerHeight} fill={bandIndex % 2 === 0 ? "#f5f6f8" : "#fafbfc"} fillOpacity=".45" />
                  <line x1="0" x2={chartWidth} y1={bandIndex * layerHeight} y2={bandIndex * layerHeight} stroke="#89929b" strokeOpacity=".22" strokeDasharray="5 5" />
                  <line x1="0" x2={chartWidth} y1={(bandIndex + 1) * layerHeight - 1} y2={(bandIndex + 1) * layerHeight - 1} stroke="#89929b" strokeOpacity=".18" strokeDasharray="5 5" />
                  <g data-cloud-band-clip={band.key} clipPath={`url(#meteogram-cloud-band-${band.key})`}><CloudTexture points={data.points} bandIndex={bandIndex} bandHeight={layerHeight} /></g>
                </g>)}
                {data.points.map((point) => <rect key={`cloud-column-${point.timestamp}`} x={data.points.indexOf(point) * POINT_WIDTH} y="0" width={POINT_WIDTH} height={CLOUD_CHART_HEIGHT} fill="transparent"><title>{`${cloudTypeLabel(point.cloudType)} (heuristisch aus Modelldaten, keine Beobachtung) · ${data.bands.map((band, bandIndex) => `${band.label}: ${point.cloudBands[bandIndex]?.pct == null ? "k. A." : `${Math.round(point.cloudBands[bandIndex].pct)}%`}`).join(" · ")}`}</title></rect>)}
              </svg>
              <svg data-testid="meteogram-pressure-rain-overlay" viewBox={`0 0 ${chartWidth} ${PRESSURE_RAIN_HEIGHT}`} width={chartWidth} height={PRESSURE_RAIN_HEIGHT} className="pointer-events-none absolute inset-0 z-[2] block" role="img" aria-label="Luftdruck und Regen">
                {[.25, .5, .75].map((fraction) => <line key={fraction} x1="0" x2={chartWidth} y1={fraction * PRESSURE_RAIN_HEIGHT} y2={fraction * PRESSURE_RAIN_HEIGHT} stroke="#9aa4ad" strokeOpacity=".13" strokeDasharray="3 5" />)}
                {data.points.map((point, index) => { const rainValue = point.rain ?? 0; const barHeight = Math.min(55, Math.max(rainValue > 0 ? 3 : 0, rainValue / maxRain * 55)); const barY = PRESSURE_RAIN_HEIGHT - 6 - barHeight; const rainLabel = rainValue >= 0.05 ? formatRainAmount(rainValue) : null; return <g key={`lower-${point.timestamp}`} data-rain-column={rainLabel ?? "0"}><line x1={index * POINT_WIDTH} x2={index * POINT_WIDTH} y1="0" y2={PRESSURE_RAIN_HEIGHT} stroke="#9aa4ad" strokeOpacity=".035" />{rainLabel && <text data-rain-amount={rainLabel} x={index * POINT_WIDTH + POINT_WIDTH / 2} y={Math.max(14, barY - 5)} textAnchor="middle" fontSize="10" fontWeight="700" fill="#1266c5" stroke="#f7f8fa" strokeWidth="3" paintOrder="stroke">{rainLabel}</text>}<rect x={index * POINT_WIDTH + (POINT_WIDTH - 9) / 2} y={barY} width="9" height={barHeight} fill="#1268d0" opacity=".94"><title>{`${rainValue.toFixed(1)} mm Regen${point.precipProbability !== null ? ` · ${Math.round(point.precipProbability)}%` : ""}`}</title></rect></g>; })}
                <path data-testid="meteogram-pressure-line" data-pressure-min={pressureRawMin} data-pressure-max={pressureRawMax} d={smoothPath(pressurePoints.map(([x, y]) => [x, y]))} fill="none" stroke="#587b90" strokeWidth="1.5" strokeLinecap="round" />
                {pressurePoints.map(([x, y, pressure], index) => <g key={`pressure-${index}`}><circle cx={x} cy={y} r="1.1" fill="#f7f8fa" stroke="#587b90" strokeWidth=".8" />{index % 6 === 0 && <text data-pressure-label="true" x={x} y={Math.max(13, y - 6)} textAnchor="middle" fontSize="10" fontWeight="600" fill="#466d84" stroke="#f7f8fa" strokeWidth="3" paintOrder="stroke">{Math.round(pressure)} hPa</text>}</g>)}
              </svg>
              {rainGroups.map((group, index) => group.rainTotal >= 0.05 && <div key={`rain-total-${group.label}-${index}`} data-testid="meteogram-daily-rain" data-rain-total={group.rainTotal.toFixed(1)} data-rain-pill-placement="cloud-chart" title={`Tagessumme Niederschlag: ${formatRainAmount(group.rainTotal)}`} aria-label={`Tagessumme Niederschlag ${formatRainAmount(group.rainTotal)}`} className="pointer-events-auto absolute top-1.5 z-[3] -translate-x-full rounded-[4px] bg-[#0869d8] px-2 py-1 text-[11px] font-bold text-white shadow-[0_2px_4px_rgba(0,67,145,.2)]" style={{ left: (group.startIndex + group.count) * POINT_WIDTH - 13 }}>{formatRainAmount(group.rainTotal)}</div>)}
            </div>
            {hasCloudBase && <div data-testid="meteogram-cloud-base-row" aria-label="Geschätzte Wolkenuntergrenze" className="grid border-b border-[#d5d9de] bg-[#dff1df] text-[15px] font-medium text-[#5c6d61]" style={{ height: ROW.cloudBase, gridTemplateColumns: grid }}>{data.points.map((point, index) => <div key={`base-${point.timestamp}-${index}`} data-cloud-base-level={point.cloudBase === null ? "unavailable" : point.cloudBase < 300 ? "very-low" : point.cloudBase < 600 ? "low" : point.cloudBase < 1000 ? "caution" : point.cloudBase < 2000 ? "moderate" : point.cloudBase < 5000 ? "high" : "very-high"} className={`flex items-center justify-center ${point.cloudBase === null ? "" : cloudBaseTone(point.cloudBase)}`} title={point.cloudBase === null ? "Keine gültige Schätzung der Wolkenuntergrenze" : `Geschätzte Wolkenuntergrenze: ${Math.round(point.cloudBase)} m, aus Temperatur und Taupunkt abgeleitet; keine Beobachtung`}>{point.cloudBase !== null ? formatCloudBase(point.cloudBase) : "—"}</div>)}</div>}
          </div>
          <div data-testid="meteogram-current-column" role="img" aria-label={`Aktueller Prognosezeitpunkt: ${data.points[currentPointIndex].dayLabel} ${data.points[currentPointIndex].hourLabel}:00 Uhr`} className="pointer-events-none absolute z-20 rounded-[2px] border-2 border-transparent bg-transparent" style={{ left: currentPointIndex * POINT_WIDTH, top: ROW.day, bottom: 0, width: POINT_WIDTH }}>
            <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-[2px] bg-[#536b73] px-1.5 py-0.5 text-[8px] font-bold tracking-wide text-white">JETZT</span>
            <span aria-hidden="true" className="absolute inset-y-0 left-1/2 border-l border-dashed border-[#56646d]/75 dark:border-slate-300/55" />
          </div>
        </div>
      </div>
    </div>
    <footer className="flex flex-col gap-1 border-t border-[#cbd0d6] bg-[#f1f3f5] px-4 py-2 text-[10px] leading-4 text-[#7a828a] sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <span><strong className="font-semibold text-[#5a646d]">Hinweis:</strong> Wolkentypen und Wolkenhöhen sind modellbasierte Heuristiken, keine Beobachtungen.</span>
      <span className="whitespace-nowrap">Quelle: {data.sourceUrl ? <a href={data.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">Open-Meteo</a> : "Open-Meteo"}</span>
    </footer>
  </section>;
}

function AxisGlyph({ kind }: { kind: "clock" | "temperature" | "pressure" }) {
  if (kind === "clock") return <svg viewBox="0 0 24 24" className="h-5 w-5 text-[#373d42]" aria-hidden="true">
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="M12 6v6h5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>;
  if (kind === "temperature") return <div className="flex w-8 flex-col items-center text-[#30353a]" aria-hidden="true">
    <span className="text-[14px] leading-4">°C</span>
    <svg viewBox="0 0 24 8" className="h-2 w-6"><path d="M2 2h20M4 6h2m3 0h2m3 0h2m3 0h2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
  </div>;
  return <div className="flex w-8 flex-col items-center gap-1 text-[#30353a]" aria-hidden="true">
    <span className="border-b border-dotted border-current text-[12px] leading-4">hPa</span>
    <span className="border-b border-dotted border-current text-[12px] leading-4">mm</span>
  </div>;
}

function CityMeteogram({ analysisJson, cityName, isLoading }: CityMeteogramProps) {
  const data = extractCityMeteogram(analysisJson);
  if (!data) {
    return isLoading
      ? <div data-testid="city-meteogram" data-meteogram-status="loading"><MeteogramLoadingState /></div>
      : <div className="border border-slate-300/70 bg-slate-100/70 px-3 py-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300" data-testid="city-meteogram" data-meteogram-status="unavailable">Meteogramm für die Stadtdaten nicht verfügbar.</div>;
  }

  const points = data.points;
  const width = Math.max(POINT_WIDTH, points.length * POINT_WIDTH);
  const grid: React.CSSProperties = { gridTemplateColumns: `repeat(${points.length}, ${POINT_WIDTH}px)` };
  const dayGroups = rainDayGroups(points);
  const dayCount = dayGroups.length;
  const cityLabel = cityName || data.cityName;
  const hasDewPoint = points.some((point) => point.dewPoint !== null);
  const stormRisk = points.some((point) => point.cloudType === "cumulonimbus");
  const temperatureSectionHeight = ROW.icons + ROW.temperature + (hasDewPoint ? ROW.dewPoint : 0);
  const coordinateLabel = data.latitude !== null && data.longitude !== null
    ? `${Math.abs(data.latitude).toFixed(3)}° ${data.latitude < 0 ? "S" : "N"} · ${Math.abs(data.longitude).toFixed(3)}° ${data.longitude < 0 ? "W" : "E"}`
    : "Koordinaten nicht verfügbar";

  const temperatureValues = points.map((point) => point.temperature).filter((value): value is number => value !== null);
  const temperatureMin = temperatureValues.length ? Math.floor(Math.min(...temperatureValues) - 2) : 0;
  const temperatureMax = temperatureValues.length ? Math.ceil(Math.max(...temperatureValues) + 1) : 30;
  const temperatureY = (value: number) => 7 + (1 - (value - temperatureMin) / Math.max(1, temperatureMax - temperatureMin)) * 85;
  const temperaturePairs = points.flatMap((point, index) => point.temperature === null || point.dewPoint === null
    ? []
    : [{ x: index * POINT_WIDTH + POINT_WIDTH / 2, temperature: temperatureY(point.temperature), dewPoint: temperatureY(point.dewPoint) }]);
  const temperatureArea = temperaturePairs.length > 1
    ? `${smoothPath([[0, temperaturePairs[0].temperature], ...temperaturePairs.map((point) => [point.x, point.temperature] as [number, number]), [width, temperaturePairs.at(-1)!.temperature]])} L ${width} ${temperaturePairs.at(-1)!.dewPoint} ${smoothPath([...temperaturePairs].reverse().map((point) => [point.x, point.dewPoint] as [number, number])).replace(/^M /, "L ")} L 0 ${temperaturePairs[0].dewPoint} Z`
    : "";

  const pressureValues = points.map((point) => point.pressure).filter((value): value is number => value !== null);
  const pressureMin = pressureValues.length ? Math.min(...pressureValues) : 980;
  const pressureMax = pressureValues.length ? Math.max(...pressureValues) : 1030;
  const pressureY = (value: number) => 8 + (1 - (value - pressureMin) / Math.max(1, pressureMax - pressureMin)) * (ROW.pressure - 16);
  const pressurePoints = points.flatMap((point, index) => point.pressure === null
    ? []
    : [[index * POINT_WIDTH + POINT_WIDTH / 2, pressureY(point.pressure)] as [number, number]]);
  const pressureExtrema = points.flatMap((point, index) => {
    const previous = points[index - 1]?.pressure;
    const next = points[index + 1]?.pressure;
    if (point.pressure === null || previous === null || previous === undefined || next === null || next === undefined) return [];
    const isMaximum = point.pressure > previous && point.pressure > next;
    const isMinimum = point.pressure < previous && point.pressure < next;
    return isMaximum || isMinimum ? [{ point, index, isMaximum }] : [];
  });

  const nowValue = localNowValue(data.timezone);
  const currentPointIndex = points.reduce((bestIndex, point, index) => {
    const pointValue = localTimestampValue(point.timestamp);
    const bestValue = localTimestampValue(points[bestIndex]?.timestamp ?? "");
    return pointValue !== null && (bestValue === null || Math.abs(pointValue - nowValue) < Math.abs(bestValue - nowValue)) ? index : bestIndex;
  }, 0);

  return <section className="meteogram-windy-shell relative w-full max-w-full overflow-hidden rounded-[10px] border border-[#cbd0d6] bg-[#f5f6f8] font-sans text-[#30353a] shadow-[0_8px_24px_rgba(38,47,57,.1)]" data-testid="city-meteogram" data-meteogram-status="ready" data-city-name={data.cityName} data-city-lat={data.latitude ?? ""} data-city-lon={data.longitude ?? ""} data-timezone={data.timezone} data-forecast-days={dayCount} data-forecast-points={points.length} aria-label={`Wettervorhersage für ${cityLabel} · ${dayCount} Tage, horizontal scrollbar`}>
    <h3 className="sr-only">{cityLabel} · {coordinateLabel} · Ortszeit {data.timezone}{stormRisk ? " · Gewitterrisiko" : ""}</h3>
    <div className="flex min-w-0">
      <aside className="w-[108px] shrink-0 border-r border-[#cbd0d6] bg-[#eceff2] text-[12px] leading-[15px] text-[#7a7e82] md:w-[116px]" aria-label="Feste Legende">
        <div style={{ height: ROW.day }} />
        <div style={{ height: ROW.hours }} className="flex items-center justify-end gap-2 pr-2"><span>Stunden</span><AxisGlyph kind="clock" /></div>
        <div style={{ height: temperatureSectionHeight }} className="flex items-center justify-end gap-2 pr-2">
          <span className="text-right text-[12px] leading-[15px]"><span className="text-[#a85e42]">Temperatur</span>{hasDewPoint && <><br />Taupunkt</>}</span>
          <AxisGlyph kind="temperature" />
        </div>
        <div style={{ height: ROW.pressure }} className="flex items-center justify-end gap-2 pr-2">
          <span className="text-right text-[12px] leading-[15px]">Druck<br /><span className="text-[#3275a0]">Regen</span></span>
          <AxisGlyph kind="pressure" />
        </div>
        <div className="hidden" data-testid="meteogram-fixed-cloud-labels" style={{ color: cloudTypeColor("cirrus") }}>{data.bands.map((band) => <span key={band.key} data-fixed-cloud-band={band.key}>{band.label}</span>)}</div>
      </aside>

      <div className="meteogram-scroller min-w-0 flex-1 overflow-x-auto" data-testid="city-meteogram-scroll" aria-label={`${dayCount}-Tage-Meteogramm, horizontal scrollen für weitere Stunden`}>
        <div className="relative" style={{ width, minWidth: width }}>
          <div data-night-overlay-layer="true" className="pointer-events-none absolute inset-x-0 bottom-0 z-[15] flex" style={{ top: ROW.day }}>
            {points.map((point, index) => <div key={`daylight-${point.timestamp}`} data-chart-night-column={point.isDay === false ? "true" : undefined} data-night-shading={point.isDay === false ? "true" : undefined} data-night-index={point.isDay === false ? index : undefined} className={point.isDay === false ? "h-full shrink-0 bg-[#63709b]/[.075]" : "h-full shrink-0"} style={{ width: POINT_WIDTH }} />)}
          </div>

          <div className="relative z-10">
            <div className="grid bg-[#f7f8fa] text-[13px] font-medium tracking-[.01em] text-[#555c63]" style={{ height: ROW.day, ...grid }}>
              {dayGroups.map((day) => <div key={day.label} className="flex items-center border-r border-[#d5d9de] pl-3" style={{ gridColumn: `span ${day.count}` }}><span className="whitespace-nowrap">{day.label}</span></div>)}
            </div>
            <div className="grid text-[15px] text-[#717880]" style={{ height: ROW.hours, ...grid }}>
              {points.map((point) => <div key={`hour-${point.timestamp}`} className="flex items-center justify-center" title={point.timestamp}>{Number(point.hourLabel)}</div>)}
            </div>

            <div className="relative" style={{ height: temperatureSectionHeight }}>
              <svg data-testid="meteogram-temperature-area" data-temperature-layer="behind-forecast-rows" viewBox={`0 0 ${width} ${ROW.icons + ROW.temperature + 12}`} width={width} height={ROW.icons + ROW.temperature + 12} className="pointer-events-none absolute inset-0">
                <defs>
                  <linearGradient id="temperature-gradient" x2={width} gradientUnits="userSpaceOnUse">
                    {points.map((point, index) => <stop key={`temperature-stop-${point.timestamp}`} data-temperature={point.temperature ?? ""} offset={`${index / Math.max(1, points.length - 1) * 100}%`} stopColor={temperatureColor(point.temperature ?? temperatureMin)} />)}
                  </linearGradient>
                  <linearGradient id="temperature-fade" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="white" stopOpacity=".82" /><stop offset="100%" stopColor="white" stopOpacity=".12" /></linearGradient>
                </defs>
                {temperatureArea && <path data-series="temperature" d={temperatureArea} fill="url(#temperature-gradient)" fillOpacity=".56" />}
                {temperatureArea && <path data-series="temperature" d={temperatureArea} fill="none" stroke="none" />}
              </svg>
              <div className="relative z-30 grid" style={{ height: ROW.icons, ...grid }}>
                {points.map((point) => <div key={`icon-${point.timestamp}`} data-weather-cloud-type={point.cloudType ?? "unknown"} className="flex items-center justify-center" role="img" aria-label={`${point.hourLabel} Uhr · ${cloudTypeTooltip(point)}`} title={cloudTypeTooltip(point)}><span data-cloud-type-icon={point.cloudType ?? "unknown"}><WeatherIcon kind={weatherIconKind(point)} className="h-9 w-9" /></span></div>)}
              </div>
              <div className="relative z-20 grid text-[16px] font-medium tracking-[-.01em] text-[#20252a]" style={{ height: ROW.temperature, ...grid }}>
                {points.map((point) => <div key={`temperature-${point.timestamp}`} className="flex items-center justify-center">{point.temperature !== null ? `${Math.round(point.temperature)}°` : "—"}</div>)}
              </div>
              {hasDewPoint && <div data-testid="meteogram-dew-point-row" aria-label="Taupunkt" className="pointer-events-none absolute inset-0 z-30 grid" style={grid}>
                {points.map((point) => <div key={`dew-${point.timestamp}`} className="relative"><div className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[15px] leading-[16px] text-[#7b838b]" style={{ top: ROW.icons + ROW.temperature - 8 }}>{point.dewPoint !== null ? `${Math.round(point.dewPoint)}°` : "—"}</div></div>)}
              </div>}
            </div>

            <div className="relative" style={{ height: ROW.pressure }}>
              <svg data-testid="meteogram-cloud-field" className="hidden" viewBox={`0 0 ${width} ${CLOUD_CHART_HEIGHT}`} width={width} height={CLOUD_CHART_HEIGHT} aria-hidden="true">
                <defs>
                  <filter id="meteogram-cloud-soften" x="-30%" y="-40%" width="160%" height="180%"><feGaussianBlur stdDeviation="4.6" /></filter>
                  {data.bands.map((band, bandIndex) => <clipPath key={`compat-cloud-clip-${band.key}`} id={`meteogram-cloud-band-${band.key}`}><rect x="0" y={bandIndex * ROW.cloudBand} width={width} height={ROW.cloudBand} /></clipPath>)}
                </defs>
                {data.bands.map((band, bandIndex) => <g key={`compat-cloud-${band.key}`} data-cloud-band-clip={band.key} clipPath={`url(#meteogram-cloud-band-${band.key})`}><CloudTexture points={points} bandIndex={bandIndex} bandHeight={ROW.cloudBand} /></g>)}
              </svg>
              <svg data-testid="meteogram-pressure-rain-overlay" viewBox={`0 0 ${width} ${ROW.pressure}`} width={width} height={ROW.pressure} className="absolute inset-0" role="img" aria-label="Luftdruck und Regen">
                <defs><linearGradient id="current-pressure-fill" x1="0" x2="0" y1="0" y2={ROW.pressure} gradientUnits="userSpaceOnUse"><stop offset="0%" stopColor="#8baec0" stopOpacity=".3" /><stop offset="100%" stopColor="#cfe0e8" stopOpacity=".08" /></linearGradient></defs>
                {pressurePoints.length > 1 && <path d={`${smoothPath([[0, pressurePoints[0][1]], ...pressurePoints, [width, pressurePoints.at(-1)![1]]])} L ${width} ${ROW.pressure} L 0 ${ROW.pressure} Z`} fill="url(#current-pressure-fill)" />}
                {points.map((point, index) => {
                  const rain = Math.max(0, point.rain ?? 0);
                  if (rain < .05) return null;
                  const height = Math.max(1, Math.min(rain, MAX_RAIN_MM) / MAX_RAIN_MM * (ROW.pressure - 12));
                  const x = index * POINT_WIDTH + POINT_WIDTH / 2;
                  return <g key={`rain-${point.timestamp}`} data-rain-column={formatRainAmount(rain)}>
                    <rect x={x - 5} y={ROW.pressure - height - 4} width="10" height={height} fill="#0968d2" />
                    <text data-rain-amount={formatRainAmount(rain)} x={x} y={Math.max(11, ROW.pressure - height - 8)} textAnchor="middle" fontSize="9" fontWeight="700" fill="#1266c5">{formatRainAmount(rain)}</text>
                  </g>;
                })}
                {pressurePoints.length > 1 && <path data-testid="meteogram-pressure-line" data-pressure-min={pressureMin} data-pressure-max={pressureMax} d={smoothPath(pressurePoints)} fill="none" stroke="#587b90" strokeWidth="1.8" strokeLinecap="round" />}
                {pressureExtrema.map(({ point, index, isMaximum }) => {
                  const curveY = pressureY(point.pressure!);
                  const preferredY = curveY + (isMaximum ? -7 : 14);
                  const labelY = preferredY > ROW.pressure - 8 ? curveY - 8 : Math.max(16, preferredY);
                  const x = index * POINT_WIDTH + POINT_WIDTH / 2;
                  return <g key={`pressure-label-${point.timestamp}`}>
                    <rect x={x - 23} y={labelY - 11} width="46" height="15" rx="2" fill="#f7f8fa" fillOpacity=".94" />
                    <text data-pressure-label="true" x={x} y={labelY} textAnchor="middle" fontSize="11" fontWeight="600" fontFamily="Open Sans, sans-serif" fill="#4d6979">{Math.round(point.pressure!)} hPa</text>
                  </g>;
                })}
                <text x="-100" y="-100" fontSize="10" aria-hidden="true">hPa</text>
              </svg>
              {dayGroups.map((day) => day.rainTotal >= .05 && <div key={`rain-total-${day.label}`} data-testid="meteogram-daily-rain" data-rain-total={day.rainTotal.toFixed(1)} data-rain-pill-placement="cloud-chart" title={`Tagessumme Niederschlag: ${formatRainAmount(day.rainTotal)}`} className="pointer-events-none absolute top-1.5 z-20 -translate-x-full rounded-[4px] bg-[#0869d8] px-1 py-0.5 text-[9px] font-bold leading-[12px] text-white shadow-[0_1px_2px_rgba(0,45,120,.22)]" style={{ left: (day.startIndex + day.count) * POINT_WIDTH - 4 }}>{formatRainAmount(day.rainTotal)}</div>)}
            </div>
          </div>

          {dayGroups.slice(1).map((day) => <div key={`boundary-${day.label}`} className="pointer-events-none absolute inset-y-0 z-10 border-l border-[#b6bec5]" style={{ left: day.startIndex * POINT_WIDTH }} />)}
          <div data-testid="meteogram-current-column" role="img" aria-label={`Aktueller Prognosezeitpunkt: ${points[currentPointIndex].dayLabel} ${points[currentPointIndex].hourLabel}:00 Uhr`} className="pointer-events-none absolute z-20 border-l border-dashed border-[#bd8d8d]/75" style={{ left: currentPointIndex * POINT_WIDTH + POINT_WIDTH / 2, top: ROW.day, bottom: 0 }}><span className="absolute -left-[19px] top-1 rounded bg-[#b85e42] px-1.5 py-0.5 text-[8px] font-bold text-[#fff4e9]">JETZT</span></div>
        </div>
      </div>
    </div>
  </section>;
}

export default CityMeteogram;