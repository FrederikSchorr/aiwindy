import React from "react";
import { FORECAST_LABEL_RAIL_WIDTH, FORECAST_POINT_WIDTH, ForecastClockGlyph } from "./forecast-chart-shared";

type JsonRecord = Record<string, unknown>;

export type SeaWindPoint = {
  timestamp: string;
  dateKey: string;
  dayLabel: string;
  hour: number;
  speed: number | null;
  gust: number | null;
  direction: number | null;
  isDay: boolean;
};

type SeaWindForecastData = {
  sailingAreaName: string;
  latitude: number | null;
  longitude: number | null;
  timezone: string;
  points: SeaWindPoint[];
};

type SeaWindForecastProps = {
  analysisJson: Record<string, unknown> | null;
  isLoading?: boolean;
};

const DAY_NAMES = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const POINT_WIDTH = FORECAST_POINT_WIDTH;
const MAX_POINTS = 6 * 8;
const ROW = { day: 27, hours: 21, wind: 27, gust: 27, direction: 34 } as const;
const WIND_ARROW_ASSETS = [
  { degrees: 0, src: "/assets/wind-arrows/wind-arrow-N-000.svg" },
  { degrees: 22.5, src: "/assets/wind-arrows/wind-arrow-NNE-022.svg" },
  { degrees: 45, src: "/assets/wind-arrows/wind-arrow-NE-045.svg" },
  { degrees: 67.5, src: "/assets/wind-arrows/wind-arrow-ENE-068.svg" },
  { degrees: 90, src: "/assets/wind-arrows/wind-arrow-E-090.svg" },
  { degrees: 112.5, src: "/assets/wind-arrows/wind-arrow-ESE-112.svg" },
  { degrees: 135, src: "/assets/wind-arrows/wind-arrow-SE-135.svg" },
  { degrees: 157.5, src: "/assets/wind-arrows/wind-arrow-SSE-158.svg" },
  { degrees: 180, src: "/assets/wind-arrows/wind-arrow-S-180.svg" },
  { degrees: 202.5, src: "/assets/wind-arrows/wind-arrow-SSW-202.svg" },
  { degrees: 225, src: "/assets/wind-arrows/wind-arrow-SW-225.svg" },
  { degrees: 247.5, src: "/assets/wind-arrows/wind-arrow-WSW-248.svg" },
  { degrees: 270, src: "/assets/wind-arrows/wind-arrow-W-270.svg" },
  { degrees: 292.5, src: "/assets/wind-arrows/wind-arrow-WNW-292.svg" },
  { degrees: 315, src: "/assets/wind-arrows/wind-arrow-NW-315.svg" },
  { degrees: 337.5, src: "/assets/wind-arrows/wind-arrow-NNW-338.svg" },
] as const;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
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

function normalizeTimezone(value: unknown): string {
  const candidate = asString(value) ?? "UTC";
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return "UTC";
  }
}

function localParts(timestamp: string, timezone: string): { dateKey: string; dayLabel: string; hour: number } | null {
  const plain = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})/.exec(timestamp);
  if (plain && !/(Z|[+-]\d{2}:?\d{2})$/i.test(timestamp)) {
    const [, year, month, day, hour] = plain;
    const dateKey = `${year}-${month}-${day}`;
    const weekday = new Date(`${dateKey}T12:00:00Z`).getUTCDay();
    return { dateKey, dayLabel: `${DAY_NAMES[weekday]} ${day}`, hour: Number(hour) };
  }

  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return null;
  let parts: Record<string, string>;
  try {
    parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        hourCycle: "h23",
      }).formatToParts(date).map((part) => [part.type, part.value]),
    );
  } catch {
    return null;
  }
  const year = parts.year;
  const month = parts.month;
  const day = parts.day;
  const hour = Number(parts.hour);
  if (!year || !month || !day || !Number.isFinite(hour)) return null;
  const dateKey = `${year}-${month}-${day}`;
  const weekday = new Date(`${dateKey}T12:00:00Z`).getUTCDay();
  return { dateKey, dayLabel: `${DAY_NAMES[weekday]} ${day}`, hour: hour % 24 };
}

function isDaylight(hour: number): boolean {
  return hour >= 7 && hour < 21;
}

function localNowValue(timezone: string): number {
  try {
    const parts = Object.fromEntries(
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
    return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  } catch {
    return Date.now();
  }
}

function localTimestampValue(timestamp: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})(?::(\d{2}))?/.exec(timestamp);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5] ?? 0));
}

