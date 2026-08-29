import { Cloud, CloudLightning, CloudRain, CloudSun, Droplets, Sun } from "lucide-react";
import React from "react";

type JsonRecord = Record<string, unknown>;

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
  cloudBands: Array<{ label: string; pct: number | null; sourceLevels: number[] }>;
};

type CloudBand = {
  label: string;
  minHeightM: number;
  maxHeightM: number;
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

type CityMeteogramProps = {
  analysisJson: Record<string, unknown> | null;
  cityName?: string;
  isLoading?: boolean;
};

const DAY_NAMES = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const POINT_WIDTH = 44;
const CLOUD_CHART_HEIGHT = 214;
const PRESSURE_CHART_HEIGHT = 64;
const CLOUD_BASE_HEIGHT = 30;
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
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function parseLocalTimestamp(timestamp: string): {
  dateKey: string;
  dayLabel: string;
  hourLabel: string;
} | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):/.exec(timestamp);
  if (!match) return null;
  const [, year, month, day, hour] = match;
  const date = new Date(`${year}-${month}-${day}T12:00:00Z`);
  return {
    dateKey: `${year}-${month}-${day}`,
    dayLabel: `${DAY_NAMES[date.getUTCDay()]} ${day}.${month}.`,
    hourLabel: `${hour}:00`,
  };
}

function weatherIcon(code: number | null) {
  if (code === null || code <= 1) return <Sun className="h-4 w-4 text-amber-500" aria-hidden="true" />;
  if (code <= 3) return <CloudSun className="h-4 w-4 text-amber-500" aria-hidden="true" />;
  if (code <= 48) return <Cloud className="h-4 w-4 text-slate-500" aria-hidden="true" />;
  if (code >= 95) return <CloudLightning className="h-4 w-4 text-violet-500" aria-hidden="true" />;
  if (code >= 51) return <CloudRain className="h-4 w-4 text-sky-500" aria-hidden="true" />;
  return <Cloud className="h-4 w-4 text-slate-500" aria-hidden="true" />;
}

