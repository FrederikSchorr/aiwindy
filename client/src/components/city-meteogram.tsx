import { Cloud, CloudLightning, CloudRain, CloudSun, Droplets, Sun } from "lucide-react";
import React from "react";

type JsonRecord = Record<string, unknown>;
type CloudType = "clear" | "cirrus" | "altostratus" | "stratus" | "cumulus" | "cumulonimbus" | "mixed";
type MeteogramPoint = {
  timestamp: string; dateKey: string; dayLabel: string; hourLabel: string;
  temperature: number | null; dewPoint: number | null; pressure: number | null;
  rain: number | null; precipProbability: number | null; weatherCode: number | null;
  cloudBase: number | null; cloudType: CloudType | null; isDay: boolean | null;
  cloudBands: Array<{ label: string; pct: number | null; sourceLevels: number[] }>;
};
type CloudBand = { label: string; minHeightM: number; maxHeightM: number };
type CityMeteogramData = {
  cityName: string; latitude: number | null; longitude: number | null; timezone: string;
  sourceUrl: string | null; points: MeteogramPoint[]; bands: CloudBand[];
};
type CityMeteogramProps = { analysisJson: Record<string, unknown> | null; cityName?: string; isLoading?: boolean };

const DAY_NAMES = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const POINT_WIDTH = 44;
const CLOUD_CHART_HEIGHT = 238;
const LOWER_CHART_HEIGHT = 92;
const WINDY_CLOUD_BANDS: CloudBand[] = [
  { label: "FL300", minHeightM: 8000, maxHeightM: 13000 }, { label: "FL200", minHeightM: 5500, maxHeightM: 8000 },
  { label: "FL150", minHeightM: 4500, maxHeightM: 5500 }, { label: "FL130", minHeightM: 3500, maxHeightM: 4500 },
  { label: "FL100", minHeightM: 2500, maxHeightM: 3500 }, { label: "FL065", minHeightM: 1500, maxHeightM: 2500 },
  { label: "AGL", minHeightM: 0, maxHeightM: 1500 },
];

function asRecord(value: unknown): JsonRecord | null { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null; }
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
  return ({
    clear: "klarer Himmel",
    cirrus: "Cirrus",
    altostratus: "Altostratus",
    stratus: "Stratus",
    cumulus: "Cumulus",
    cumulonimbus: "Cumulonimbus",
    mixed: "gemischte Bewölkung",
  } as Record<CloudType, string>)[type ?? "mixed"];
}
function parseLocalTimestamp(timestamp: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})/.exec(timestamp);
  if (!match) return null;
  const [, year, month, day, hour] = match;
  const date = new Date(`${year}-${month}-${day}T12:00:00Z`);
  return { dateKey: `${year}-${month}-${day}`, dayLabel: `${DAY_NAMES[date.getUTCDay()]} ${day}.${month}.`, hourLabel: `${hour}:00` };
}
function weatherIcon(code: number | null) {
  if (code === null || code <= 1) return <Sun className="h-4 w-4 text-amber-500" aria-hidden="true" />;
  if (code <= 3) return <CloudSun className="h-4 w-4 text-amber-500" aria-hidden="true" />;
  if (code <= 48) return <Cloud className="h-4 w-4 text-slate-500" aria-hidden="true" />;
  if (code >= 95) return <CloudLightning className="h-4 w-4 text-violet-500" aria-hidden="true" />;
  if (code >= 51) return <CloudRain className="h-4 w-4 text-sky-500" aria-hidden="true" />;
  return <Cloud className="h-4 w-4 text-slate-500" aria-hidden="true" />;
}
function smoothPath(points: Array<[number, number]>) {
  if (!points.length) return "";
  return points.reduce((path, [x, y], index) => {
    if (!index) return `M ${x} ${y}`;
    const [px, py] = points[index - 1]; const cx = (px + x) / 2;
    return `${path} C ${cx} ${py}, ${cx} ${y}, ${x} ${y}`;
  }, "");
}
function cloudShape(type: CloudType | null, x: number, y: number, width: number, height: number, opacity: number) {
  const safeType = type ?? "mixed";
  const seed = Math.max(0.12, opacity);
  if (safeType === "clear") return null;
  if (safeType === "cirrus") return <path d={`M ${x} ${y + height * .68} Q ${x + width * .28} ${y + height * .1} ${x + width * .55} ${y + height * .48} T ${x + width} ${y + height * .34}`} fill="none" stroke="#d9edf0" strokeOpacity={seed} strokeWidth={Math.max(2, height * .18)} />;
  if (safeType === "cumulonimbus") return <path d={`M ${x} ${y + height} Q ${x + width * .18} ${y + height * .32} ${x + width * .38} ${y + height * .55} Q ${x + width * .52} ${y - height * .1} ${x + width * .7} ${y + height * .48} Q ${x + width * .88} ${y + height * .22} ${x + width} ${y + height * .72} L ${x + width} ${y + height} Z`} fill="#526779" fillOpacity={seed * .76} />;
  const isLayered = safeType === "stratus" || safeType === "altostratus";
  return <path d={isLayered
    ? `M ${x} ${y + height * .45} Q ${x + width * .28} ${y + height * .25} ${x + width * .55} ${y + height * .45} T ${x + width} ${y + height * .4} L ${x + width} ${y + height} L ${x} ${y + height} Z`
    : `M ${x} ${y + height} Q ${x + width * .12} ${y + height * .4} ${x + width * .3} ${y + height * .62} Q ${x + width * .45} ${y + height * .05} ${x + width * .62} ${y + height * .55} Q ${x + width * .78} ${y + height * .22} ${x + width} ${y + height * .7} L ${x + width} ${y + height} Z`}
    fill={safeType === "cumulus" ? "#a9c5ce" : "#7d96a2"} fillOpacity={seed * (safeType === "mixed" ? .54 : .72)} />;
}

