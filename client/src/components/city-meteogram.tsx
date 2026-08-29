import { Cloud, CloudLightning, CloudRain, CloudSun, Droplets, Sun } from "lucide-react";
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
  isDay: boolean | null;
  cloudBands: Array<{ label: string; pct: number | null; sourceLevels: number[] }>;
};
type CloudBand = { label: string; minHeightM: number; maxHeightM: number };
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

const DAY_NAMES = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const POINT_WIDTH = 24;
const ROW = {
  day: 16,
  hours: 14,
  icons: 22,
  temperature: 14,
  temperatureArea: 34,
  dewPoint: 14,
  cloudBand: 9,
  lower: 36,
} as const;
const CLOUD_CHART_HEIGHT = ROW.cloudBand * 7;
const LOWER_CHART_HEIGHT = ROW.lower;
const FORECAST_BLOCK_HEIGHT = ROW.icons + ROW.temperature;
const WINDY_CLOUD_BANDS: CloudBand[] = [
  { label: "FL300", minHeightM: 8000, maxHeightM: 13000 },
  { label: "FL200", minHeightM: 5500, maxHeightM: 8000 },
  { label: "FL150", minHeightM: 4500, maxHeightM: 5500 },
  { label: "FL130", minHeightM: 3500, maxHeightM: 4500 },
  { label: "FL100", minHeightM: 2500, maxHeightM: 3500 },
  { label: "FL065", minHeightM: 1500, maxHeightM: 2500 },
  { label: "AGL", minHeightM: 0, maxHeightM: 1500 },
];

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}
function asArray(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function asNumber(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function asString(value: unknown): string | null { return typeof value === "string" && value.length > 0 ? value : null; }
function isArray(value: unknown): value is unknown[] { return Array.isArray(value); }
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
function parseLocalTimestamp(timestamp: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})/.exec(timestamp);
  if (!match) return null;
  const [, year, month, day, hour] = match;
  const date = new Date(`${year}-${month}-${day}T12:00:00Z`);
  return { dateKey: `${year}-${month}-${day}`, dayLabel: `${DAY_NAMES[date.getUTCDay()]} ${day}.${month}.`, hourLabel: `${hour}:00` };
}
function weatherIcon(code: number | null) {
  if (code === null || code <= 1) return <Sun className="h-[13px] w-[13px] text-amber-500" aria-hidden="true" />;
  if (code <= 3) return <CloudSun className="h-[13px] w-[13px] text-amber-500" aria-hidden="true" />;
  if (code <= 48) return <Cloud className="h-[13px] w-[13px] text-slate-500" aria-hidden="true" />;
  if (code >= 95) return <CloudLightning className="h-[13px] w-[13px] text-violet-500" aria-hidden="true" />;
  if (code >= 51) return <CloudRain className="h-[13px] w-[13px] text-sky-500" aria-hidden="true" />;
  return <Cloud className="h-[13px] w-[13px] text-slate-500" aria-hidden="true" />;
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
  const days = asArray(hourly?.isDay);
  const rawLevels = asArray(hourly?.cloudCoverLevels).map(asRecord)
    .filter((level): level is JsonRecord => Boolean(level))
    .flatMap((level) => {
      const hpa = asNumber(level.hpa);
      return hpa !== null && hpa > 0 && isArray(level.heightM) && isArray(level.pct)
        ? [{ hpa, heights: level.heightM, percentages: level.pct }] : [];
    });
  const points = entries.map(({ timestamp, index, local }) => {
    const seen = new Map<number, { hpa: number; heightM: number; pct: number }>();
    rawLevels.forEach((level) => {
      const heightM = asNumber(level.heights[index]);
      const pct = asNumber(level.percentages[index]);
      if (heightM !== null && pct !== null && heightM >= 0 && pct >= 0 && pct <= 100 && !seen.has(level.hpa)) {
        seen.set(level.hpa, { hpa: level.hpa, heightM, pct });
      }
    });
    const cloudBands = WINDY_CLOUD_BANDS.map((band) => {
      const values = Array.from(seen.values()).filter((value) => value.heightM >= band.minHeightM && value.heightM < band.maxHeightM);
      return {
        label: band.label,
        pct: values.length ? values.reduce((sum, value) => sum + value.pct, 0) / values.length : null,
        sourceLevels: values.map((value) => value.hpa),
      };
    });
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
    bands: WINDY_CLOUD_BANDS,
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
function cloudBaseY(heightM: number, chartHeight: number): number {
  const clamped = Math.min(12999.999, Math.max(0, heightM));
  const layerHeight = chartHeight / WINDY_CLOUD_BANDS.length;
  const bandIndex = WINDY_CLOUD_BANDS.findIndex((band) => clamped >= band.minHeightM && clamped < band.maxHeightM);
  if (bandIndex < 0) return chartHeight;
  const band = WINDY_CLOUD_BANDS[bandIndex];
  return bandIndex * layerHeight + ((band.maxHeightM - clamped) / (band.maxHeightM - band.minHeightM)) * layerHeight;
}

function DayHeaders({ points }: { points: MeteogramPoint[] }) {
  const groups: Array<{ label: string; count: number }> = [];
  points.forEach((point) => {
    const last = groups[groups.length - 1];
    if (last?.label === point.dayLabel) last.count += 1;
    else groups.push({ label: point.dayLabel, count: 1 });
  });
  return (
    <div className="grid border-b border-slate-300/55 bg-slate-900/[.025] text-[9px] font-semibold tracking-wide text-slate-600 dark:border-slate-700/50 dark:bg-white/[.025] dark:text-slate-300" style={{ height: ROW.day, gridTemplateColumns: `repeat(${points.length}, ${POINT_WIDTH}px)` }}>
      {groups.map((group, index) => <div key={`${group.label}-${index}`} className="flex items-center justify-center border-r border-slate-300/35 dark:border-slate-700/40" style={{ gridColumn: `span ${group.count}` }}>{group.label}</div>)}
    </div>
  );
}

function CityMeteogram({ analysisJson, cityName, isLoading }: CityMeteogramProps) {
  const data = extractCityMeteogram(analysisJson);
  if (!data) {
    return <div className="border border-slate-300/70 bg-slate-100/70 px-3 py-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300" data-testid="city-meteogram" data-meteogram-status={isLoading ? "loading" : "unavailable"}>{isLoading ? "Meteogramm wird vorbereitet …" : "Meteogramm für die Stadtdaten nicht verfügbar."}</div>;
  }
  const chartWidth = data.points.length * POINT_WIDTH;
  const pressureValues = data.points.map((point) => point.pressure).filter((value): value is number => value !== null);
  const pressureMin = pressureValues.length ? Math.floor(Math.min(...pressureValues) - 2) : 980;
  const pressureMax = pressureValues.length ? Math.ceil(Math.max(...pressureValues) + 2) : 1030;
  const maxRain = Math.max(1, ...data.points.map((point) => point.rain ?? 0));
  const layerHeight = CLOUD_CHART_HEIGHT / data.bands.length;
  const hasDewPoint = data.points.some((point) => point.dewPoint !== null);
  const dayCount = new Set(data.points.map((point) => point.dateKey)).size;
  const temperatureValues = data.points.map((point) => point.temperature).filter((value): value is number => value !== null);
  const temperatureMin = temperatureValues.length ? Math.floor(Math.min(...temperatureValues) - 2) : 0;
  const temperatureMax = temperatureValues.length ? Math.ceil(Math.max(...temperatureValues) + 2) : 30;
  const temperatureY = (value: number) => 5 + (1 - (value - temperatureMin) / Math.max(1, temperatureMax - temperatureMin)) * (FORECAST_BLOCK_HEIGHT - 10);
  const tempPoints = data.points.flatMap((point, index) => point.temperature === null ? [] : [[index * POINT_WIDTH + POINT_WIDTH / 2, temperatureY(point.temperature)] as [number, number]]);
  const temperaturePath = smoothPath(tempPoints);
  const temperatureArea = tempPoints.length
    ? `${smoothPath([[0, tempPoints[0][1]], ...tempPoints, [chartWidth, tempPoints[tempPoints.length - 1][1]]])} L ${chartWidth} ${FORECAST_BLOCK_HEIGHT} L 0 ${FORECAST_BLOCK_HEIGHT} Z`
    : "";
  const pressurePoints = data.points.flatMap((point, index) => point.pressure === null ? [] : [[index * POINT_WIDTH + POINT_WIDTH / 2, LOWER_CHART_HEIGHT - 12 - ((point.pressure - pressureMin) / Math.max(1, pressureMax - pressureMin)) * 42, point.pressure] as [number, number, number]]);
  const cityLabel = cityName || data.cityName;
  const grid = `repeat(${data.points.length}, ${POINT_WIDTH}px)`;

  return (
    <div className="meteogram-shell relative left-0 w-full translate-x-0 overflow-hidden border border-slate-300/75 bg-[#fafbfc] dark:border-slate-700 dark:bg-slate-950 md:left-1/2 md:w-[min(960px,calc(100vw-48px))] md:-translate-x-1/2" data-testid="city-meteogram" data-meteogram-status="ready" data-city-name={data.cityName} data-city-lat={data.latitude ?? ""} data-city-lon={data.longitude ?? ""} data-timezone={data.timezone}>
      <div className="flex h-[27px] items-center justify-between gap-3 border-b border-slate-300/70 bg-[#f3f5f6] px-2.5 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex min-w-0 items-baseline gap-2">
          <div className="truncate text-[12px] font-semibold tracking-tight text-slate-800 dark:text-slate-100">{cityLabel}</div>
          <div className="truncate text-[8px] text-slate-500 dark:text-slate-400">{data.timezone} · {dayCount} Tage · {data.points.length} Punkte · 7 Ebenen</div>
        </div>
      </div>
      <div className="flex min-w-0">
        <div className="w-[64px] shrink-0 border-r border-slate-300/75 bg-[#f3f5f6] text-[8px] leading-[9px] text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
          <div style={{ height: ROW.day }} className="border-b border-slate-300/60 dark:border-slate-700" />
          <div style={{ height: ROW.hours }} className="flex items-center px-1.5 font-semibold">Zeit</div>
          <div style={{ height: ROW.icons }} className="flex items-center px-1.5">Wetter</div>
          <div style={{ height: ROW.temperature }} className="flex items-center px-1.5 text-[#bd5b2d]">Temp.</div>
          {hasDewPoint && <div style={{ height: ROW.dewPoint }} className="flex items-center px-1.5">Taupunkt</div>}
          <div style={{ height: CLOUD_CHART_HEIGHT }} className="flex flex-col">
            {data.bands.map((band) => <div key={band.label} className="flex min-h-0 flex-1 items-center border-b border-slate-300/45 px-1.5 font-medium dark:border-slate-700/60">{band.label}</div>)}
          </div>
          <div style={{ height: LOWER_CHART_HEIGHT }} className="flex items-center px-1.5">Druck<br />Regen</div>
        </div>
        <div className="meteogram-scroller min-w-0 flex-1 overflow-x-auto" data-testid="city-meteogram-scroll">
          <div className="relative" style={{ minWidth: chartWidth }}>
            <div className="pointer-events-none absolute inset-0 z-0 flex">
              {data.points.map((point, index) => point.isDay === false
                ? <div key={`night-${point.timestamp}`} data-chart-night-column="true" data-night-shading="true" data-night-index={index} className="h-full shrink-0 border-x border-slate-300/25 bg-[#ececf6] dark:border-slate-700/25 dark:bg-[#2b2a3b]" style={{ width: POINT_WIDTH }}><title>Nacht</title></div>
                : <div key={`day-${point.timestamp}`} className="h-full shrink-0" style={{ width: POINT_WIDTH }} />)}
            </div>
            <div className="relative z-10">
              <DayHeaders points={data.points} />
              <div className="grid border-b border-slate-300/50 text-[9px] text-slate-500 dark:border-slate-700/50 dark:text-slate-400" style={{ height: ROW.hours, gridTemplateColumns: grid }}>{data.points.map((point, index) => <div key={`hour-${point.timestamp}-${index}`} className="flex items-center justify-center border-r border-slate-300/30">{point.hourLabel}</div>)}</div>
              <div className="relative border-b border-slate-300/50 dark:border-slate-700/50" style={{ height: FORECAST_BLOCK_HEIGHT }}>
                <svg data-testid="meteogram-temperature-area" data-temperature-layer="behind-forecast-rows" viewBox={`0 0 ${chartWidth} ${FORECAST_BLOCK_HEIGHT}`} width={chartWidth} height={FORECAST_BLOCK_HEIGHT} className="pointer-events-none absolute inset-0 z-0 block" role="img" aria-label="Temperaturverlauf">
                  {[12, 24].map((y) => <line key={y} x1="0" x2={chartWidth} y1={y} y2={y} stroke="#b9c2cc" strokeOpacity=".3" strokeDasharray="2 4" />)}
                  {temperatureArea && <path data-series="temperature" d={temperatureArea} fill="#df7045" fillOpacity=".18" />}
                  {temperaturePath && <path data-series="temperature" d={temperaturePath} fill="none" stroke="#df7045" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />}
                </svg>
                <div className="relative z-10 grid" style={{ height: ROW.icons, gridTemplateColumns: grid }}>
                  {data.points.map((point, index) => <div key={`icon-${point.timestamp}-${index}`} className="flex items-center justify-center border-r border-slate-300/30" title={point.weatherCode === null ? "Wetterzustand nicht verfügbar" : `Wettercode ${point.weatherCode}`}>{weatherIcon(point.weatherCode)}</div>)}
                </div>
                <div className="relative z-10 grid text-[10px] font-semibold text-[#bd5b2d]" style={{ height: ROW.temperature, gridTemplateColumns: grid }}>
                  {data.points.map((point, index) => <div key={`temp-${point.timestamp}-${index}`} className="flex items-center justify-center border-r border-slate-300/30">{point.temperature !== null ? `${Math.round(point.temperature)}°` : "—"}</div>)}
                </div>
              </div>
              {hasDewPoint && <div data-testid="meteogram-dew-point-row" aria-label="Taupunkt" className="grid border-b border-slate-300/60 text-[10px] text-slate-500 dark:border-slate-700" style={{ height: ROW.dewPoint, gridTemplateColumns: grid }}>{data.points.map((point, index) => <div key={`dew-${point.timestamp}-${index}`} className="flex items-center justify-center border-r border-slate-300/30">{point.dewPoint !== null ? `${Math.round(point.dewPoint)}°` : "—"}</div>)}</div>}
              <svg data-testid="meteogram-cloud-field" viewBox={`0 0 ${chartWidth} ${CLOUD_CHART_HEIGHT}`} width={chartWidth} height={CLOUD_CHART_HEIGHT} className="block border-b border-slate-300/65 bg-transparent dark:border-slate-700" role="img" aria-label="Mehrschichtige Wolkenbedeckung nach Höhe">
                <defs><pattern id="cloud-hatch" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M-2 10L4 4M3 15L15 3" stroke="#53616e" strokeOpacity=".12" strokeWidth="1" /></pattern></defs>
                {data.bands.map((band, bandIndex) => <path key={`cloud-area-${band.label}`} d={cloudAreaPath(data.points, bandIndex, layerHeight)} fill="#64717c" fillOpacity=".17" stroke="#65727d" strokeOpacity=".12" strokeWidth="1" />)}
                {data.bands.map((band, bandIndex) => <g key={band.label}><line x1="0" x2={chartWidth} y1={bandIndex * layerHeight} y2={bandIndex * layerHeight} stroke="#7c8791" strokeOpacity=".24" />{data.points.map((point, pointIndex) => {
                  const pct = point.cloudBands[bandIndex]?.pct;
                  if (pct === null || pct === undefined || pct <= 0) return null;
                  return <g key={`cloud-${band.label}-${point.timestamp}`} data-cloud-shape-band={band.label}>{pct > 65 && <rect x={pointIndex * POINT_WIDTH} y={bandIndex * layerHeight} width={POINT_WIDTH} height={layerHeight} fill="url(#cloud-hatch)" opacity=".4" />}</g>;
                })}</g>)}
                {data.points.map((point, pointIndex) => <rect key={`cloud-column-${point.timestamp}`} x={pointIndex * POINT_WIDTH} y="0" width={POINT_WIDTH} height={CLOUD_CHART_HEIGHT} fill="transparent"><title>{`${cloudTypeLabel(point.cloudType)} (heuristisch aus Modelldaten) · ${data.bands.map((band, bandIndex) => `${band.label}: ${point.cloudBands[bandIndex]?.pct == null ? "k. A." : `${Math.round(point.cloudBands[bandIndex].pct)}%`} · Quellen: ${point.cloudBands[bandIndex]?.sourceLevels.length ? `${point.cloudBands[bandIndex].sourceLevels.join(", ")} hPa` : "keine"}`).join(" · ")}`}</title></rect>)}
                <path data-testid="meteogram-lcl-line" d={smoothPath(data.points.flatMap((point, index) => point.cloudBase === null ? [] : [[index * POINT_WIDTH + POINT_WIDTH / 2, cloudBaseY(point.cloudBase, CLOUD_CHART_HEIGHT)] as [number, number]]))} fill="none" stroke="#8b9299" strokeWidth="1" strokeDasharray="3 3" strokeLinecap="round" />
                {data.points.map((point, index) => point.cloudBase === null ? null : <circle key={`lcl-${point.timestamp}`} cx={index * POINT_WIDTH + POINT_WIDTH / 2} cy={cloudBaseY(point.cloudBase, CLOUD_CHART_HEIGHT)} r="1.5" fill="#fafbfc" stroke="#8b9299" strokeWidth=".8"><title>{`geschätzte Wolkenuntergrenze (LCL): ${Math.round(point.cloudBase)} m, aus Temperatur und Taupunkt abgeleitet; keine Beobachtung`}</title></circle>)}
              </svg>
              <svg data-testid="meteogram-pressure-rain-overlay" viewBox={`0 0 ${chartWidth} ${LOWER_CHART_HEIGHT}`} width={chartWidth} height={LOWER_CHART_HEIGHT} className="block border-b border-slate-300/65 bg-transparent dark:border-slate-700" role="img" aria-label="Luftdruck und Regen">
                {[.25, .5, .75].map((fraction) => <line key={fraction} x1="0" x2={chartWidth} y1={fraction * LOWER_CHART_HEIGHT} y2={fraction * LOWER_CHART_HEIGHT} stroke="#94a3b8" strokeOpacity=".16" strokeDasharray="2 4" />)}
                {data.points.map((point, index) => { const rainValue = point.rain ?? 0; const barHeight = Math.min(20, Math.max(rainValue > 0 ? 2 : 0, rainValue / maxRain * 20)); return <g key={`lower-${point.timestamp}`}><line x1={index * POINT_WIDTH} x2={index * POINT_WIDTH} y1="0" y2={LOWER_CHART_HEIGHT} stroke="#94a3b8" strokeOpacity=".08" /><rect x={index * POINT_WIDTH + 9} y={LOWER_CHART_HEIGHT - 5 - barHeight} width="9" height={barHeight} fill="#6f79bb" opacity=".66"><title>{`${rainValue.toFixed(1)} mm Regen${point.precipProbability !== null ? ` · ${Math.round(point.precipProbability)}%` : ""}`}</title></rect></g>; })}
                <path d={smoothPath(pressurePoints.map(([x, y]) => [x, y]))} fill="none" stroke="#7b858d" strokeWidth="1.1" strokeLinecap="round" />
                {pressurePoints.map(([x, y, pressure], index) => <g key={`pressure-${index}`}><circle cx={x} cy={y} r="1.2" fill="#fafbfc" stroke="#7b858d" strokeWidth=".8" /><text x={x} y={Math.max(8, y - 3)} textAnchor="middle" fontSize="6" fill="#7b858d">{Math.round(pressure)}</text></g>)}
              </svg>
            </div>
          </div>
        </div>
      </div>
      <div className="flex h-[19px] items-center gap-3 border-t border-slate-300/60 px-2.5 text-[8px] text-slate-500 dark:border-slate-700/70 dark:text-slate-400">
        <span className="inline-flex items-center gap-1"><span className="h-2 w-4 bg-slate-500/45" /> Wolken</span>
        <span className="inline-flex items-center gap-1"><span className="h-0.5 w-3 bg-slate-500" /> Druck</span>
        <span className="inline-flex items-center gap-1"><Droplets className="h-3 w-3 text-[#5967ae]" /> Regen</span>
        {data.sourceUrl && <a href={data.sourceUrl} target="_blank" rel="noopener noreferrer" className="ml-auto font-semibold text-slate-600 underline-offset-2 hover:text-[#d55f32] hover:underline dark:text-slate-300" data-testid="meteogram-source-link">Open-Meteo ↗</a>}
      </div>
    </div>
  );
}

export default CityMeteogram;