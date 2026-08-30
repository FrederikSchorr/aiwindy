import React from "react";
import "./_group.css";

type CloudBand = "high" | "mid" | "low";
type CloudMass = { top: number; bottom: number; opacity: number };
type Point = {
  timestamp: string;
  temperature: number;
  dewPoint: number;
  pressure: number;
  rain: number;
  cloudBase: string;
  cloudType: "clear" | "cirrus" | "stratus" | "cumulus" | "mixed";
  isDay: boolean;
  clouds: [CloudMass, CloudMass];
};

const POINT_WIDTH = 80;
const ROW = { day: 43, hours: 34, icons: 48, temperature: 42, dew: 30, clouds: 210, base: 35 };
const BANDS: Array<{ key: CloudBand; label: string; altitude: string }> = [
  { key: "high", label: "HOCH", altitude: "6–13 km" },
  { key: "mid", label: "MITTEL", altitude: "2–6 km" },
  { key: "low", label: "TIEF", altitude: "0–2 km" },
];
const DAY_NAMES = ["SONNTAG", "MONTAG", "DIENSTAG", "MITTWOCH", "DONNERSTAG", "FREITAG", "SAMSTAG"];
const screenshotData = [
  { hour: 2, temperature: 21, dewPoint: 18, pressure: 1014, rain: .5, cloudBase: "1900", clouds: [{ top: 3.2, bottom: .7, opacity: .32 }, { top: 1.1, bottom: .25, opacity: .18 }] },
  { hour: 5, temperature: 19, dewPoint: 15, pressure: 1015, rain: 0, cloudBase: "10k", clouds: [{ top: 3.7, bottom: 1.0, opacity: .28 }, { top: 1.6, bottom: .3, opacity: .14 }] },
  { hour: 8, temperature: 21, dewPoint: 14, pressure: 1017, rain: 0, cloudBase: "4000", clouds: [{ top: 4.0, bottom: 1.3, opacity: .38 }, { top: 2.0, bottom: .55, opacity: .18 }] },
  { hour: 11, temperature: 22, dewPoint: 13, pressure: 1018, rain: 0, cloudBase: "3600", clouds: [{ top: 5.3, bottom: .8, opacity: .67 }, { top: 2.1, bottom: .65, opacity: .32 }] },
  { hour: 14, temperature: 26, dewPoint: 13, pressure: 1019, rain: .3, cloudBase: "3300", clouds: [{ top: 6.0, bottom: .45, opacity: .82 }, { top: 2.9, bottom: .4, opacity: .48 }] },
  { hour: 17, temperature: 26, dewPoint: 12, pressure: 1020, rain: 0, cloudBase: "--", clouds: [{ top: 4.0, bottom: 1.5, opacity: .54 }, { top: 2.5, bottom: .8, opacity: .32 }] },
  { hour: 20, temperature: 23, dewPoint: 12, pressure: 1021, rain: 0, cloudBase: "2700", clouds: [{ top: 3.0, bottom: 1.0, opacity: .48 }, { top: 2.0, bottom: .55, opacity: .28 }] },
  { hour: 23, temperature: 21, dewPoint: 11, pressure: 1022, rain: 0, cloudBase: "8600", clouds: [{ top: 2.7, bottom: 1.1, opacity: .5 }, { top: 1.8, bottom: .7, opacity: .28 }] },
  { hour: 2, temperature: 20, dewPoint: 12, pressure: 1023, rain: 0, cloudBase: "6100", clouds: [{ top: 2.8, bottom: 1.2, opacity: .48 }, { top: 1.9, bottom: .8, opacity: .25 }] },
] as const;
const points: Point[] = screenshotData.map((entry, index) => {
  const date = new Date(Date.UTC(2026, 7, index < 8 ? 29 : 30, entry.hour));
  return {
    timestamp: date.toISOString().slice(0, 19),
    temperature: entry.temperature,
    dewPoint: entry.dewPoint,
    pressure: entry.pressure,
    rain: entry.rain,
    cloudBase: entry.cloudBase,
    cloudType: index === 0 || index === 1 ? "mixed" : index === 4 ? "cumulus" : "stratus",
    isDay: entry.hour >= 6 && entry.hour < 21,
    clouds: entry.clouds,
  };
});
const rainBars = [
  { x: 167, height: 48, color: "#0968d2" },
  { x: 207, height: 25, color: "#0968d2" },
  { x: 437, height: 46, color: "#0968d2" },
  { x: 477, height: 70, color: "#0968d2" },
];
const cloudShapes = [
  { d: "M0 10 C48 3 90 7 132 19 C174 29 207 18 244 8 L244 0 L0 0 Z", fill: "#7d858a", opacity: .13, blur: "url(#current-cloud-soften)" },
  { d: "M0 52 C28 44 47 38 66 46 C87 57 84 84 104 99 C124 112 156 100 169 119 C186 145 157 170 180 192 C143 203 104 198 78 184 C49 168 43 139 22 123 C8 111 2 84 0 52 Z", fill: "#737b80", opacity: .28, blur: "url(#current-cloud-soften)" },
  { d: "M103 71 C132 61 153 69 176 88 C197 105 221 101 239 84 C254 69 247 52 265 44 C286 34 302 56 304 80 C306 104 328 113 350 106 C386 96 422 109 453 124 C473 134 483 147 474 158 C444 166 412 154 379 153 C346 151 320 163 288 157 C253 151 232 128 204 130 C166 133 128 132 103 115 C91 106 91 83 103 71 Z", fill: "#646d72", opacity: .34, blur: "url(#current-cloud-soften)" },
  { d: "M242 82 C247 52 252 25 273 20 C297 16 312 47 310 76 C308 105 333 116 356 114 C336 134 307 145 278 137 C251 130 234 108 242 82 Z", fill: "#4f585d", opacity: .5, blur: "url(#current-cloud-core)" },
  { d: "M291 133 C326 122 351 127 369 145 C384 160 405 162 421 147 C433 135 454 137 466 151 C481 169 469 184 445 187 C407 192 378 179 347 184 C323 188 302 178 291 164 C283 154 282 140 291 133 Z", fill: "#727b80", opacity: .3, blur: "url(#current-cloud-soften)" },
  { d: "M380 119 C418 113 455 120 486 137 C507 148 531 151 551 141 C570 131 603 132 622 148 C641 165 629 181 602 187 C565 194 537 180 503 181 C473 182 443 169 416 159 C393 151 379 137 380 119 Z", fill: "#70787d", opacity: .31, blur: "url(#current-cloud-soften)" },
  { d: "M489 135 C505 121 526 119 542 132 C553 141 554 158 543 168 C527 180 499 177 485 163 C476 154 479 143 489 135 Z", fill: "#50595e", opacity: .42, blur: "url(#current-cloud-core)" },
  { d: "M548 123 C577 112 615 114 637 130 C657 145 656 164 635 174 C609 186 568 180 546 163 C531 151 532 133 548 123 Z", fill: "#525b60", opacity: .38, blur: "url(#current-cloud-core)" },
  { d: "M606 15 C643 5 683 7 720 19 L720 70 C690 70 671 52 646 48 C626 45 611 32 606 15 Z", fill: "#6a7378", opacity: .23, blur: "url(#current-cloud-soften)" },
];

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
function weatherIcon(point: Point) {
  const cloudStroke = point.rain > 0 ? "#6f818c" : "#7e858b";
  const cloudFill = point.rain > 0 ? "#9eabb2" : "#b3bdc1";
  const skyObject = point.isDay
    ? <g stroke="#e6a800" strokeWidth="1.5" strokeLinecap="round"><circle cx="14" cy="11" r="5.2" fill="#f5bd22" stroke="none" /><path d="M14 2.5v3M14 16.5v3M5.5 11h3M19.5 11h3M8 5l2.1 2.1M17.9 13.9 20 16M20 5l-2.1 2.1M10.1 13.9 8 16" /></g>
    : <path d="M18.5 5.2a7.1 7.1 0 1 0 5.3 11.8 7.8 7.8 0 0 1-5.3-11.8Z" fill="#91a7bb" stroke="#71889b" strokeWidth="1.1" />;
  return <svg viewBox="0 0 48 40" className="h-9 w-11" aria-hidden="true">
    {skyObject}
    <path d="M7 27.2h28.6a6.3 6.3 0 0 0 .1-12.6 10.3 10.3 0 0 0-19-1.6A7.2 7.2 0 0 0 7 27.2Z" fill={cloudFill} stroke={cloudStroke} strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M10 27.2h26.5a4.4 4.4 0 0 1-4.2 3H12.5a4.5 4.5 0 0 1-2.5-3Z" fill="#d3dade" fillOpacity=".72" />
    {point.rain > 0 && <g stroke="#2779a7" strokeWidth="1.8" strokeLinecap="round"><path d="m14 32-2 4M22 32l-2 4M30 32l-2 4" /></g>}
  </svg>;
}
function TemperatureDewSection({ points, width, grid, temperatureArea, dewBoundaryPoints }: {
  points: Point[];
  width: number;
  grid: React.CSSProperties;
  temperatureArea: string;
  dewBoundaryPoints: Array<[number, number]>;
}) {
  return <div className="relative bg-[#fafbfc]" style={{ height: ROW.icons + ROW.temperature + ROW.dew }}>
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
  const pressureProfile = [151, 140, 105, 82, 102, 115, 127, 111, 96];
  const pressurePoints = pressureProfile.map((y, index) => [index * POINT_WIDTH + POINT_WIDTH / 2, y] as [number, number]);
  const days = dayGroups();
  const grid = { gridTemplateColumns: `repeat(${points.length}, ${POINT_WIDTH}px)` };

  return <div className="meteogram-current overflow-hidden bg-[#f5f6f8] text-[#30353a]">
    <div className="flex min-w-0">
      <aside className="w-[112px] shrink-0 border-r border-[#cbd0d6] bg-[#eceff2] text-[10px] leading-[12px] text-[#737b82] md:w-[176px]">
        <div style={{ height: ROW.day }} className="flex flex-col justify-center px-3"><b className="truncate text-[12px] text-[#4a5158]">Weiden am See</b><span className="truncate text-[9px]">Europe/Vienna · 9 Werte</span><a className="mt-1 w-fit text-[9px] font-semibold underline" href="https://open-meteo.com/">Open-Meteo ↗</a></div>
        <div style={{ height: ROW.hours }} className="flex items-center justify-center font-semibold">Stunden</div>
        <div style={{ height: ROW.icons }} className="flex items-center justify-center">Wetter</div>
        <div style={{ height: ROW.temperature }} className="flex items-center justify-center text-[#a85e42]">Temperatur<br />°C</div>
        <div style={{ height: ROW.dew, transform: "translateY(-15px)" }} className="flex items-center justify-center">Taupunkt</div>
        <div style={{ height: ROW.clouds }} className="flex flex-col items-center justify-center text-center text-[11px] text-[#69737b]"><span>Druck</span><span className="text-[#3275a0]">Regen</span><span className="mt-1 text-[9px]">hPa · mm</span></div>
        <div style={{ height: ROW.base }} className="flex items-center justify-center bg-[#dff1df] px-2 text-center">Wolkenbasis <u>m</u></div>
      </aside>
      <div className="meteogram-current__scroll min-w-0 flex-1 overflow-x-auto"><div className="relative" style={{ minWidth: width }}>
        <div className="pointer-events-none absolute inset-0 z-0 flex">{points.map((point, index) => <div key={point.timestamp} className={point.isDay ? "" : "bg-[#63709b]/[.075]"} style={{ width: POINT_WIDTH }} />)}</div>
        <div className="relative z-10">
          <div className="grid bg-[#f7f8fa] text-[15px] font-medium tracking-[.03em] text-[#555c63]" style={{ height: ROW.day, ...grid }}>{days.map((day, index) => <div key={day.label} className="flex items-center gap-3 border-r border-[#d5d9de] pl-4" style={{ gridColumn: `span ${day.count}` }}><span>{day.label}</span>{index === 0 && <span className="rounded-full bg-[#d7c400] px-2 py-0.5 text-[11px] font-bold text-white">60%</span>}</div>)}</div>
          <div className="grid bg-[#fafbfc] text-[16px] text-[#717880]" style={{ height: ROW.hours, ...grid }}>{points.map(point => <div key={point.timestamp} className="flex items-center justify-center">{Number(point.timestamp.slice(11, 13))}</div>)}</div>
          <TemperatureDewSection points={points} width={width} grid={grid} temperatureArea={temperatureArea} dewBoundaryPoints={dewBoundaryPoints} />
          <div className="relative bg-[#f7f8fa]" style={{ height: ROW.clouds }}>
            <svg viewBox={`0 0 ${width} ${ROW.clouds}`} width={width} height={ROW.clouds} className="absolute inset-0">
              <defs><linearGradient id="current-pressure-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#8baec0" stopOpacity=".26" /><stop offset="100%" stopColor="#cfe0e8" stopOpacity=".08" /></linearGradient></defs>
              <path d={`${smoothPath([[0, pressurePoints[0][1]], ...pressurePoints, [width, pressurePoints.at(-1)![1]]])} L ${width} ${ROW.clouds} L 0 ${ROW.clouds} Z`} fill="url(#current-pressure-fill)" />
              <path d={smoothPath(pressurePoints)} fill="none" stroke="#587b90" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <svg viewBox={`0 0 ${width} ${ROW.clouds}`} width={width} height={ROW.clouds} className="absolute inset-0">
              <path d={smoothPath(pressurePoints)} fill="none" stroke="#587b90" strokeWidth="1.5" />
              {rainBars.map((bar, index) => <rect key={index} x={bar.x} y={ROW.clouds - bar.height - 6} width="13" height={bar.height} fill={bar.color} />)}
              <text x="484" y={ROW.clouds - 76} textAnchor="middle" fontSize="11" fontWeight="700" fill="#1266c5" stroke="#f7f8fa" strokeWidth="3" paintOrder="stroke">0.3mm</text>
            </svg>
             <div className="absolute top-1.5 rounded-[4px] bg-[#0869d8] px-2 py-1 text-[11px] font-bold text-white" style={{ left: 8 * POINT_WIDTH - 64 }}>2.2mm</div>
          </div>
          <div className="grid bg-[#dff1df] text-[15px] font-medium text-[#5c6d61]" style={{ height: ROW.base, ...grid }}>{points.map(point => <div key={point.timestamp} className="flex items-center justify-center">{point.cloudBase}</div>)}</div>
         </div>
         <div className="pointer-events-none absolute inset-y-0 z-10 border-l border-[#b6bec5]" style={{ left: 8 * POINT_WIDTH }} />
        <div className="pointer-events-none absolute z-20 border-l border-dashed border-[#bd8d8d]/75" style={{ left: 4 * POINT_WIDTH + POINT_WIDTH / 2, top: ROW.day, bottom: 0 }}><span className="absolute -top-3.5 -translate-x-1/2 rounded-[2px] bg-[#536b73] px-1.5 py-0.5 text-[8px] font-bold text-white">JETZT</span></div>
      </div></div>
    </div>
  </div>;
}