export function extractCityMeteogram(analysisJson: Record<string, unknown> | null): CityMeteogramData | null {
  const weatherRaw = asRecord(analysisJson?.weatherRaw); const forecast = asRecord(weatherRaw?.openMeteoForecast);
  const city = asRecord(forecast?.city); if (!forecast || !city) return null;
  const hourly = asRecord(city.hourly);
  const entries = asArray(hourly?.timestamps).flatMap((value, index) => {
    const timestamp = asString(value); const local = timestamp ? parseLocalTimestamp(timestamp) : null;
    return timestamp && local ? [{ timestamp, index, local }] : [];
  });
  if (!entries.length) return null;
  const temperatures = asArray(hourly?.temp2mC), dewPoints = asArray(hourly?.dewPoint2mC), pressures = asArray(hourly?.pressureMslHPa);
  const rain = asArray(hourly?.rainMm), precip = asArray(hourly?.precipProbabilityPct), codes = asArray(hourly?.weatherCode);
  const bases = asArray(hourly?.cloudBaseM), types = asArray(hourly?.cloudType), days = asArray(hourly?.isDay);
  const rawLevels = asArray(hourly?.cloudCoverLevels).map(asRecord).filter((level): level is JsonRecord => Boolean(level)).flatMap(level => {
    const hpa = asNumber(level.hpa); return hpa !== null && hpa > 0 && isArray(level.heightM) && isArray(level.pct)
      ? [{ hpa, heights: level.heightM, percentages: level.pct }] : [];
  });
  const points = entries.map(({ timestamp, index, local }) => {
    const seen = new Map<number, { hpa: number; heightM: number; pct: number }>();
    rawLevels.forEach(level => {
      const heightM = asNumber(level.heights[index]); const pct = asNumber(level.percentages[index]);
      if (heightM !== null && pct !== null && heightM >= 0 && pct >= 0 && pct <= 100 && !seen.has(level.hpa)) seen.set(level.hpa, { hpa: level.hpa, heightM, pct });
    });
    const cloudBands = WINDY_CLOUD_BANDS.map(band => {
      const values = Array.from(seen.values()).filter(value => value.heightM >= band.minHeightM && value.heightM < band.maxHeightM);
      return { label: band.label, pct: values.length ? values.reduce((sum, value) => sum + value.pct, 0) / values.length : null, sourceLevels: values.map(value => value.hpa) };
    });
    return { timestamp, ...local, temperature: asNumber(temperatures[index]), dewPoint: asNumber(dewPoints[index]), pressure: asNumber(pressures[index]), rain: asNumber(rain[index]), precipProbability: asNumber(precip[index]), weatherCode: asNumber(codes[index]), cloudBase: asNumber(bases[index]), cloudType: asCloudType(types[index]), isDay: asIsDay(days[index]), cloudBands };
  });
  const coordinates = asRecord(city.coordinates);
  return { cityName: asString(city.name) ?? "Stadt", latitude: asNumber(coordinates?.lat), longitude: asNumber(coordinates?.lon), timezone: asString(forecast.timezone) ?? "Ortszeit", sourceUrl: asString(city.url), points, bands: WINDY_CLOUD_BANDS };
}

