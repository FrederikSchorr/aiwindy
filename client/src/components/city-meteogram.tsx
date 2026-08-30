import { Cloud, CloudLightning, CloudRain, CloudSun, Sun } from "lucide-react";
import React from "react";

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

const DAY_NAMES = ["SONNTAG", "MONTAG", "DIENSTAG", "MITTWOCH", "DONNERSTAG", "FREITAG", "SAMSTAG"];
const POINT_WIDTH = 60;
const ROW = {
  day: 43,
  hours: 34,
  icons: 50,
  temperature: 42,
  dewPoint: 31,
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

function weatherIcon(code: number | null, cloudType: CloudType | null) {
  const isRain = code !== null && code >= 51 && code < 95;
  const isStorm = code !== null && code >= 95;
  const type = cloudType ?? (isStorm ? "cumulonimbus" : isRain ? "stratus" : code !== null && code <= 1 ? "clear" : "mixed");
  const color = cloudTypeColor(type);
  const common = { viewBox: "0 0 36 32", className: "h-9 w-10", "data-cloud-type-icon": type, "aria-hidden": true };
  const sun = <><circle cx="11" cy="10" r="5" fill="#f4b400" /><g stroke="#e7a600" strokeWidth="1.6" strokeLinecap="round"><path d="M11 2v3M11 15v3M3 10h3M16 10h3M5.3 4.3l2 2M14.7 13.7l2 2M16.7 4.3l-2 2M7.3 13.7l-2 2" /></g></>;
  const drops = isRain ? <path d="M12 25l-2 4M19 25l-2 4M26 25l-2 4" stroke="#2278a7" strokeWidth="2" strokeLinecap="round" /> : null;
  if (type === "clear" && !isRain && !isStorm) return <svg {...common} viewBox="0 0 32 32" className="h-9 w-9"><circle cx="16" cy="16" r="7" fill="#f4b400" /><g stroke="#e7a600" strokeWidth="2.3" strokeLinecap="round"><path d="M16 3v4M16 25v4M3 16h4M25 16h4M6.8 6.8l2.8 2.8M22.4 22.4l2.8 2.8M25.2 6.8l-2.8 2.8M9.6 22.4l-2.8 2.8" /></g></svg>;
  if (type === "cirrus") return <svg {...common}>{sun}<path d="M2 21c4-1 4-7 8-7 2 0 2 2 0 3M12 19c3-1 3-6 7-6 2 0 2 2 0 3M21 20c3-1 3-5 7-5" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" />{drops}</svg>;
  if (type === "altostratus") return <svg {...common}>{sun}<path d="M8 15h25M7 19h26M6 23h25" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" />{drops}</svg>;
  if (type === "stratus") return <svg {...common}><path d="M4 11h26a4 4 0 0 1 0 8H4a4 4 0 0 1 0-8Z" fill={color} fillOpacity=".24" stroke={color} strokeWidth="1.7" /><path d="M4 24h27" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" />{drops}</svg>;
  if (type === "cumulonimbus" || isStorm) return <svg {...common}><path d="M3 19h25a5 5 0 0 0 0-10h-4a7 7 0 0 0-13-1 5.5 5.5 0 0 0-5 5H3Z" fill={color} fillOpacity=".22" stroke={color} strokeWidth="1.7" /><path d="m18 13-4 7h4l-2 7 7-10h-4l3-4Z" fill={color} stroke={color} strokeWidth="1.2" strokeLinejoin="round" /></svg>;
  if (type === "cumulus") return <svg {...common}>{!isRain && sun}<path d="M5 22h25a5 5 0 0 0 0-10 7 7 0 0 0-13-1 5.5 5.5 0 0 0-8 5 3.5 3.5 0 0 0-4 6Z" fill="#898781" fillOpacity=".24" stroke={color} strokeWidth="1.7" />{drops}</svg>;
  return <svg {...common}><path d="M4 21h17a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11-1 4.5 4.5 0 0 0-6 4 3 3 0 0 0 0 6Z" fill="#898781" fillOpacity=".2" stroke={color} strokeWidth="1.7" /><path d="M15 24h13a3.5 3.5 0 0 0 0-7" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" />{drops}</svg>;
}

const LOADING_ICONS = [Sun, CloudSun, Cloud, CloudRain, CloudLightning] as const;
function MeteogramLoadingState() {
  const [iconIndex, setIconIndex] = React.useState(0);
  React.useEffect(() => {
    const timer = window.setInterval(() => setIconIndex((current) => (current + 1) % LOADING_ICONS.length), 700);
    return () => window.clearInterval(timer);
  }, []);
  const LoadingIcon = LOADING_ICONS[iconIndex];
  return <span className="inline-flex items-center gap-2" role="status" aria-live="polite"><span className="inline-flex h-4 w-4 items-center justify-center" data-testid="meteogram-loading-icon"><LoadingIcon className="h-4 w-4 text-sky-500" aria-hidden="true" /></span><span>Meteogramm wird vorbereitet …</span></span>;
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
  const capeValues = asArray(hourly?.capeJkg);
  const days = asArray(hourly?.isDay);
  const cloudCoverByBand: Record<CloudBand["key"], unknown[]> = {
    high: asArray(hourly?.cloudCoverHighPct),
    mid: asArray(hourly?.cloudCoverMidPct),
    low: asArray(hourly?.cloudCoverLowPct),
  };
  const points = entries.map(({ timestamp, index, local }) => ({
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
    cape: asNumber(capeValues[index]),
    isDay: asIsDay(days[index]),
    cloudBands: CLOUD_BANDS.map((band) => ({ key: band.key, label: band.label, pct: asNumber(cloudCoverByBand[band.key][index]) })),
  }));
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

function CityMeteogram({ analysisJson, cityName, isLoading }: CityMeteogramProps) {
  const data = extractCityMeteogram(analysisJson);
  if (!data) {
    return <div className="border border-slate-300/70 bg-slate-100/70 px-3 py-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300" data-testid="city-meteogram" data-meteogram-status={isLoading ? "loading" : "unavailable"}>{isLoading ? <MeteogramLoadingState /> : "Meteogramm für die Stadtdaten nicht verfügbar."}</div>;
  }

  const chartWidth = data.points.length * POINT_WIDTH;
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

  return <section className="meteogram-windy-shell relative left-0 w-full max-w-full translate-x-0 overflow-hidden border border-[#cbd0d6] bg-[#f5f6f8] text-[#30353a] shadow-[0_8px_24px_rgba(38,47,57,.1)] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 md:left-1/2 md:w-[min(1120px,calc(100vw-48px))] md:-translate-x-1/2" data-testid="city-meteogram" data-meteogram-status="ready" data-city-name={data.cityName} data-city-lat={data.latitude ?? ""} data-city-lon={data.longitude ?? ""} data-timezone={data.timezone} aria-label={`Wettervorhersage für ${cityLabel}`}>
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
      <div className="meteogram-scroller min-w-0 flex-1 overflow-x-auto" data-testid="city-meteogram-scroll">
        <div className="relative" style={{ minWidth: chartWidth }}>
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

export default CityMeteogram;