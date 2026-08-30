import React from "react";
import "./_group.css";
import { WeatherIcon, type WeatherIconKind } from "./_WeatherIcon";

type CloudAmount = "clear" | "few" | "broken" | "overcast";
type Point = {
  timestamp: string;
  temperature: number;
  dewPoint: number;
  pressure: number;
  rain: number;
  cloudType: "clear" | "cirrus" | "stratus" | "cumulus" | "mixed";
  cloudAmount: CloudAmount;
  storm: boolean;
  isDay: boolean;
};

const POINT_WIDTH = 44;
const MAX_RAIN_MM = 10;
const ROW = { day: 43, hours: 34, icons: 44, temperature: 42, dew: 30, pressure: 106 };
const DAY_NAMES = ["SONNTAG", "MONTAG", "DIENSTAG", "MITTWOCH", "DONNERSTAG", "FREITAG", "SAMSTAG"];
const screenshotData = [
  { day: 29, hour: 2, temperature: 21, dewPoint: 18, pressure: 1014, rain: .8, cloudAmount: "overcast", storm: false },
  { day: 29, hour: 5, temperature: 19, dewPoint: 15, pressure: 1013, rain: 0, cloudAmount: "clear", storm: false },
  { day: 29, hour: 8, temperature: 21, dewPoint: 14, pressure: 1016, rain: 0, cloudAmount: "clear", storm: false },
  { day: 29, hour: 11, temperature: 22, dewPoint: 13, pressure: 1019, rain: 0, cloudAmount: "broken", storm: false },
  { day: 29, hour: 14, temperature: 26, dewPoint: 13, pressure: 1018, rain: .3, cloudAmount: "overcast", storm: true },
  { day: 29, hour: 17, temperature: 26, dewPoint: 12, pressure: 1017, rain: 0, cloudAmount: "overcast", storm: false },
  { day: 29, hour: 20, temperature: 23, dewPoint: 12, pressure: 1019, rain: .4, cloudAmount: "broken", storm: false },
  { day: 29, hour: 23, temperature: 21, dewPoint: 11, pressure: 1018, rain: 2.2, cloudAmount: "few", storm: false },
  { day: 30, hour: 2, temperature: 20, dewPoint: 12, pressure: 1020, rain: .3, cloudAmount: "broken", storm: false },
  { day: 30, hour: 5, temperature: 19, dewPoint: 14, pressure: 1019, rain: .2, cloudAmount: "few", storm: false },
  { day: 30, hour: 8, temperature: 21, dewPoint: 14, pressure: 1017, rain: 0, cloudAmount: "clear", storm: false },
  { day: 30, hour: 11, temperature: 24, dewPoint: 14, pressure: 1015, rain: 0, cloudAmount: "broken", storm: false },
  { day: 30, hour: 14, temperature: 27, dewPoint: 15, pressure: 1014, rain: .7, cloudAmount: "overcast", storm: true },
  { day: 30, hour: 17, temperature: 26, dewPoint: 16, pressure: 1016, rain: .4, cloudAmount: "broken", storm: false },
  { day: 30, hour: 20, temperature: 23, dewPoint: 15, pressure: 1018, rain: 1.1, cloudAmount: "overcast", storm: false },
  { day: 30, hour: 23, temperature: 21, dewPoint: 13, pressure: 1019, rain: .5, cloudAmount: "few", storm: false },
  { day: 31, hour: 2, temperature: 20, dewPoint: 12, pressure: 1020, rain: .2, cloudAmount: "few", storm: false },
  { day: 31, hour: 5, temperature: 19, dewPoint: 13, pressure: 1021, rain: 0, cloudAmount: "clear", storm: false },
  { day: 31, hour: 8, temperature: 21, dewPoint: 14, pressure: 1022, rain: 0, cloudAmount: "clear", storm: false },
  { day: 31, hour: 11, temperature: 24, dewPoint: 15, pressure: 1021, rain: 0, cloudAmount: "broken", storm: false },
  { day: 31, hour: 14, temperature: 26, dewPoint: 15, pressure: 1019, rain: .3, cloudAmount: "overcast", storm: false },
  { day: 31, hour: 17, temperature: 25, dewPoint: 15, pressure: 1018, rain: .6, cloudAmount: "overcast", storm: false },
  { day: 31, hour: 20, temperature: 22, dewPoint: 14, pressure: 1017, rain: 1, cloudAmount: "overcast", storm: false },
  { day: 31, hour: 23, temperature: 20, dewPoint: 13, pressure: 1016, rain: 1.8, cloudAmount: "overcast", storm: false },
] as const;
const points: Point[] = screenshotData.map(entry => {
  const date = new Date(Date.UTC(2026, 7, entry.day, entry.hour));
  return {
    timestamp: date.toISOString().slice(0, 19),
    temperature: entry.temperature,
    dewPoint: entry.dewPoint,
    pressure: entry.pressure,
    rain: entry.rain,
    cloudType: entry.cloudAmount === "clear" ? "clear" : entry.cloudAmount === "broken" ? "cumulus" : "stratus",
    cloudAmount: entry.cloudAmount,
    storm: entry.storm,
    isDay: entry.hour >= 6 && entry.hour < 21,
  };
});