function cloudAreaPath(
  points: MeteogramPoint[],
  bandIndex: number,
  bandHeight: number,
): string {
  const top = bandIndex * bandHeight;
  const segments: Array<Array<[number, number]>> = [];
  let activeSegment: Array<[number, number]> = [];
  points.forEach((point, index) => {
    const pct = point.cloudBands[bandIndex]?.pct;
    if (pct === null || pct === undefined || pct <= 0) {
      if (activeSegment.length) segments.push(activeSegment);
      activeSegment = [];
      return;
    }
    const x = index * POINT_WIDTH + POINT_WIDTH / 2;
    activeSegment.push([
      x,
      top + bandHeight - Math.max(3, (pct / 100) * bandHeight * 0.84),
    ]);
  });
  if (activeSegment.length) segments.push(activeSegment);

  const chartWidth = points.length * POINT_WIDTH;
  return segments.map((samples) => {
    const left = Math.max(0, samples[0][0] - POINT_WIDTH / 2);
    const right = Math.min(chartWidth, samples[samples.length - 1][0] + POINT_WIDTH / 2);
    const topSamples: Array<[number, number]> = [
      [left, samples[0][1]],
      ...samples,
      [right, samples[samples.length - 1][1]],
    ];
    return `${smoothPath(topSamples)} L ${right} ${top + bandHeight} L ${left} ${top + bandHeight} Z`;
  }).join(" ");
}

function cloudBaseY(heightM: number, chartHeight: number): number {
  const clampedHeight = Math.min(12999.999, Math.max(0, heightM));
  const layerHeight = chartHeight / WINDY_CLOUD_BANDS.length;
  const bandIndex = WINDY_CLOUD_BANDS.findIndex((band) =>
    clampedHeight >= band.minHeightM && clampedHeight < band.maxHeightM,
  );
  if (bandIndex < 0) return chartHeight;
  const band = WINDY_CLOUD_BANDS[bandIndex];
  const positionWithinBand = (band.maxHeightM - clampedHeight)
    / (band.maxHeightM - band.minHeightM);
  return bandIndex * layerHeight + positionWithinBand * layerHeight;
}

function DayHeaders({ points }: { points: MeteogramPoint[] }) {
  const groups: Array<{ label: string; count: number }> = [];
  points.forEach(point => { const last = groups[groups.length - 1]; if (last?.label === point.dayLabel) last.count += 1; else groups.push({ label: point.dayLabel, count: 1 }); });
  return <div className="grid h-8 border-b border-slate-300/50 bg-slate-900/[.04] text-[10px] font-bold uppercase tracking-[.12em] text-slate-600 dark:border-slate-700/60 dark:bg-white/[.04] dark:text-slate-300" style={{ gridTemplateColumns: `repeat(${points.length}, ${POINT_WIDTH}px)` }}>
    {groups.map((group, index) => <div key={`${group.label}-${index}`} className="flex items-center justify-center border-r border-slate-300/40 dark:border-slate-700/50" style={{ gridColumn: `span ${group.count}` }}>{group.label}</div>)}
  </div>;
}