function makeSmoothPath(points: Array<[number, number]>) {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0][0]} ${points[0][1]}`;
  return points.reduce((path, [x, y], index) => {
    if (index === 0) return `M ${x} ${y}`;
    const previous = points[index - 1];
    const controlX = (previous[0] + x) / 2;
    return `${path} C ${controlX} ${previous[1]}, ${controlX} ${y}, ${x} ${y}`;
  }, "");
}

export function extractCityMeteogram(analysisJson: Record<string, unknown> | null): CityMeteogramData | null {
  const weatherRaw = asRecord(analysisJson?.weatherRaw);
  const forecast = asRecord(weatherRaw?.openMeteoForecast);
  const city = asRecord(forecast?.city);
  if (!forecast || !city) return null;
  const hourly = asRecord(city?.hourly);
  const timestampEntries = asArray(hourly?.timestamps).flatMap((value, index) => {
    const timestamp = asString(value);
    const local = timestamp ? parseLocalTimestamp(timestamp) : null;
    return timestamp && local ? [{ timestamp, index, local }] : [];
  });
  if (!timestampEntries.length) return null;

  const temperatures = asArray(hourly?.temp2mC);
  const dewPoints = asArray(hourly?.dewPoint2mC);
  const pressures = asArray(hourly?.pressureMslHPa);
  const rain = asArray(hourly?.rainMm);
  const precipProbability = asArray(hourly?.precipProbabilityPct);
  const weatherCodes = asArray(hourly?.weatherCode);
  const cloudBases = asArray(hourly?.cloudBaseM);
  const rawLevels = asArray(hourly?.cloudCoverLevels)
    .map(asRecord)
    .filter((level): level is JsonRecord => Boolean(level))
    .flatMap((level) => {
      const hpa = asNumber(level.hpa);
      if (hpa === null || hpa <= 0 || !isArray(level.heightM) || !isArray(level.pct)) return [];
      return [{ hpa, heights: level.heightM, percentages: level.pct }];
    });

  const points = timestampEntries.map(({ timestamp, index, local }) => {
    const sourceValuesByPressure = new Map<number, { hpa: number; heightM: number; pct: number }>();
    for (const level of rawLevels) {
      const heightM = asNumber(level.heights[index]);
      const pct = asNumber(level.percentages[index]);
      if (
        heightM !== null
        && pct !== null
        && heightM >= 0
        && pct >= 0
        && pct <= 100
        && !sourceValuesByPressure.has(level.hpa)
      ) {
        sourceValuesByPressure.set(level.hpa, { hpa: level.hpa, heightM, pct });
      }
    }

    const cloudBands = WINDY_CLOUD_BANDS.map((band) => {
      const sourceValues = Array.from(sourceValuesByPressure.values())
        .filter((value) =>
          value.heightM >= band.minHeightM
          && value.heightM < band.maxHeightM,
        );
      return {
        label: band.label,
        pct: sourceValues.length
          ? sourceValues.reduce((sum, value) => sum + value.pct, 0) / sourceValues.length
          : null,
        sourceLevels: sourceValues.map((value) => value.hpa),
      };
    });
    return {
      timestamp,
      ...local,
      temperature: asNumber(temperatures[index]),
      dewPoint: asNumber(dewPoints[index]),
      pressure: asNumber(pressures[index]),
      rain: asNumber(rain[index]),
      precipProbability: asNumber(precipProbability[index]),
      weatherCode: asNumber(weatherCodes[index]),
      cloudBase: asNumber(cloudBases[index]),
      cloudBands,
    };
  }).filter((point): point is MeteogramPoint => Boolean(point));

  if (!points.length) return null;

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

function DayHeaders({ points }: { points: MeteogramPoint[] }) {
  const groups: Array<{ label: string; count: number }> = [];
  for (const point of points) {
    const last = groups[groups.length - 1];
    if (last && last.label === point.dayLabel) last.count += 1;
    else groups.push({ label: point.dayLabel, count: 1 });
  }
  return (
    <div
      className="grid h-8 border-b border-border/70 bg-muted/35 text-[11px] font-semibold text-foreground/80"
      style={{ gridTemplateColumns: `repeat(${points.length}, ${POINT_WIDTH}px)` }}
    >
      {groups.map((group, index) => (
        <div
          key={`${group.label}-${index}`}
          className="flex items-center justify-center border-r border-border/60"
          style={{ gridColumn: `span ${group.count}` }}
        >
          {group.label}
        </div>
      ))}
    </div>
  );
}

function CityMeteogram({ analysisJson, cityName, isLoading }: CityMeteogramProps) {
  const data = extractCityMeteogram(analysisJson);
  if (!data) {
    return (
      <div
        className="rounded-lg border border-border/70 bg-muted/20 px-4 py-5 text-sm text-muted-foreground"
        data-testid="city-meteogram"
        data-meteogram-status={isLoading ? "loading" : "unavailable"}
      >
        {isLoading ? "Meteogramm wird mit den Stadtdaten vorbereitet …" : "Meteogramm für die Stadtdaten nicht verfügbar."}
      </div>
    );
  }

  const chartWidth = data.points.length * POINT_WIDTH;
  const pressureValues = data.points.map((point) => point.pressure).filter((value): value is number => value !== null);
  const pressureMin = pressureValues.length ? Math.floor(Math.min(...pressureValues) - 2) : 980;
  const pressureMax = pressureValues.length ? Math.ceil(Math.max(...pressureValues) + 2) : 1030;
  const maxRain = Math.max(
    1,
    ...data.points.map((point) => point.rain ?? 0).filter((value) => Number.isFinite(value)),
  );
  const layerHeight = data.bands.length ? CLOUD_CHART_HEIGHT / data.bands.length : CLOUD_CHART_HEIGHT;
  const cityLabel = cityName || data.cityName;
  const hasDewPoint = data.points.some((point) => point.dewPoint !== null);

  const tempCells = data.points.map((point, index) => (
    <div key={`temp-${point.timestamp}-${index}`} className="flex items-center justify-center border-r border-border/40 text-[11px]">
      {point.temperature !== null ? `${Math.round(point.temperature)}°` : "—"}
    </div>
  ));
  const dewCells = data.points.map((point, index) => (
    <div key={`dew-${point.timestamp}-${index}`} className="flex items-center justify-center border-r border-border/40 text-[11px] text-sky-700 dark:text-sky-300">
      {point.dewPoint !== null ? `${Math.round(point.dewPoint)}°` : "—"}
    </div>
  ));

  const pressurePoints: Array<[number, number, number]> = [];
  data.points.forEach((point, index) => {
    if (point.pressure === null) return;
    const x = index * POINT_WIDTH + POINT_WIDTH / 2;
    const y = PRESSURE_CHART_HEIGHT - 8
      - ((point.pressure - pressureMin) / Math.max(1, pressureMax - pressureMin)) * (PRESSURE_CHART_HEIGHT - 18);
    pressurePoints.push([x, y, point.pressure]);
  });

  const cloudBasePoints: Array<[number, number]> = [];
  data.points.forEach((point, index) => {
    if (point.cloudBase === null) return;
    const x = index * POINT_WIDTH + POINT_WIDTH / 2;
    const y = CLOUD_BASE_HEIGHT - 8 - Math.min(1, Math.max(0, point.cloudBase / 6000)) * (CLOUD_BASE_HEIGHT - 12);
    cloudBasePoints.push([x, y]);
  });

  return (
    <div
      className="rounded-lg border border-border/70 bg-card/70 shadow-sm overflow-hidden"
      data-testid="city-meteogram"
      data-meteogram-status="ready"
      data-city-name={data.cityName}
      data-city-lat={data.latitude ?? ""}
      data-city-lon={data.longitude ?? ""}
      data-timezone={data.timezone}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border/70 px-3 py-2">
        <div>
          <div className="text-sm font-semibold text-foreground">{cityLabel}</div>
          <div className="text-[11px] text-muted-foreground">Stadt-Meteogramm · 7 Windy-Höhenbänder · {data.points.length} Zeitpunkte · {data.timezone}</div>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-[10px] text-muted-foreground" aria-label="Meteogramm-Legende">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" /> Temperatur</span>
          {hasDewPoint && (
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-sky-500" /> Taupunkt</span>
          )}
        </div>
      </div>

      <div className="flex min-w-0">
        <div className="w-[88px] shrink-0 border-r border-border/70 bg-muted/20 text-[10px] text-muted-foreground">
          <div className="h-8 border-b border-border/50" />
          <div className="flex h-7 items-center px-2">Stunden</div>
          <div className="flex h-8 items-center px-2">Wetter</div>
          <div className="flex h-7 items-center px-2">Temperatur</div>
          {hasDewPoint && <div className="flex h-7 items-center px-2">Taupunkt</div>}
          <div className="flex h-[214px] flex-col">
            {WINDY_CLOUD_BANDS.map((band) => (
              <div key={band.label} className="flex min-h-0 flex-1 items-center border-b border-border/40 px-2 font-medium text-foreground/70">
                {band.label}
              </div>
            ))}
          </div>
          <div className="flex h-[64px] items-center px-2">Luftdruck</div>
          <div className="flex h-[54px] items-center px-2">Regen</div>
          <div className="flex h-[30px] items-center px-2">Wolkenbasis</div>
        </div>

        <div className="min-w-0 flex-1 overflow-x-auto" data-testid="city-meteogram-scroll">
          <div style={{ minWidth: `${chartWidth}px` }}>
            <DayHeaders points={data.points} />

            <div
              className="grid h-7 border-b border-border/50 text-[10px] text-muted-foreground"
              style={{ gridTemplateColumns: `repeat(${data.points.length}, ${POINT_WIDTH}px)` }}
            >
              {data.points.map((point, index) => (
                <div key={`hour-${point.timestamp}-${index}`} className="flex items-center justify-center border-r border-border/40">{point.hourLabel}</div>
              ))}
            </div>

            <div
              className="grid h-8 border-b border-border/50"
              style={{ gridTemplateColumns: `repeat(${data.points.length}, ${POINT_WIDTH}px)` }}
            >
              {data.points.map((point, index) => (
                <div key={`icon-${point.timestamp}-${index}`} className="flex items-center justify-center border-r border-border/40" title={point.weatherCode === null ? "Wetterzustand nicht verfügbar" : `Wettercode ${point.weatherCode}`}>
                  {weatherIcon(point.weatherCode)}
                </div>
              ))}
            </div>

            <div className="grid h-7 border-b border-border/50" style={{ gridTemplateColumns: `repeat(${data.points.length}, ${POINT_WIDTH}px)` }}>
              {tempCells}
            </div>
            {hasDewPoint && (
              <div className="grid h-7 border-b border-border/50" style={{ gridTemplateColumns: `repeat(${data.points.length}, ${POINT_WIDTH}px)` }}>
                {dewCells}
              </div>
            )}

            <svg
              viewBox={`0 0 ${chartWidth} ${CLOUD_CHART_HEIGHT}`}
              width={chartWidth}
              height={CLOUD_CHART_HEIGHT}
              className="block border-b border-border/50 bg-slate-50/60 dark:bg-slate-950/30"
              role="img"
              aria-label="Mehrschichtige Wolkenbedeckung nach Höhe"
            >
              {data.bands.map((band, bandIndex) => (
                <g key={`band-${band.label}`}>
                  <line
                    x1="0"
                    x2={chartWidth}
                    y1={bandIndex * layerHeight}
                    y2={bandIndex * layerHeight}
                    stroke="currentColor"
                    strokeOpacity="0.12"
                    strokeDasharray="3 4"
                  />
                  {data.points.map((point, pointIndex) => {
                    const bandData = point.cloudBands[bandIndex];
                    const pct = bandData?.pct ?? null;
                    if (pct === null) return null;
                    const opacity = 0.08 + Math.min(100, Math.max(0, pct)) / 100 * 0.68;
                    return (
                      <rect
                        key={`cloud-${band.label}-${point.timestamp}`}
                        x={pointIndex * POINT_WIDTH + 2}
                        y={bandIndex * layerHeight + 1}
                        width={POINT_WIDTH - 4}
                        height={Math.max(4, layerHeight - 2)}
                        rx={4}
                        fill="currentColor"
                        fillOpacity={opacity}
                      >
                        <title>{`${band.label} · ${Math.round(pct)}% Wolken${bandData.sourceLevels.length ? ` · Quellen: ${bandData.sourceLevels.join("/")} hPa` : ""}`}</title>
                      </rect>
                    );
                  })}
                </g>
              ))}
            </svg>

            <svg
              viewBox={`0 0 ${chartWidth} ${PRESSURE_CHART_HEIGHT}`}
              width={chartWidth}
              height={PRESSURE_CHART_HEIGHT}
              className="block border-b border-border/50 bg-blue-50/30 dark:bg-blue-950/20"
              role="img"
              aria-label="Luftdruckverlauf"
            >
              {[0.25, 0.5, 0.75].map((fraction) => (
                <line
                  key={fraction}
                  x1="0"
                  x2={chartWidth}
                  y1={fraction * PRESSURE_CHART_HEIGHT}
                  y2={fraction * PRESSURE_CHART_HEIGHT}
                  stroke="currentColor"
                  strokeOpacity="0.1"
                  strokeDasharray="3 4"
                />
              ))}
              {data.points.map((point, index) => (
                <line key={`pressure-grid-${point.timestamp}`} x1={index * POINT_WIDTH} x2={index * POINT_WIDTH} y1="0" y2={PRESSURE_CHART_HEIGHT} stroke="currentColor" strokeOpacity="0.07" />
              ))}
              <path d={makeSmoothPath(pressurePoints.map(([x, y]) => [x, y]))} fill="none" stroke="#2563eb" strokeWidth="2" />
              {pressurePoints.map(([x, y, pressure], index) => (
                <circle key={`pressure-point-${index}`} cx={x} cy={y} r="2.5" fill="#2563eb">
                  <title>{`${pressure} hPa`}</title>
                </circle>
              ))}
              {pressurePoints.map(([x, y, pressure], index) => index % 2 === 0 && (
                <text key={`pressure-label-${index}`} x={x} y={Math.max(9, y - 5)} textAnchor="middle" fontSize="8" fill="#2563eb">
                  {Math.round(pressure)}
                </text>
              ))}
            </svg>

            <div
              className="grid h-[54px] items-end border-b border-border/50 bg-sky-50/30 dark:bg-sky-950/20"
              style={{ gridTemplateColumns: `repeat(${data.points.length}, ${POINT_WIDTH}px)` }}
            >
              {data.points.map((point, index) => {
                const rainValue = point.rain ?? 0;
                const barHeight = Math.min(38, Math.max(rainValue > 0 ? 3 : 0, (rainValue / maxRain) * 38));
                return (
                  <div key={`rain-${point.timestamp}-${index}`} className="relative flex h-full items-end justify-center border-r border-border/40">
                    {point.precipProbability !== null && point.precipProbability >= 20 && (
                      <span className="absolute top-1 text-[9px] text-sky-700 dark:text-sky-300">{Math.round(point.precipProbability)}%</span>
                    )}
                    <div className="w-3 rounded-t-sm bg-sky-500/80" style={{ height: `${barHeight}px` }} title={`${rainValue.toFixed(1)} mm Regen`} />
                    {rainValue > 0 && <span className="absolute bottom-1 text-[9px] text-sky-800 dark:text-sky-200">{rainValue.toFixed(1)}</span>}
                  </div>
                );
              })}
            </div>

            <svg
              viewBox={`0 0 ${chartWidth} ${CLOUD_BASE_HEIGHT}`}
              width={chartWidth}
              height={CLOUD_BASE_HEIGHT}
              className="block bg-violet-50/25 dark:bg-violet-950/15"
              role="img"
              aria-label="Geschätzte Wolkenbasis"
            >
              <path d={makeSmoothPath(cloudBasePoints)} fill="none" stroke="#8b5cf6" strokeWidth="1.5" strokeDasharray="4 3" />
              {data.points.map((point, index) => (
                <text key={`base-${point.timestamp}-${index}`} x={index * POINT_WIDTH + POINT_WIDTH / 2} y={CLOUD_BASE_HEIGHT - 8} textAnchor="middle" fontSize="8" fill="currentColor" opacity="0.65">
                  {point.cloudBase !== null ? `${Math.round(point.cloudBase / 100) * 100}` : "—"}
                </text>
              ))}
            </svg>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/70 px-3 py-2 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-foreground/45" /> Wolken je Windy-Band, aus verfügbaren Open-Meteo-Druckflächen</span>
        <span className="inline-flex items-center gap-1"><span className="h-0.5 w-3 bg-blue-600" /> Luftdruck (hPa)</span>
        <span className="inline-flex items-center gap-1"><Droplets className="h-3 w-3 text-sky-500" /> Regen (mm) / Wahrscheinlichkeit</span>
        {data.sourceUrl && (
          <a href={data.sourceUrl} target="_blank" rel="noopener noreferrer" className="ml-auto text-primary underline-offset-2 hover:underline" data-testid="meteogram-source-link">
            Quelle Open-Meteo ↗
          </a>
        )}
      </div>
    </div>
  );
}

export default CityMeteogram;