function forecastSamplingStride(timestamps: Array<string | null>): number {
  const values = timestamps
    .flatMap((timestamp) => {
      const value = timestamp ? localTimestampValue(timestamp) : null;
      return value === null ? [] : [value];
    })
    .slice(0, 12);
  const gaps = values
    .slice(1)
    .map((value, index) => value - values[index])
    .filter((gap) => gap > 0)
    .sort((a, b) => a - b);
  if (!gaps.length) return 1;
  const medianGap = gaps[Math.floor(gaps.length / 2)];
  return medianGap >= 2 * 60 * 60 * 1000 ? 1 : 3;
}

export function extractSeaWindForecast(analysisJson: Record<string, unknown> | null): SeaWindForecastData | null {
  const weatherRaw = asRecord(analysisJson?.weatherRaw);
  const forecast = asRecord(weatherRaw?.resolvedLocalForecast)
    ?? asRecord(weatherRaw?.openMeteoForecast)
    ?? asRecord(analysisJson?.openMeteoForecast);
  const sailingArea = asRecord(forecast?.sailingArea);
  const hourly = asRecord(sailingArea?.hourly);
  const timestamps = asArray(hourly?.timestamps).map(asString);
  if (!sailingArea || !hourly || !timestamps.length) return null;

  const timezone = normalizeTimezone(forecast?.timezone);
  const speeds = asArray(hourly.windSpeedKt);
  const gusts = asArray(hourly.gustKt);
  const directions = asArray(hourly.windDirDeg);
  const samplingStride = forecastSamplingStride(timestamps);
  const points = timestamps.flatMap((timestamp, index) => {
    if (index % samplingStride !== 0 || !timestamp) return [];
    const local = localParts(timestamp, timezone);
    if (!local) return [];
    return [{
      timestamp,
      dateKey: local.dateKey,
      dayLabel: local.dayLabel,
      hour: local.hour,
      speed: asNumber(speeds[index]),
      gust: asNumber(gusts[index]),
      direction: asNumber(directions[index]),
      isDay: isDaylight(local.hour),
    }];
  }).slice(0, MAX_POINTS);
  if (!points.some((point) => point.speed !== null || point.gust !== null || point.direction !== null)) return null;

  const forecastDays = Array.from(new Set(points.map((point) => point.dateKey))).slice(0, 6);
  const visiblePoints = points.filter((point) => forecastDays.includes(point.dateKey));
  if (visiblePoints.length !== MAX_POINTS || forecastDays.length !== 6) return null;
  if (visiblePoints.some((point) => point.speed === null || point.gust === null || point.direction === null)) return null;
  const timestampValues = visiblePoints.map((point) => localTimestampValue(point.timestamp));
  if (timestampValues.some((value) => value === null)) return null;
  const threeHoursMs = 3 * 60 * 60 * 1000;
  if (timestampValues.slice(1).some((value, index) => value! - timestampValues[index]! !== threeHoursMs)) return null;

  const coordinates = asRecord(sailingArea.coordinates);
  return {
    sailingAreaName: asString(sailingArea.name) ?? "Seegebiet",
    latitude: asNumber(coordinates?.lat),
    longitude: asNumber(coordinates?.lon),
    timezone,
    points: visiblePoints,
  };
}

function toHex(value: number): string {
  return Math.round(value).toString(16).padStart(2, "0");
}

function mixColor(start: string, end: string, amount: number): string {
  const a = start.slice(1).match(/.{2}/g)!.map((part) => parseInt(part, 16));
  const b = end.slice(1).match(/.{2}/g)!.map((part) => parseInt(part, 16));
  return `#${a.map((channel, index) => toHex(channel + (b[index] - channel) * amount)).join("")}`;
}

const COLOR_STOPS = [
  { value: 0, color: "#f1f2f2" },
  { value: 4, color: "#e1e5e6" },
  { value: 6, color: "#9bdfe5" },
  { value: 8, color: "#12bdca" },
  { value: 10, color: "#28ce51" },
  { value: 15, color: "#8fd20c" },
  { value: 20, color: "#ddd000" },
  { value: 25, color: "#ff9800" },
  { value: 30, color: "#ff5600" },
  { value: 35, color: "#ff0080" },
  { value: 40, color: "#d90098" },
  { value: 50, color: "#a000b2" },
];

function windColor(value: number | null): string {
  if (value === null) return COLOR_STOPS[0].color;
  const bounded = Math.max(0, Math.min(50, value));
  const nextIndex = COLOR_STOPS.findIndex((stop) => stop.value >= bounded);
  if (nextIndex <= 0) return COLOR_STOPS[0].color;
  if (nextIndex === -1) return COLOR_STOPS[COLOR_STOPS.length - 1].color;
  const previous = COLOR_STOPS[nextIndex - 1];
  const next = COLOR_STOPS[nextIndex];
  return mixColor(previous.color, next.color, (bounded - previous.value) / (next.value - previous.value));
}