function smoothPath(values: Array<[number, number]>) {
  return values.reduce((path, [x, y], index) => {
    if (!index) return `M ${x} ${y}`;
    const [previousX, previousY] = values[index - 1];
    const middle = (previousX + x) / 2;
    return `${path} C ${middle} ${previousY}, ${middle} ${y}, ${x} ${y}`;
  }, "");
}
function temperatureColor(value: number) {
  if (value < 8) return "#42bfd0";
  if (value < 16) return "#a8d66d";
  if (value < 23) return "#f3c66d";
  return "#ed6a8d";
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
    <span className="border-b border-dotted border-current text-[10px] leading-3">hPa</span>
    <span className="border-b border-dotted border-current text-[14px] leading-4">mm</span>
  </div>;
}

function weatherIcon(point: Point) {
  const kind: WeatherIconKind = point.storm
    ? "thunderstorm"
    : point.rain >= .5
      ? "heavy-rain"
      : point.rain > 0
        ? "light-rain"
        : !point.isDay
          ? point.cloudAmount === "clear" ? "clear-night" : point.cloudAmount === "few" ? "partly-cloudy-night" : "overcast-night"
          : point.cloudAmount === "clear"
            ? "clear-day"
            : point.cloudAmount === "few"
              ? "few-clouds-day"
            : point.cloudAmount === "broken"
                ? "partly-cloudy-day"
                : "overcast-day";
  return <WeatherIcon kind={kind} className="h-9 w-9" />;
}
function TemperatureDewSection({ points, width, grid, temperatureArea, dewBoundaryPoints }: {
  points: Point[];
  width: number;
  grid: React.CSSProperties;
  temperatureArea: string;
  dewBoundaryPoints: Array<[number, number]>;
}) {
  return <div className="relative" style={{ height: ROW.icons + ROW.temperature + ROW.dew }}>
    <svg viewBox={`0 0 ${width} ${ROW.icons + ROW.temperature + 12}`} width={width} height={ROW.icons + ROW.temperature + 12} className="pointer-events-none absolute inset-0">
      <defs><linearGradient id="current-temperature" x2={width} gradientUnits="userSpaceOnUse"><stop offset="0%" stopColor={temperatureColor(points[0].temperature)} />{points.map((point, index) => <stop key={point.timestamp} offset={`${index / (points.length - 1) * 100}%`} stopColor={temperatureColor(point.temperature)} />)}</linearGradient></defs>
      <path d={temperatureArea} fill="url(#current-temperature)" fillOpacity=".56" />
    </svg>
    <div className="relative z-30 grid" style={{ height: ROW.icons, ...grid }}>{points.map(point => <div key={point.timestamp} className="flex items-center justify-center" title={`${point.cloudType} · Regen ${point.rain.toFixed(1)} mm`}>{weatherIcon(point)}</div>)}</div>
    <div className="relative z-20 grid text-[21px] font-medium text-[#20252a]" style={{ height: ROW.temperature, ...grid }}>{points.map(point => <div key={point.timestamp} className="flex items-center justify-center">{point.temperature}°</div>)}</div>
    <div className="pointer-events-none absolute inset-0 z-30 grid" style={grid}>{points.map(point => <div key={point.timestamp} className="relative"><span className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[15px] leading-[16px] text-[#7b838b]" style={{ top: ROW.icons + ROW.temperature - 8 }}>{point.dewPoint}°</span></div>)}</div>
  </div>;
}
function dayGroups() {
  return points.reduce<Array<{ label: string; count: number }>>((groups, point) => {
    const date = new Date(`${point.timestamp.slice(0, 10)}T12:00:00Z`);
    const label = `${DAY_NAMES[date.getUTCDay()]} ${point.timestamp.slice(8, 10)}`;
    const last = groups.at(-1);
    if (last?.label === label) last.count += 1;
    else groups.push({ label, count: 1 });
    return groups;
  }, []);
}

export function Current() {
  const width = points.length * POINT_WIDTH;
  const temperatureMin = Math.min(...points.map(point => point.temperature)) - 2;
  const temperatureMax = Math.max(...points.map(point => point.temperature)) + 1;
  const temperatureY = (value: number) => 7 + (1 - (value - temperatureMin) / (temperatureMax - temperatureMin)) * 85;
  const temperaturePoints = points.map((point, index) => [index * POINT_WIDTH + POINT_WIDTH / 2, temperatureY(point.temperature)] as [number, number]);
  const dewBoundaryPoints = points.map((point, index) => [index * POINT_WIDTH + POINT_WIDTH / 2, temperatureY(point.dewPoint)] as [number, number]);
  const temperatureArea = `${smoothPath([[0, temperaturePoints[0][1]], ...temperaturePoints, [width, temperaturePoints.at(-1)![1]]])} L ${width} ${dewBoundaryPoints.at(-1)![1]} ${smoothPath([...dewBoundaryPoints].reverse()).replace(/^M /, "L ")} L 0 ${dewBoundaryPoints[0][1]} Z`;
  const pressureMin = Math.min(...points.map(point => point.pressure));
  const pressureMax = Math.max(...points.map(point => point.pressure));
  const pressureY = (value: number) => 8 + (1 - (value - pressureMin) / (pressureMax - pressureMin)) * (ROW.pressure - 16);
  const pressurePoints = points.map((point, index) => [index * POINT_WIDTH + POINT_WIDTH / 2, pressureY(point.pressure)] as [number, number]);
  const pressureExtrema = points.flatMap((point, index) => {
    if (index === 0 || index === points.length - 1) return [];
    const previous = points[index - 1].pressure;
    const next = points[index + 1].pressure;
    const isMaximum = point.pressure > previous && point.pressure > next;
    const isMinimum = point.pressure < previous && point.pressure < next;
    return isMaximum || isMinimum ? [{ point, index, isMaximum }] : [];
  });
  const days = dayGroups();
  const dailyRainSummaries = points.reduce<Array<{ key: string; startIndex: number; count: number; maxRain: number }>>((summaries, point, index) => {
    const key = point.timestamp.slice(0, 10);
    const last = summaries.at(-1);
    if (last?.key === key) {
      last.count += 1;
      last.maxRain = Math.max(last.maxRain, point.rain);
    } else {
      summaries.push({ key, startIndex: index, count: 1, maxRain: point.rain });
    }
    return summaries;
  }, []).filter(summary => summary.maxRain > 0);
  const dayBoundaryIndices = points.reduce<number[]>((indices, point, index) => {
    if (index > 0 && point.timestamp.slice(0, 10) !== points[index - 1].timestamp.slice(0, 10)) indices.push(index);
    return indices;
  }, []);
  const rainTestStartIndex = points.findIndex(point => point.timestamp.slice(8, 10) === "29" && point.timestamp.slice(11, 13) === "20");
  const rainColumns = points.flatMap((point, index) => index === rainTestStartIndex || point.rain <= 0
    ? []
    : [{ key: point.timestamp, x: point.timestamp.slice(11, 13) === "23"
      ? index * POINT_WIDTH + POINT_WIDTH / 6
      : index * POINT_WIDTH + POINT_WIDTH / 2, rain: point.rain, showLabel: true }]
  );
  if (rainTestStartIndex >= 0) {
    const testValues = [.4, .8, 1.4];
    const highestTestRain = Math.max(...testValues);
    testValues.forEach((rain, hourOffset) => {
      rainColumns.push({
        key: `hourly-rain-${20 + hourOffset}`,
        x: rainTestStartIndex * POINT_WIDTH + (hourOffset + .5) * POINT_WIDTH / 3,
        rain,
        showLabel: rain === highestTestRain,
      });
    });
  }
  const grid = { gridTemplateColumns: `repeat(${points.length}, ${POINT_WIDTH}px)` };

  return <div className="meteogram-current overflow-hidden bg-[#f5f6f8] text-[#30353a]">
    <div className="flex min-w-0">
      <aside className="w-[108px] shrink-0 border-r border-[#cbd0d6] bg-[#eceff2] text-[11px] leading-[14px] text-[#7a7e82] md:w-[116px]">
        <div style={{ height: ROW.day }} />
        <div style={{ height: ROW.hours }} className="flex items-center justify-end gap-2 pr-2"><span>Stunden</span><AxisGlyph kind="clock" /></div>
        <div style={{ height: ROW.icons + ROW.temperature + ROW.dew }} className="flex items-center justify-end gap-2 pr-2">
          <span className="text-right text-[12px] leading-[15px]"><span className="text-[#a85e42]">Temperatur</span><br />Taupunkt</span>
          <AxisGlyph kind="temperature" />
        </div>
        <div style={{ height: ROW.pressure }} className="flex items-center justify-end gap-2 pr-2">
          <span className="text-right text-[12px] leading-[15px]">Druck<br /><span className="text-[#3275a0]">Regen</span></span>
          <AxisGlyph kind="pressure" />
        </div>
      </aside>
      <div className="meteogram-current__scroll min-w-0 flex-1 overflow-x-auto"><div className="relative" style={{ minWidth: width }}>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-0 flex" style={{ top: ROW.day }}>{points.map(point => <div key={point.timestamp} className={point.isDay ? "bg-[#fafbfc]" : "bg-[#eaecf7]"} style={{ width: POINT_WIDTH }} />)}</div>
        <div className="relative z-10">
          <div className="grid bg-[#f7f8fa] text-[14px] font-medium tracking-[.03em] text-[#555c63]" style={{ height: ROW.day, ...grid }}>{days.map(day => <div key={day.label} className="flex items-center border-r border-[#d5d9de] pl-3" style={{ gridColumn: `span ${day.count}` }}><span className="whitespace-nowrap">{day.label}</span></div>)}</div>
          <div className="grid text-[15px] text-[#717880]" style={{ height: ROW.hours, ...grid }}>{points.map(point => <div key={point.timestamp} className="flex items-center justify-center">{Number(point.timestamp.slice(11, 13))}</div>)}</div>
          <TemperatureDewSection points={points} width={width} grid={grid} temperatureArea={temperatureArea} dewBoundaryPoints={dewBoundaryPoints} />
          <div className="relative" style={{ height: ROW.pressure }}>
            <svg viewBox={`0 0 ${width} ${ROW.pressure}`} width={width} height={ROW.pressure} className="absolute inset-0">
              <defs><linearGradient id="current-pressure-fill" x1="0" x2="0" y1="0" y2={ROW.pressure} gradientUnits="userSpaceOnUse"><stop offset="0%" stopColor="#8baec0" stopOpacity=".3" /><stop offset="100%" stopColor="#cfe0e8" stopOpacity=".08" /></linearGradient></defs>
              <path d={`${smoothPath([[0, pressurePoints[0][1]], ...pressurePoints, [width, pressurePoints.at(-1)![1]]])} L ${width} ${ROW.pressure} L 0 ${ROW.pressure} Z`} fill="url(#current-pressure-fill)" />
              {rainColumns.map(({ key, x, rain, showLabel }) => {
                const height = Math.max(1, Math.min(rain, MAX_RAIN_MM) / MAX_RAIN_MM * (ROW.pressure - 12));
                return <g key={key}>
                  <rect x={x - 5} y={ROW.pressure - height - 4} width="10" height={height} fill="#0968d2" />
                  {showLabel && <text x={x} y={Math.max(11, ROW.pressure - height - 8)} textAnchor="middle" fontSize="9" fontWeight="700" fill="#1266c5">{rain.toFixed(1)}mm</text>}
                </g>;
              })}
              <path d={smoothPath(pressurePoints)} fill="none" stroke="#587b90" strokeWidth="1.8" strokeLinecap="round" />
              {pressureExtrema.map(({ point, index, isMaximum }) => {
                const curveY = pressureY(point.pressure);
                const preferredY = curveY + (isMaximum ? -7 : 14);
                const labelY = preferredY > ROW.pressure - 8 ? curveY - 8 : Math.max(16, preferredY);
                const x = index * POINT_WIDTH + POINT_WIDTH / 2;
                return <g key={point.timestamp}>
                  <rect x={x - 20} y={labelY - 10} width="40" height="12" rx="2" fill="#f7f8fa" fillOpacity=".94" />
                  <text x={x} y={labelY} textAnchor="middle" fontSize="8" fontWeight="700" fill="#4d6979">{point.pressure} hPa</text>
                </g>;
              })}
            </svg>
            {dailyRainSummaries.map(summary => <div key={summary.key} className="pointer-events-none absolute top-1.5 z-20 rounded-[4px] bg-[#0869d8] px-1 py-0.5 text-[9px] font-bold leading-[12px] text-white shadow-[0_1px_2px_rgba(0,45,120,.22)]" style={{ left: (summary.startIndex + summary.count - 1) * POINT_WIDTH + 4 }}>{summary.maxRain.toFixed(1)}mm</div>)}
          </div>
         </div>
         {dayBoundaryIndices.map(index => <div key={index} className="pointer-events-none absolute inset-y-0 z-10 border-l border-[#b6bec5]" style={{ left: index * POINT_WIDTH }} />)}
         <div className="pointer-events-none absolute z-20 border-l border-dashed border-[#bd8d8d]/75" style={{ left: 4 * POINT_WIDTH + POINT_WIDTH / 2, top: ROW.day, bottom: 0 }} />
      </div></div>
    </div>
  </div>;
}