function CityMeteogram({ analysisJson, cityName, isLoading }: CityMeteogramProps) {
  const data = extractCityMeteogram(analysisJson);
  if (!data) return <div className="rounded-xl border border-slate-300/70 bg-slate-100/70 px-4 py-5 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300" data-testid="city-meteogram" data-meteogram-status={isLoading ? "loading" : "unavailable"}>{isLoading ? "Meteogramm wird mit den Stadtdaten vorbereitet …" : "Meteogramm für die Stadtdaten nicht verfügbar."}</div>;
  const chartWidth = data.points.length * POINT_WIDTH;
  const pressureValues = data.points.map(p => p.pressure).filter((v): v is number => v !== null);
  const pressureMin = pressureValues.length ? Math.floor(Math.min(...pressureValues) - 2) : 980;
  const pressureMax = pressureValues.length ? Math.ceil(Math.max(...pressureValues) + 2) : 1030;
  const maxRain = Math.max(1, ...data.points.map(p => p.rain ?? 0));
  const layerHeight = CLOUD_CHART_HEIGHT / data.bands.length;
  const hasDewPoint = data.points.some(p => p.dewPoint !== null);
  const temperatureValues = data.points.flatMap(p => [p.temperature, p.dewPoint]
    .filter((value): value is number => value !== null));
  const temperatureMin = temperatureValues.length
    ? Math.floor(Math.min(...temperatureValues) - 2)
    : 0;
  const temperatureMax = temperatureValues.length
    ? Math.ceil(Math.max(...temperatureValues) + 2)
    : 30;
  const temperatureY = (value: number) => 18 + (1
    - (value - temperatureMin) / Math.max(1, temperatureMax - temperatureMin)) * 50;
  const tempPoints = data.points.flatMap((p, i) => p.temperature === null
    ? []
    : [[i * POINT_WIDTH + POINT_WIDTH / 2, temperatureY(p.temperature)] as [number, number]]);
  const dewPoints = data.points.flatMap((p, i) => p.dewPoint === null
    ? []
    : [[i * POINT_WIDTH + POINT_WIDTH / 2, temperatureY(p.dewPoint)] as [number, number]]);
  const pressurePoints = data.points.flatMap((p, i) => p.pressure === null ? [] : [[i * POINT_WIDTH + POINT_WIDTH / 2, LOWER_CHART_HEIGHT - 16 - ((p.pressure - pressureMin) / Math.max(1, pressureMax - pressureMin)) * 47, p.pressure] as [number, number, number]]);
  const cityLabel = cityName || data.cityName;
  return <div className="meteogram-shell overflow-hidden rounded-xl border border-slate-300/70 bg-[#edf4f2] shadow-[0_14px_40px_-24px_rgba(21,63,72,.45)] dark:border-slate-700/80 dark:bg-[#101d22]" data-testid="city-meteogram" data-meteogram-status="ready" data-city-name={data.cityName} data-city-lat={data.latitude ?? ""} data-city-lon={data.longitude ?? ""} data-timezone={data.timezone}>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-300/70 bg-[#e3efec] px-4 py-3 dark:border-slate-700/70 dark:bg-[#172a30]">
      <div><div className="text-[15px] font-bold tracking-tight text-[#173e46] dark:text-[#d9eeea]">{cityLabel}</div><div className="mt-0.5 text-[10px] uppercase tracking-[.13em] text-[#54757a] dark:text-[#8eafb0]">Stadt-Meteogramm · 7 Höhenbänder · {data.points.length} Zeitpunkte · {data.timezone}</div></div>
      <div className="flex items-center gap-3 text-[10px] text-slate-600 dark:text-slate-300" aria-label="Meteogramm-Legende"><span className="inline-flex items-center gap-1.5"><span className="h-2 w-5 rounded-full bg-[#ee7d42]" /> Temperatur</span>{hasDewPoint && <span className="inline-flex items-center gap-1.5"><span className="h-2 w-5 rounded-full bg-[#22b6c7]" /> Taupunkt</span>}</div>
    </div>
    <div className="flex min-w-0">
      <div className="w-[88px] shrink-0 border-r border-slate-300/60 bg-[#e7f0ee]/75 text-[10px] text-slate-500 dark:border-slate-700/70 dark:bg-[#17282d] dark:text-slate-400"><div className="h-8 border-b border-slate-300/50 dark:border-slate-700/50" /><div className="flex h-7 items-center px-2 font-semibold">Stunden</div><div className="flex h-8 items-center px-2">Wetter</div><div className="flex h-7 items-center px-2 text-[#bd5b2d]">Temperatur</div>{hasDewPoint && <div className="flex h-7 items-center px-2 text-[#168d9a]">Taupunkt</div>}<div className="flex h-[238px] flex-col">{data.bands.map(b => <div key={b.label} className="flex min-h-0 flex-1 items-center border-b border-slate-300/40 px-2 font-semibold text-[#45646b] dark:border-slate-700/50 dark:text-[#a4c0c0]">{b.label}</div>)}</div><div className="flex h-[92px] items-center px-2">Druck / Regen</div></div>
      <div className="min-w-0 flex-1 overflow-x-auto" data-testid="city-meteogram-scroll"><div style={{ minWidth: chartWidth }}>
        <DayHeaders points={data.points} />
        <div className="grid h-7 border-b border-slate-300/50 text-[10px] text-slate-500 dark:border-slate-700/50 dark:text-slate-400" style={{ gridTemplateColumns: `repeat(${data.points.length}, ${POINT_WIDTH}px)` }}>{data.points.map((p, i) => <div key={`hour-${p.timestamp}-${i}`} className="flex items-center justify-center border-r border-slate-300/40 dark:border-slate-700/40">{p.hourLabel}</div>)}</div>
        <div className="grid h-8 border-b border-slate-300/50 dark:border-slate-700/50" style={{ gridTemplateColumns: `repeat(${data.points.length}, ${POINT_WIDTH}px)` }}>{data.points.map((p, i) => <div key={`icon-${p.timestamp}-${i}`} className="flex items-center justify-center border-r border-slate-300/40 dark:border-slate-700/40" title={p.weatherCode === null ? "Wetterzustand nicht verfügbar" : `Wettercode ${p.weatherCode}`}>{weatherIcon(p.weatherCode)}</div>)}</div>
        <div className="grid h-7 border-b border-slate-300/50 text-[11px] font-semibold text-[#bd5b2d] dark:border-slate-700/50" style={{ gridTemplateColumns: `repeat(${data.points.length}, ${POINT_WIDTH}px)` }}>{data.points.map((p, i) => <div key={`temp-${p.timestamp}-${i}`} className="flex items-center justify-center border-r border-slate-300/40">{p.temperature !== null ? `${Math.round(p.temperature)}°` : "—"}</div>)}</div>
        {hasDewPoint && <div className="grid h-7 border-b border-slate-300/50 text-[11px] text-[#168d9a] dark:border-slate-700/50" style={{ gridTemplateColumns: `repeat(${data.points.length}, ${POINT_WIDTH}px)` }}>{data.points.map((p, i) => <div key={`dew-${p.timestamp}-${i}`} className="flex items-center justify-center border-r border-slate-300/40">{p.dewPoint !== null ? `${Math.round(p.dewPoint)}°` : "—"}</div>)}</div>}
        <svg data-testid="meteogram-cloud-field" viewBox={`0 0 ${chartWidth} ${CLOUD_CHART_HEIGHT}`} width={chartWidth} height={CLOUD_CHART_HEIGHT} className="block border-b border-slate-300/50 bg-[#b9d5d5] dark:border-slate-700/50 dark:bg-[#20373d]" role="img" aria-label="Mehrschichtige Wolkenbedeckung nach Höhe">
          <defs><linearGradient id="sky-field" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#8eb9c0" /><stop offset=".58" stopColor="#a9ced0" /><stop offset="1" stopColor="#d4e1db" /></linearGradient><pattern id="cloud-hatch" width="14" height="14" patternUnits="userSpaceOnUse"><path d="M-3 12L5 4M4 17L17 4" stroke="#fff" strokeOpacity=".12" strokeWidth="1" /></pattern></defs>
          <rect width={chartWidth} height={CLOUD_CHART_HEIGHT} fill="url(#sky-field)" opacity=".58" />
          {data.points.map((p, i) => p.isDay === false ? <rect key={`night-${p.timestamp}`} data-night-shading="true" data-night-index={i} x={i * POINT_WIDTH} width={POINT_WIDTH} height={CLOUD_CHART_HEIGHT} fill="#183747" opacity=".13"><title>Nacht</title></rect> : null)}
          {data.bands.map((band, bandIndex) => (
            <path
              key={`continuous-cloud-${band.label}`}
              d={cloudAreaPath(data.points, bandIndex, layerHeight)}
              fill="#5e818b"
              fillOpacity=".24"
              stroke="#6d9299"
              strokeOpacity=".16"
              strokeWidth="1.2"
            />
          ))}
          {data.bands.map((band, bi) => <g key={band.label}><line x1="0" x2={chartWidth} y1={bi * layerHeight} y2={bi * layerHeight} stroke="#345861" strokeOpacity=".22" strokeDasharray="2 5" />{data.points.map((p, pi) => { const pct = p.cloudBands[bi]?.pct; if (pct === null || pct === undefined || pct <= 0) return null; return <g key={`cloud-${band.label}-${p.timestamp}`} data-cloud-shape-band={band.label}><g className="transition-opacity duration-200 hover:opacity-100" opacity={.35 + pct / 170}>{cloudShape(p.cloudType, pi * POINT_WIDTH + 1, bi * layerHeight + 3, POINT_WIDTH - 2, Math.max(12, layerHeight - 7), Math.max(.18, pct / 100))}</g>{pct > 65 && <rect x={pi * POINT_WIDTH} y={bi * layerHeight} width={POINT_WIDTH} height={layerHeight} fill="url(#cloud-hatch)" opacity=".42" />}</g>; })}</g>)}
          {data.points.map((p, pi) => (
            <rect key={`cloud-column-${p.timestamp}`} x={pi * POINT_WIDTH} y="0" width={POINT_WIDTH} height={CLOUD_CHART_HEIGHT} fill="transparent">
              <title>{`${cloudTypeLabel(p.cloudType)} (heuristisch aus Modelldaten) · ${data.bands.map((band, bi) => `${band.label}: ${p.cloudBands[bi]?.pct === null || p.cloudBands[bi]?.pct === undefined ? "k. A." : `${Math.round(p.cloudBands[bi].pct)}%`} · Quellen: ${p.cloudBands[bi]?.sourceLevels.length ? `${p.cloudBands[bi].sourceLevels.join(", ")} hPa` : "keine"}`).join(" · ")}`}</title>
            </rect>
          ))}
          <path d={smoothPath(tempPoints)} fill="none" stroke="#ee7d42" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
          {hasDewPoint && <path d={smoothPath(dewPoints)} fill="none" stroke="#22b6c7" strokeWidth="2" strokeDasharray="5 3" strokeLinecap="round" />}
          {tempPoints.map(([x, y], i) => <circle key={`t-${i}`} cx={x} cy={y} r="2.4" fill="#f6b278" stroke="#a94f2b" strokeWidth="1"><title>{`${data.points[i].temperature} °C`}</title></circle>)}
          {data.points.map((point, i) => point.dewPoint === null ? null : <circle key={`d-${i}`} cx={i * POINT_WIDTH + POINT_WIDTH / 2} cy={temperatureY(point.dewPoint)} r="1.8" fill="#b4f0ed"><title>{`${point.dewPoint} °C`}</title></circle>)}
          <path data-testid="meteogram-lcl-line" d={smoothPath(data.points.flatMap((point, index) => point.cloudBase === null ? [] : [[index * POINT_WIDTH + POINT_WIDTH / 2, cloudBaseY(point.cloudBase, CLOUD_CHART_HEIGHT)] as [number, number]]))} fill="none" stroke="#9a65aa" strokeWidth="2" strokeDasharray="6 4" strokeLinecap="round" />
          {data.points.map((point, index) => point.cloudBase === null ? null : <circle key={`lcl-${point.timestamp}`} cx={index * POINT_WIDTH + POINT_WIDTH / 2} cy={cloudBaseY(point.cloudBase, CLOUD_CHART_HEIGHT)} r="2.4" fill="#f4dff3" stroke="#9a65aa" strokeWidth="1"><title>{`geschätzte Wolkenuntergrenze (LCL): ${Math.round(point.cloudBase)} m, aus Temperatur und Taupunkt abgeleitet; keine Beobachtung`}</title></circle>)}
        </svg>
        <svg data-testid="meteogram-pressure-rain-overlay" viewBox={`0 0 ${chartWidth} ${LOWER_CHART_HEIGHT}`} width={chartWidth} height={LOWER_CHART_HEIGHT} className="block border-b border-slate-300/50 bg-[#d9ece9]/75 dark:border-slate-700/50 dark:bg-[#173239]" role="img" aria-label="Luftdruck und Regen">
          {[.25, .5, .75].map(f => <line key={f} x1="0" x2={chartWidth} y1={f * LOWER_CHART_HEIGHT} y2={f * LOWER_CHART_HEIGHT} stroke="#47747a" strokeOpacity=".15" strokeDasharray="2 4" />)}
          {data.points.map((p, i) => { const rainValue = p.rain ?? 0; const barHeight = Math.min(32, Math.max(rainValue > 0 ? 2 : 0, rainValue / maxRain * 32)); return <g key={`lower-${p.timestamp}`}><line x1={i * POINT_WIDTH} x2={i * POINT_WIDTH} y1="0" y2={LOWER_CHART_HEIGHT} stroke="#47747a" strokeOpacity=".08" /><rect x={i * POINT_WIDTH + 17} y={LOWER_CHART_HEIGHT - 10 - barHeight} width="10" height={barHeight} rx="2" fill="#2cabc0" opacity=".72"><title>{`${rainValue.toFixed(1)} mm Regen${p.precipProbability !== null ? ` · ${Math.round(p.precipProbability)}%` : ""}`}</title></rect>{rainValue > 0 && <text x={i * POINT_WIDTH + 22} y={LOWER_CHART_HEIGHT - 13 - barHeight} textAnchor="middle" fontSize="8" fill="#147482">{rainValue.toFixed(1)}</text>}</g>; })}
          <path d={smoothPath(pressurePoints.map(([x, y]) => [x, y]))} fill="none" stroke="#245c68" strokeWidth="2.2" strokeLinecap="round" />
          {pressurePoints.map(([x, y, pressure], i) => <g key={`pressure-${i}`}><circle cx={x} cy={y} r="2.3" fill="#edf4f2" stroke="#245c68" strokeWidth="1.5" /><text x={x} y={Math.max(10, y - 6)} textAnchor="middle" fontSize="8" fill="#245c68">{Math.round(pressure)}</text></g>)}
        </svg>
      </div></div>
    </div>
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-300/70 px-4 py-2.5 text-[10px] text-slate-600 dark:border-slate-700/70 dark:text-slate-400"><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-5 rounded-sm bg-[#7699a0]/70" /> Wolkenfeld je Windy-Band</span><span>Wolkentyp heuristisch aus Modelldaten</span><span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 bg-[#245c68]" /> Luftdruck</span><span className="inline-flex items-center gap-1.5"><Droplets className="h-3 w-3 text-[#2cabc0]" /> Regen / Wahrscheinlichkeit</span>{hasDewPoint && <span className="text-[#765485]">LCL: aus Temperatur-/Feuchte-Differenz geschätzt, keine Beobachtung</span>}{data.sourceUrl && <a href={data.sourceUrl} target="_blank" rel="noopener noreferrer" className="ml-auto font-semibold text-[#236b75] underline-offset-2 transition-colors hover:text-[#bd5b2d] hover:underline dark:text-[#83c6c5]" data-testid="meteogram-source-link">Quelle Open-Meteo ↗</a>}</div>
  </div>;
}
export default CityMeteogram;