function textColor(background: string): string {
  const channels = background.slice(1).match(/.{2}/g)!.map((part) => parseInt(part, 16));
  const luminance = (channels[0] * 299 + channels[1] * 587 + channels[2] * 114) / 1000;
  return luminance > 78 ? "#1f2d33" : "#ffffff";
}

function formatValue(value: number | null): string {
  return value === null ? "—" : String(Math.round(value));
}

function dayGroups(points: SeaWindPoint[]): Array<{ label: string; count: number }> {
  return points.reduce<Array<{ label: string; count: number }>>((groups, point) => {
    const last = groups.at(-1);
    if (last?.label === point.dayLabel) last.count += 1;
    else groups.push({ label: point.dayLabel, count: 1 });
    return groups;
  }, []);
}

function nearestWindArrow(degrees: number): (typeof WIND_ARROW_ASSETS)[number] {
  const normalized = ((degrees % 360) + 360) % 360;
  return WIND_ARROW_ASSETS.reduce((nearest, candidate) => {
    const distance = Math.min(
      Math.abs(normalized - candidate.degrees),
      360 - Math.abs(normalized - candidate.degrees),
    );
    const nearestDistance = Math.min(
      Math.abs(normalized - nearest.degrees),
      360 - Math.abs(normalized - nearest.degrees),
    );
    return distance < nearestDistance ? candidate : nearest;
  });
}

function DirectionArrow({ degrees }: { degrees: number }) {
  // Open-Meteo reports the meteorological "from" direction. The arrow itself
  // points toward where the air is moving, which is the opposite direction.
  const asset = nearestWindArrow(degrees + 180);
  return (
    <img
      src={asset.src}
      alt=""
      className="h-5 w-5 shrink-0"
      aria-hidden="true"
      draggable="false"
    />
  );
}

