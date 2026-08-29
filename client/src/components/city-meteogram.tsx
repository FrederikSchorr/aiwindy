import { Cloud, CloudLightning, CloudRain, CloudSun, Sun } from "lucide-react";
import React from "react";

type JsonRecord = Record<string, unknown>;
type CloudType = "clear" | "cirrus" | "altostratus" | "stratus" | "cumulus" | "cumulonimbus" | "mixed";
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
type CloudBand = { key: "high" | "mid" | "low"; label: string; altitude: string };
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
const POINT_WIDTH = 64;
const ROW = {
  day: 48,
  hours: 38,
  icons: 54,
  temperature: 42,
  temperatureArea: 96,
  dewPoint: 34,
  cloudBand: 72,
  cloudBase: 38,
} as const;
const CLOUD_CHART_HEIGHT = ROW.cloudBand * 3;
const PRESSURE_RAIN_HEIGHT = CLOUD_CHART_HEIGHT;
const FORECAST_BLOCK_HEIGHT = ROW.temperatureArea;
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
  const drops = isRain ? <path d="M12 25l-2 4M19 25l-2 4M26 25l-2 4" stroke="#6e9db4" strokeWidth="2" strokeLinecap="round" /> : null;
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
    const timer = window.setInterval(() => {
      setIconIndex((current) => (current + 1) % LOADING_ICONS.length);
    }, 700);
    return () => window.clearInterval(timer);
  }, []);
  const LoadingIcon = LOADING_ICONS[iconIndex];
  return (
    <span className="inline-flex items-center gap-2" role="status" aria-live="polite">
      <span className="inline-flex h-4 w-4 items-center justify-center" data-testid="meteogram-loading-icon">
        <LoadingIcon className="h-4 w-4 text-sky-500" aria-hidden="true" />
      </span>
      <span>Meteogramm wird vorbereitet …</span>
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
  const capeValues = asArray(hourly?.capeJkg);
  const days = asArray(hourly?.isDay);
  const cloudCoverByBand: Record<CloudBand["key"], unknown[]> = {
    high: asArray(hourly?.cloudCoverHighPct),
    mid: asArray(hourly?.cloudCoverMidPct),
    low: asArray(hourly?.cloudCoverLowPct),
  };
  const points = entries.map(({ timestamp, index, local }) => {
    const cloudBands = CLOUD_BANDS.map((band) => ({
      key: band.key,
      label: band.label,
      pct: asNumber(cloudCoverByBand[band.key][index]),
    }));
    return {
      timestamp, ...local,
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
      cloudBands,
    };
  });
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

function cloudAreaPath(points: MeteogramPoint[], bandIndex: number, bandHeight: number): string {
  const top = bandIndex * bandHeight;
  const segments: Array<Array<[number, number]>> = [];
  let active: Array<[number, number]> = [];
  points.forEach((point, index) => {
    const pct = point.cloudBands[bandIndex]?.pct;
    if (pct === null || pct === undefined || pct <= 0) {
      if (active.length) segments.push(active);
      active = [];
      return;
    }
    active.push([index * POINT_WIDTH + POINT_WIDTH / 2, top + bandHeight - Math.max(2, (pct / 100) * bandHeight * 0.86)]);
  });
  if (active.length) segments.push(active);
  const chartWidth = points.length * POINT_WIDTH;
  return segments.map((samples) => {
    const left = Math.max(0, samples[0][0] - POINT_WIDTH / 2);
    const right = Math.min(chartWidth, samples[samples.length - 1][0] + POINT_WIDTH / 2);
    return `${smoothPath([[left, samples[0][1]], ...samples, [right, samples[samples.length - 1][1]]])} L ${right} ${top + bandHeight} L ${left} ${top + bandHeight} Z`;
  }).join(" ");
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
  [-5, "#27a7d6"],
  [5, "#55c7c1"],
  [10, "#a7d66d"],
  [18, "#f1dd70"],
  [24, "#f5a15c"],
  [30, "#ec5e91"],
  [36, "#b84cc4"],
];
export function temperatureColor(value: number): string {
  if (value <= TEMPERATURE_COLORS[0][0]) return TEMPERATURE_COLORS[0][1];
  for (let index = 1; index < TEMPERATURE_COLORS.length; index += 1) {
    const [upperValue, upperColor] = TEMPERATURE_COLORS[index];
    const [lowerValue, lowerColor] = TEMPERATURE_COLORS[index - 1];
    if (value <= upperValue) {
      const ratio = (value - lowerValue) / (upperValue - lowerValue);
      const channels = [1, 3, 5].map((offset) =>
        Math.round(parseInt(lowerColor.slice(offset, offset + 2), 16)
          + (parseInt(upperColor.slice(offset, offset + 2), 16) - parseInt(lowerColor.slice(offset, offset + 2), 16)) * ratio)
          .toString(16).padStart(2, "0"),
      );
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
    } else groups.push({ label: point.dayLabel, count: 1, startIndex: index, rainTotal: rain });
  });
  return groups;
}
function DayHeaders({ points }: { points: MeteogramPoint[] }) {
  const groups = rainDayGroups(points);
  return (
    <div className="grid border-b border-slate-300/45 bg-[#f4f6f7]/80 text-[15px] font-semibold tracking-[.055em] text-slate-700 dark:border-slate-700/50 dark:bg-white/[.035] dark:text-slate-200" style={{ height: ROW.day, gridTemplateColumns: `repeat(${points.length}, ${POINT_WIDTH}px)` }}>
      {groups.map((group, index) => <div key={`${group.label}-${index}`} className="flex items-center justify-start pl-4 dark:border-slate-700/50" style={{ gridColumn: `span ${group.count}` }}><span>{group.label}</span></div>)}
    </div>
  );
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
  const temperatureY = (value: number) => 5 + (1 - (value - temperatureMin) / Math.max(1, temperatureMax - temperatureMin)) * (FORECAST_BLOCK_HEIGHT - 10);
  const tempPoints = data.points.flatMap((point, index) => point.temperature === null ? [] : [[index * POINT_WIDTH + POINT_WIDTH / 2, temperatureY(point.temperature)] as [number, number]]);
  const temperaturePath = smoothPath(tempPoints);
  const temperatureGradientStops = data.points.flatMap((point, index) => point.temperature === null ? [] : [{
    offset: data.points.length > 1 ? index / (data.points.length - 1) : 0,
    value: point.temperature,
    color: temperatureColor(point.temperature),
  }]);
  const temperatureArea = tempPoints.length
    ? `${smoothPath([[0, tempPoints[0][1]], ...tempPoints, [chartWidth, tempPoints[tempPoints.length - 1][1]]])} L ${chartWidth} ${FORECAST_BLOCK_HEIGHT} L 0 ${FORECAST_BLOCK_HEIGHT} Z`
    : "";
  const pressurePoints = data.points.flatMap((point, index) => point.pressure === null ? [] : [[index * POINT_WIDTH + POINT_WIDTH / 2, 10 + (1 - (point.pressure - pressureMin) / Math.max(1, pressureMax - pressureMin)) * (PRESSURE_RAIN_HEIGHT - 28), point.pressure] as [number, number, number]]);
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

  return (
    <section className="meteogram-shell relative left-0 w-full max-w-full translate-x-0 overflow-hidden border border-[#c7d2d3] bg-[#f5f7f4] text-[#33464c] shadow-[0_14px_38px_rgba(55,77,76,.11)] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 md:left-1/2 md:w-[min(1120px,calc(100vw-48px))] md:-translate-x-1/2" data-testid="city-meteogram" data-meteogram-status="ready" data-city-name={data.cityName} data-city-lat={data.latitude ?? ""} data-city-lon={data.longitude ?? ""} data-timezone={data.timezone} aria-label={`Atmosphärische Wetterkarte für ${cityLabel}`}>
      <header className="flex flex-col gap-4 border-b border-[#c7d2d3] bg-[#eef3ef] px-4 py-4 dark:border-slate-700 dark:bg-slate-900 sm:px-6 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <div className="mb-1.5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.18em] text-[#6b7e7a] dark:text-slate-400"><span className="h-2 w-2 shrink-0 rounded-full bg-[#7a9d82]" />Atmosphärische Karte · {dayCount} Tage</div>
          <h3 className="truncate font-serif text-2xl tracking-[-.03em] text-[#263d42] dark:text-slate-100 sm:text-3xl">{cityLabel}</h3>
          <p className="mt-1 text-xs text-[#70817e] dark:text-slate-400">{coordinateLabel} · Ortszeit {data.timezone}</p>
        </div>
        <div className="flex flex-wrap gap-2 text-[10px] font-semibold">
          <span className="rounded-full border border-[#cbd9cd] bg-[#e0ece1] px-2.5 py-1 text-[#52735b] dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200">Modellprognose</span>
          {firstRain && <span className="rounded-full border border-[#c9dbe5] bg-[#e1edf3] px-2.5 py-1 text-[#42718a] dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-200">Regen {firstRain.dayLabel} {firstRain.hourLabel}:00</span>}
          {stormRisk && <span className="rounded-full border border-[#dfc1c1] bg-[#f3dfdf] px-2.5 py-1 text-[#9c4d4d] dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">Gewitterrisiko</span>}
        </div>
      </header>
      <div className="border-b border-[#d5dddd] bg-[#f8faf7] px-4 py-2 text-[11px] leading-5 text-[#6d7c7c] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400 sm:px-6"><strong className="text-[#405b5b] dark:text-slate-200">Lesart:</strong> Die Wolkenflächen bilden den Horizont — je dichter, desto bedeckter. Modellkarte für Muster, kein Beobachtungsbild.</div>
      <div className="flex min-w-0">
        <aside className="w-[116px] shrink-0 border-r border-[#cbd5d5] bg-[#e9efec] text-[10px] leading-[13px] text-[#627371] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 md:w-[176px]" aria-label="Feste Legende">
          <div style={{ height: ROW.day }} className="flex min-w-0 flex-col justify-center border-b border-slate-300/50 px-3 dark:border-slate-700">
            <div className="truncate text-[13px] font-semibold tracking-tight text-slate-800 dark:text-slate-100">{cityLabel}</div>
            <div className="mt-0.5 truncate text-[9px] text-slate-500 dark:text-slate-400">{data.timezone} · {dayCount} Tage · {data.points.length} Punkte</div>
            {data.sourceUrl && <a href={data.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-1 w-fit text-[9px] font-semibold text-slate-600 underline-offset-2 hover:text-[#d55f32] hover:underline dark:text-slate-300" data-testid="meteogram-source-link">Open-Meteo ↗</a>}
          </div>
          <div style={{ height: ROW.hours }} className="flex items-center justify-center border-b border-[#d4dddd] px-2 font-semibold">Zeit · Wetter</div>
          <div style={{ height: ROW.icons }} className="flex items-center justify-center border-b border-[#d4dddd] px-2">Wetter</div>
          <div style={{ height: ROW.temperature }} className="flex items-center justify-center border-b border-[#d4dddd] px-2 font-medium text-[#ad6747]">Temperatur · °C</div>
          {hasDewPoint && <div style={{ height: ROW.dewPoint }} className="flex items-center justify-center px-2">Taupunkt</div>}
          <div data-testid="meteogram-fixed-cloud-labels" style={{ height: CLOUD_CHART_HEIGHT }} className="relative">
            <div className="absolute inset-y-0 left-0 flex w-[52%] flex-col items-center justify-center px-1 text-center text-[10px] font-medium leading-[13px] text-slate-500 md:text-[12px]">
              <span>Wolken</span><span className="mt-1 text-[#457292]">Regen · Druck</span><span className="underline">mm · hPa</span>
            </div>
            <div className="absolute inset-y-0 right-0 flex w-[48%] flex-col">
              {data.bands.map((band) => <div key={band.key} data-fixed-cloud-band={band.key} className="flex min-h-0 flex-1 flex-col items-center justify-center px-1 text-center"><strong className="text-[10px] tracking-[.04em] text-slate-600 md:text-[11px]">{band.label}</strong><span className="text-[9px] text-slate-500 md:text-[10px]">{band.altitude}</span></div>)}
            </div>
          </div>
          {hasCloudBase && <div data-testid="meteogram-cloud-base-label" style={{ height: ROW.cloudBase }} className="flex items-center justify-center gap-1 bg-[#e0ece1] px-2 text-center">Wolkenbasis <span className="underline">m</span></div>}
        </aside>
        <div className="meteogram-scroller min-w-0 flex-1 overflow-x-auto" data-testid="city-meteogram-scroll">
          <div className="relative" style={{ minWidth: chartWidth }}>
            <div data-night-overlay-layer="true" className="pointer-events-none absolute inset-0 z-[15] flex">
              {data.points.map((point, index) => point.isDay === false
                 ? <div key={`night-${point.timestamp}`} data-chart-night-column="true" data-night-shading="true" data-night-index={index} className="h-full shrink-0 bg-[#6872a3]/[.055] dark:bg-[#aeb5df]/[.07]" style={{ width: POINT_WIDTH }}><title>Nacht</title></div>
                : <div key={`day-${point.timestamp}`} className="h-full shrink-0" style={{ width: POINT_WIDTH }} />)}
            </div>
            <div className="relative z-10">
              <DayHeaders points={data.points} />
                <div className="grid border-b border-slate-300/45 text-[17px] font-medium text-slate-500 dark:border-slate-700/50 dark:text-slate-400" style={{ height: ROW.hours, gridTemplateColumns: grid }}>{data.points.map((point, index) => <div key={`hour-${point.timestamp}-${index}`} title={point.timestamp} className="flex items-center justify-center">{point.hourLabel}</div>)}</div>
              <div className="relative border-b border-slate-300/45 dark:border-slate-700/50" style={{ height: FORECAST_BLOCK_HEIGHT }}>
                <svg data-testid="meteogram-temperature-area" data-temperature-layer="behind-forecast-rows" viewBox={`0 0 ${chartWidth} ${FORECAST_BLOCK_HEIGHT}`} width={chartWidth} height={FORECAST_BLOCK_HEIGHT} className="pointer-events-none absolute inset-0 z-0 block" role="img" aria-label="Temperaturverlauf">
                  {[12, 24].map((y) => <line key={y} x1="0" x2={chartWidth} y1={y} y2={y} stroke="#b9c2cc" strokeOpacity=".3" strokeDasharray="2 4" />)}
                     <defs><linearGradient id="temperature-gradient" gradientUnits="userSpaceOnUse" x1="0" x2={chartWidth} y1="0" y2="0">{temperatureGradientStops.map((stop, index) => <stop key={`temperature-stop-${index}`} data-temperature={stop.value} offset={`${stop.offset * 100}%`} stopColor={stop.color} />)}</linearGradient><linearGradient id="temperature-fade" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="white" stopOpacity="1" /><stop offset="100%" stopColor="white" stopOpacity=".12" /></linearGradient><mask id="temperature-soft-fade"><rect width={chartWidth} height={FORECAST_BLOCK_HEIGHT} fill="url(#temperature-fade)" /></mask></defs>
                    {temperatureArea && <path data-series="temperature" d={temperatureArea} fill="url(#temperature-gradient)" fillOpacity=".62" mask="url(#temperature-soft-fade)" />}
                    {temperaturePath && <path data-series="temperature" d={temperaturePath} fill="none" stroke="url(#temperature-gradient)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
                </svg>
                 <div className="relative z-10 grid" style={{ height: ROW.icons, gridTemplateColumns: grid }}>
                    {data.points.map((point, index) => { const weatherDescription = `${point.hourLabel} Uhr · ${point.weatherCode === null ? "Wetterzustand nicht verfügbar" : `Wettercode ${point.weatherCode}`} · ${cloudTypeTooltip(point)}`; return <div key={`icon-${point.timestamp}-${index}`} data-weather-cloud-type={point.cloudType ?? "unknown"} className="flex items-center justify-center" role="img" aria-label={weatherDescription} title={weatherDescription}>{weatherIcon(point.weatherCode, point.cloudType)}</div>; })}
                </div>
                <div className="relative z-10 grid text-[17px] font-semibold text-slate-800 dark:text-slate-100" style={{ height: ROW.temperature, gridTemplateColumns: grid }}>
                {data.points.map((point, index) => <div key={`temp-${point.timestamp}-${index}`} className="flex items-center justify-center text-[22px] font-medium">{point.temperature !== null ? `${Math.round(point.temperature)}°` : "—"}</div>)}
                </div>
              </div>
               {hasDewPoint && <div data-testid="meteogram-dew-point-row" aria-label="Taupunkt" className="grid border-b border-slate-300/45 text-[16px] text-slate-500 dark:border-slate-700" style={{ height: ROW.dewPoint, gridTemplateColumns: grid }}>{data.points.map((point, index) => <div key={`dew-${point.timestamp}-${index}`} className="flex items-center justify-center">{point.dewPoint !== null ? `${Math.round(point.dewPoint)}°` : "—"}</div>)}</div>}
                <div className="relative border-b border-slate-300/55" style={{ height: CLOUD_CHART_HEIGHT }}>
              <svg data-testid="meteogram-cloud-field" viewBox={`0 0 ${chartWidth} ${CLOUD_CHART_HEIGHT}`} width={chartWidth} height={CLOUD_CHART_HEIGHT} className="pointer-events-none absolute inset-0 z-[1] block bg-transparent dark:border-slate-700" role="img" aria-label="Mehrschichtige Wolkenbedeckung nach Höhe">
                 <defs>
                   <pattern id="cloud-hatch" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M-2 10L4 4M3 15L15 3" stroke="#53616e" strokeOpacity=".12" strokeWidth="1" /></pattern>
                   <filter id="meteogram-cloud-soften" x="-30%" y="-35%" width="160%" height="170%"><feGaussianBlur stdDeviation="4.1" /></filter>
                    {data.bands.map((band, index) => <clipPath key={`cloud-clip-${band.key}`} id={`meteogram-cloud-band-${index}`}><rect x="0" y={index * layerHeight} width={chartWidth} height={layerHeight} /></clipPath>)}
                 </defs>
                  {data.bands.map((band, bandIndex) => { const path = cloudAreaPath(data.points, bandIndex, layerHeight); return path ? <g key={`cloud-area-${band.key}`} opacity=".9"><path d={path} fill="#6c7880" fillOpacity=".24" filter="url(#meteogram-cloud-soften)" /><path d={path} fill="#6c7880" fillOpacity=".17" stroke="#65727d" strokeOpacity=".15" strokeWidth="1" /></g> : null; })}
                 {data.bands.map((band, bandIndex) => <g key={band.key}><line x1="0" x2={chartWidth} y1={bandIndex * layerHeight} y2={bandIndex * layerHeight} stroke="#7c8791" strokeOpacity=".24" />{data.points.map((point, pointIndex) => {
                  const pct = point.cloudBands[bandIndex]?.pct;
                  if (pct === null || pct === undefined || pct <= 0) return null;
                    const typeScale = point.cloudType === "cumulonimbus" ? 1.2 : point.cloudType === "cirrus" ? .72 : point.cloudType === "stratus" ? 1.12 : 1;
                    const blobHeight = Math.max(5, Math.min(layerHeight * .82, layerHeight * (.28 + pct / 150) * typeScale));
                    const blobWidth = Math.max(22, Math.min(POINT_WIDTH * 1.72, POINT_WIDTH * (.64 + pct / 104) * typeScale));
                    const blobY = bandIndex * layerHeight + layerHeight - blobHeight * .55;
                     return <g key={`cloud-${band.key}-${point.timestamp}`} data-cloud-shape-band={band.key} clipPath={`url(#meteogram-cloud-band-${bandIndex})`}><ellipse cx={pointIndex * POINT_WIDTH + POINT_WIDTH / 2} cy={blobY} rx={blobWidth / 2} ry={blobHeight / 2} fill="#66737b" opacity={.18 + pct / 420} filter="url(#meteogram-cloud-soften)" /><ellipse cx={pointIndex * POINT_WIDTH + POINT_WIDTH / 2 - blobWidth * .12} cy={blobY - blobHeight * .08} rx={blobWidth * .34} ry={blobHeight * .38} fill="#78848b" opacity={.12 + pct / 500} />{pct > 35 && <rect x={pointIndex * POINT_WIDTH} y={bandIndex * layerHeight} width={POINT_WIDTH} height={layerHeight} fill="url(#cloud-hatch)" opacity=".26" />}</g>;
                })}</g>)}
                 {data.points.map((point, pointIndex) => <rect key={`cloud-column-${point.timestamp}`} x={pointIndex * POINT_WIDTH} y="0" width={POINT_WIDTH} height={CLOUD_CHART_HEIGHT} fill="transparent"><title>{`${cloudTypeLabel(point.cloudType)} (heuristisch aus Modelldaten, keine Beobachtung) · ${data.bands.map((band, bandIndex) => `${band.label}: ${point.cloudBands[bandIndex]?.pct == null ? "k. A." : `${Math.round(point.cloudBands[bandIndex].pct)}%`}`).join(" · ")}`}</title></rect>)}
               </svg>
               <svg data-testid="meteogram-pressure-rain-overlay" viewBox={`0 0 ${chartWidth} ${PRESSURE_RAIN_HEIGHT}`} width={chartWidth} height={PRESSURE_RAIN_HEIGHT} className="pointer-events-none absolute inset-0 z-[2] block bg-transparent dark:border-slate-700" role="img" aria-label="Luftdruck und Regen">
                 {[.25, .5, .75].map((fraction) => <line key={fraction} x1="0" x2={chartWidth} y1={fraction * PRESSURE_RAIN_HEIGHT} y2={fraction * PRESSURE_RAIN_HEIGHT} stroke="#94a3b8" strokeOpacity=".12" strokeDasharray="2 4" />)}
                   {data.points.map((point, index) => { const rainValue = point.rain ?? 0; const barHeight = Math.min(46, Math.max(rainValue > 0 ? 3 : 0, rainValue / maxRain * 46)); const barY = PRESSURE_RAIN_HEIGHT - 6 - barHeight; const rainLabel = rainValue >= 0.05 ? formatRainAmount(rainValue) : null; return <g key={`lower-${point.timestamp}`} data-rain-column={rainLabel ?? "0"}><line x1={index * POINT_WIDTH} x2={index * POINT_WIDTH} y1="0" y2={PRESSURE_RAIN_HEIGHT} stroke="#94a3b8" strokeOpacity=".035" />{rainLabel && <text data-rain-amount={rainLabel} x={index * POINT_WIDTH + POINT_WIDTH / 2} y={Math.max(12, barY - 6)} textAnchor="middle" fontSize="10" fontWeight="700" fill="#1765b4" stroke="#f6f7f8" strokeWidth="3" paintOrder="stroke">{rainLabel}</text>}<rect x={index * POINT_WIDTH + (POINT_WIDTH - 10) / 2} y={barY} width="10" height={barHeight} fill="#1469d2" opacity=".92"><title>{`${rainValue.toFixed(1)} mm Regen${point.precipProbability !== null ? ` · ${Math.round(point.precipProbability)}%` : ""}`}</title></rect></g>; })}
                  <path data-testid="meteogram-pressure-line" data-pressure-min={pressureRawMin} data-pressure-max={pressureRawMax} d={smoothPath(pressurePoints.map(([x, y]) => [x, y]))} fill="none" stroke="#587b90" strokeWidth="1.55" strokeLinecap="round" />
                  {pressurePoints.map(([x, y, pressure], index) => <g key={`pressure-${index}`}><circle cx={x} cy={y} r="1.1" fill="#f6f7f8" stroke="#587b90" strokeWidth=".8" />{index % 6 === 0 && <text data-pressure-label="true" x={x} y={Math.max(12, y - 6)} textAnchor="middle" fontSize="10" fontWeight="600" fill="#476779" stroke="#f6f7f8" strokeWidth="3" paintOrder="stroke">{Math.round(pressure)} hPa</text>}</g>)}
               </svg>
                 {rainGroups.map((group, index) => group.rainTotal >= 0.05 && <div key={`rain-total-${group.label}-${index}`} data-testid="meteogram-daily-rain" data-rain-total={group.rainTotal.toFixed(1)} data-rain-pill-placement="cloud-chart" title={`Tagessumme Niederschlag: ${formatRainAmount(group.rainTotal)}`} aria-label={`Tagessumme Niederschlag ${formatRainAmount(group.rainTotal)}`} className="pointer-events-auto absolute top-2 z-[3] -translate-x-full rounded-[5px] bg-[#0869d8] px-2.5 py-1 text-[11px] font-bold tracking-normal text-white shadow-[0_2px_5px_rgba(0,67,145,.24)]" style={{ left: (group.startIndex + group.count) * POINT_WIDTH - 18 }}>{formatRainAmount(group.rainTotal)}</div>)}
              </div>
                {hasCloudBase && <div data-testid="meteogram-cloud-base-row" aria-label="Geschätzte Wolkenuntergrenze" className="grid border-b border-slate-300/45 bg-[#dff2e4] text-[16px] font-medium text-slate-700 dark:bg-emerald-950/35 dark:text-slate-200" style={{ height: ROW.cloudBase, gridTemplateColumns: grid }}>{data.points.map((point, index) => <div key={`base-${point.timestamp}-${index}`} data-cloud-base-level={point.cloudBase === null ? "unavailable" : point.cloudBase < 300 ? "very-low" : point.cloudBase < 600 ? "low" : point.cloudBase < 1000 ? "caution" : point.cloudBase < 2000 ? "moderate" : point.cloudBase < 5000 ? "high" : "very-high"} className={`flex items-center justify-center ${point.cloudBase === null ? "" : cloudBaseTone(point.cloudBase)}`} title={point.cloudBase === null ? "Keine gültige Schätzung der Wolkenuntergrenze" : `Geschätzte Wolkenuntergrenze: ${Math.round(point.cloudBase)} m, aus Temperatur und Taupunkt abgeleitet; keine Beobachtung`}>{point.cloudBase !== null ? formatCloudBase(point.cloudBase) : "—"}</div>)}</div>}
             </div>
               <div data-testid="meteogram-current-column" role="img" aria-label={`Aktueller Prognosezeitpunkt: ${data.points[currentPointIndex].dayLabel} ${data.points[currentPointIndex].hourLabel}:00 Uhr`} className="pointer-events-none absolute z-20 rounded-[5px] border-2 border-transparent bg-transparent" style={{ left: currentPointIndex * POINT_WIDTH, top: ROW.day, bottom: 0, width: POINT_WIDTH }}>
                <span className="absolute -top-4 left-1/2 -translate-x-1/2 rounded bg-[#58716d] px-1.5 py-0.5 text-[8px] font-bold tracking-wide text-[#f5f7f4]">JETZT</span>
                 <span aria-hidden="true" className="absolute inset-y-0 left-1/2 border-l border-dashed border-slate-600/55 dark:border-slate-300/55" />
              </div>
          </div>
        </div>
      </div>
      <footer className="flex flex-col gap-2 border-t border-[#c7d2d3] bg-[#eef3ef] px-4 py-2.5 text-[10px] leading-4 text-[#71817e] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 sm:px-6 md:flex-row md:items-center md:justify-between">
        <span><strong className="text-[#526b68] dark:text-slate-200">Hinweis:</strong> Wolkentypen und Wolkenhöhen sind modellbasierte Heuristiken, keine Beobachtungen.</span>
        <span className="flex items-center gap-2 whitespace-nowrap">Quelle: {data.sourceUrl ? <a href={data.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">Open-Meteo</a> : "Open-Meteo"}</span>
      </footer>
    </section>
  );
}

export default CityMeteogram;