export default function SeaWindForecast({ analysisJson, isLoading = false }: SeaWindForecastProps) {
  const data = extractSeaWindForecast(analysisJson);
  if (!data) {
    return (
      <div
        className="my-1 rounded-lg border border-[#cbd0d6] bg-[#f5f6f8] px-3 py-2 text-sm text-muted-foreground"
        data-testid="sea-wind-forecast"
        data-forecast-status={isLoading ? "loading" : "unavailable"}
      >
        {isLoading ? "Seegebiet-Windprognose wird geladen …" : "Seegebiet-Windprognose nicht verfügbar."}
      </div>
    );
  }

  const width = data.points.length * POINT_WIDTH;
  const days = dayGroups(data.points);
  const grid = { gridTemplateColumns: `repeat(${data.points.length}, ${POINT_WIDTH}px)` };
  const dayBoundaryIndices = data.points.reduce<number[]>((indices, point, index) => {
    if (index > 0 && point.dateKey !== data.points[index - 1].dateKey) indices.push(index);
    return indices;
  }, []);
  const nowValue = localNowValue(data.timezone);
  const currentPointIndex = data.points.reduce((bestIndex, point, index) => {
    const pointValue = localTimestampValue(point.timestamp);
    const bestValue = localTimestampValue(data.points[bestIndex]?.timestamp ?? "");
    return pointValue !== null && (bestValue === null || Math.abs(pointValue - nowValue) < Math.abs(bestValue - nowValue))
      ? index
      : bestIndex;
  }, 0);

  return (
    <section
      className="overflow-hidden rounded-[10px] border border-[#cbd0d6] bg-[#f5f6f8] font-sans text-[#30353a] shadow-[0_8px_24px_rgba(38,47,57,.1)]"
      data-testid="sea-wind-forecast"
      data-forecast-status="ready"
      data-sailing-area={data.sailingAreaName}
      data-sailing-area-lat={data.latitude ?? ""}
      data-sailing-area-lon={data.longitude ?? ""}
      data-forecast-days={days.length}
      data-forecast-points={data.points.length}
      aria-label={`Windvorhersage für ${data.sailingAreaName} · ${days.length} Tage, horizontal scrollbar`}
    >
      <div className="sea-wind-layout flex min-w-0">
        <aside
          data-testid="sea-wind-label-rail"
          className="sea-wind-label-rail shrink-0 border-r border-[#cbd0d6] bg-[#eceff2] text-[12px] leading-[15px] text-[#7a7e82]"
          data-label-rail-width={FORECAST_LABEL_RAIL_WIDTH}
        >
          <div style={{ height: ROW.day }} />
          <div className="flex items-center justify-end gap-2 pr-3" style={{ height: ROW.hours }}>
            <span>Stunden</span>
            <ForecastClockGlyph />
          </div>
          <div className="flex items-center justify-end gap-2 pr-3" style={{ height: ROW.wind }}>
            <span>Wind</span><span className="text-[10px] leading-3">kt</span>
          </div>
          <div className="flex items-center justify-end gap-2 pr-3" style={{ height: ROW.gust }}>
            <span>Böen</span><span className="text-[10px] leading-3">kt</span>
          </div>
          <div className="flex items-center justify-end gap-2 pr-3" style={{ height: ROW.direction }}>
            <span className="text-right">Windrichtung</span>
          </div>
        </aside>

        <div
          className="sea-wind-forecast-scroll min-w-0 flex-1 overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
          data-testid="sea-wind-forecast-scroll"
          role="region"
          tabIndex={0}
          aria-label={`Windvorhersage für ${data.sailingAreaName}, horizontal mit Pfeiltasten scrollen`}
          style={{ scrollbarWidth: "thin" }}
        >
          <div className="relative" style={{ minWidth: width }}>
            <div data-night-overlay-layer="true" className="pointer-events-none absolute inset-x-0 bottom-0 z-[15] flex" style={{ top: ROW.day }}>
              {data.points.map((point, index) => (
                <div
                  key={`shade-${point.timestamp}-${index}`}
                  data-night-shading={point.isDay ? undefined : "true"}
                  className={point.isDay ? "h-full shrink-0" : "h-full shrink-0 bg-[#63709b]/[.075]"}
                  style={{ width: POINT_WIDTH }}
                />
              ))}
            </div>

            <div className="relative z-10">
              <div className="grid bg-[#f7f8fa] text-[13px] font-medium tracking-[.01em] text-[#555c63]" style={{ height: ROW.day, ...grid }}>
                {days.map((day, index) => (
                  <div key={`${day.label}-${index}`} className="flex items-center border-r border-[#d5d9de] pl-3" style={{ gridColumn: `span ${day.count}` }}>
                    <span className="whitespace-nowrap">{day.label}</span>
                  </div>
                ))}
              </div>
              <div
                data-testid="sea-wind-hours-row"
                data-row-height={ROW.hours}
                data-font-size={13}
                className="grid text-[13px] text-[#717880]"
                style={{ height: ROW.hours, ...grid }}
              >
                {data.points.map((point, index) => (
                  <div key={`hour-${point.timestamp}-${index}`} className="flex items-center justify-center" data-hour-label={point.hour}>{point.hour}</div>
                ))}
              </div>
              <div className="grid" style={{ height: ROW.wind, ...grid }}>
                {data.points.map((point, index) => {
                  const background = windColor(point.speed);
                  return (
                    <div key={`wind-${point.timestamp}-${index}`} className="flex items-center justify-center text-[13px] font-medium" style={{ backgroundColor: background, color: textColor(background) }}>
                      {formatValue(point.speed)}
                    </div>
                  );
                })}
              </div>
              <div className="grid" style={{ height: ROW.gust, ...grid }}>
                {data.points.map((point, index) => {
                  const background = windColor(point.gust);
                  return (
                    <div key={`gust-${point.timestamp}-${index}`} className="flex items-center justify-center text-[12px] font-medium" style={{ backgroundColor: background, color: textColor(background) }}>
                      {formatValue(point.gust)}
                    </div>
                  );
                })}
              </div>
              <div className="grid" style={{ height: ROW.direction, ...grid }}>
                {data.points.map((point, index) => (
                  <div
                    key={`direction-${point.timestamp}-${index}`}
                    className="flex items-center justify-center"
                    role="img"
                    aria-label={point.direction === null ? "Windrichtung nicht verfügbar" : `Windrichtung ${Math.round(point.direction)}°`}
                    title={point.direction === null ? "Windrichtung nicht verfügbar" : `${Math.round(point.direction)}°`}
                  >
                    {point.direction === null ? <span className="text-[#86919a]">—</span> : <DirectionArrow degrees={point.direction} />}
                  </div>
                ))}
              </div>
            </div>

            {dayBoundaryIndices.map((index) => (
              <div key={`boundary-${index}`} className="pointer-events-none absolute inset-y-0 z-20 border-l border-[#aeb8c0]" style={{ left: index * POINT_WIDTH }} />
            ))}
            <div
              data-testid="sea-wind-current-column"
              role="img"
              aria-label={`Aktueller Prognosezeitpunkt: ${data.points[currentPointIndex].dayLabel} ${data.points[currentPointIndex].hour}:00 Uhr`}
              className="pointer-events-none absolute z-20 border-l border-dashed border-[#bd8d8d]/75"
              style={{ left: currentPointIndex * POINT_WIDTH + POINT_WIDTH / 2, top: ROW.day, bottom: 0 }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}