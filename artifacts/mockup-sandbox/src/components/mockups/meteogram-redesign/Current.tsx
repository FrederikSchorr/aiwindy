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
const ROW = { day: 43, hours: 34, icons: 50, temperature: 42, dew: 31, clouds: 210, base: 35 };
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

function smoothPath(values: Array<[number, number]>) {
  return values.reduce((path, [x, y], index) => {
    if (!index) return `M ${x} ${y}`;
    const [previousX, previousY] = values[index - 1];
    const middle = (previousX + x) / 2;
    return `${path} C ${middle} ${previousY}, ${middle} ${y}, ${x} ${y}`;
  }, "");
}
function cloudSegmentPath(massIndex: number, index: number) {
  const left = points[index].clouds[massIndex];
  const right = points[index + 1].clouds[massIndex];
  const chartHeight = ROW.clouds;
  const y = (altitude: number) => chartHeight - (altitude / 9) * chartHeight;
  const x1 = index * POINT_WIDTH;
  const x2 = (index + 1) * POINT_WIDTH;
  const top1 = y(left.top);
  const top2 = y(right.top);
  const bottom1 = y(left.bottom);
  const bottom2 = y(right.bottom);
  return {
    d: `M ${x1} ${top1} C ${x1 + POINT_WIDTH * .28} ${top1}, ${x2 - POINT_WIDTH * .28} ${top2}, ${x2} ${top2} L ${x2} ${bottom2} C ${x2 - POINT_WIDTH * .28} ${bottom2}, ${x1 + POINT_WIDTH * .28} ${bottom1}, ${x1} ${bottom1} Z`,
    opacity: (left.opacity + right.opacity) / 2,
  };
}
function temperatureColor(value: number) {
  if (value < 8) return "#42bfd0";
  if (value < 16) return "#a8d66d";
  if (value < 23) return "#f3c66d";
  return "#ed6a8d";
}
function weatherIcon(point: Point) {
  const stroke = point.cloudType === "stratus" ? "#d59b24" : "#7e858b";
  if (point.cloudType === "clear") return <svg viewBox="0 0 32 32" className="h-9 w-9" aria-hidden="true"><circle cx="16" cy="16" r="7" fill="#f4b400" /><g stroke="#e5a500" strokeWidth="2.3" strokeLinecap="round"><path d="M16 3v4M16 25v4M3 16h4M25 16h4M6.8 6.8l2.8 2.8M22.4 22.4l2.8 2.8M25.2 6.8l-2.8 2.8M9.6 22.4l-2.8 2.8" /></g></svg>;
  return <svg viewBox="0 0 36 32" className="h-9 w-10" aria-hidden="true"><circle cx="11" cy="10" r="5" fill="#f4b400" /><path d="M4 21h25a5 5 0 0 0 0-10h-4a7 7 0 0 0-13-1 5.5 5.5 0 0 0-5 5Z" fill={stroke} fillOpacity=".25" stroke={stroke} strokeWidth="1.7" />{point.rain > 0 && <path d="M12 25l-2 4M19 25l-2 4M26 25l-2 4" stroke="#2278a7" strokeWidth="2" strokeLinecap="round" />}</svg>;
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
  const temperatureMax = Math.max(...points.map(point => point.temperature)) + 2;
  const temperatureY = (value: number) => 7 + (1 - (value - temperatureMin) / (temperatureMax - temperatureMin)) * 85;
  const temperaturePoints = points.map((point, index) => [index * POINT_WIDTH + POINT_WIDTH / 2, temperatureY(point.temperature)] as [number, number]);
  const temperaturePath = smoothPath(temperaturePoints);
  const temperatureArea = `${smoothPath([[0, temperaturePoints[0][1]], ...temperaturePoints, [width, temperaturePoints.at(-1)![1]]])} L ${width} 92 L 0 92 Z`;
  const pressureMin = Math.min(...points.map(point => point.pressure)) - 3;
  const pressureMax = Math.max(...points.map(point => point.pressure)) + 3;
  const pressurePoints = points.map((point, index) => [index * POINT_WIDTH + POINT_WIDTH / 2, 15 + (1 - (point.pressure - pressureMin) / (pressureMax - pressureMin)) * 180] as [number, number]);
  const days = dayGroups();
  const grid = { gridTemplateColumns: `repeat(${points.length}, ${POINT_WIDTH}px)` };

  return <div className="meteogram-current overflow-hidden border border-[#cbd0d6] bg-[#f5f6f8] text-[#30353a] shadow-[0_8px_24px_rgba(38,47,57,.1)]">
    <header className="flex flex-col gap-2 border-b border-[#cbd0d6] bg-[#f1f3f5] px-4 py-3 sm:flex-row sm:items-end sm:justify-between">
      <div><div className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#737b84]">Windy-Referenz · 2 Tage</div><h1 className="text-[23px] font-medium tracking-[-.025em] text-[#343a40]">Weiden am See</h1><p className="text-[11px] text-[#7a828a]">Screenshot-Daten · Samstag 29 bis Sonntag 30</p></div>
      <div className="flex gap-1.5 text-[10px] font-semibold text-[#64707a]"><span className="border border-[#c7cdd2] bg-white px-2 py-1">Referenzdaten</span><span className="border border-[#a9cde1] bg-[#e3f0f8] px-2 py-1 text-[#27678d]">Tagessumme 2.2mm</span></div>
    </header>
    <div className="border-b border-[#d3d7dc] bg-[#fafbfc] px-4 py-1.5 text-[10px] text-[#7a828a]"><strong className="text-[#555d65]">Lesart:</strong> Farben und Wolkenflächen zeigen den prognostizierten Verlauf. Wolkentypen sind heuristische Modelldaten.</div>
    <div className="flex min-w-0">
      <aside className="w-[112px] shrink-0 border-r border-[#cbd0d6] bg-[#eceff2] text-[10px] leading-[12px] text-[#737b82] md:w-[176px]">
        <div style={{ height: ROW.day }} className="flex flex-col justify-center border-b border-[#d4d8dc] px-3"><b className="truncate text-[12px] text-[#4a5158]">Weiden am See</b><span className="truncate text-[9px]">Europe/Vienna · 9 Werte</span><a className="mt-1 w-fit text-[9px] font-semibold underline" href="https://open-meteo.com/">Open-Meteo ↗</a></div>
        <div style={{ height: ROW.hours }} className="flex items-center justify-center border-b border-[#d4d8dc] font-semibold">Stunden</div>
        <div style={{ height: ROW.icons }} className="flex items-center justify-center border-b border-[#d4d8dc]">Wetter</div>
        <div style={{ height: ROW.temperature }} className="flex items-center justify-center border-b border-[#d4d8dc] text-[#a85e42]">Temperatur<br />°C</div>
        <div style={{ height: ROW.dew }} className="flex items-center justify-center border-b border-[#d4d8dc]">Taupunkt</div>
        <div style={{ height: ROW.clouds }} className="relative"><div className="absolute inset-y-0 left-0 flex w-1/2 flex-col items-center justify-center text-center text-[10px] md:text-[12px]"><span>Wolken</span><span className="text-[#3275a0]">Regen</span><span className="text-[#3275a0]">· Druck</span><span className="text-[9px]">mm · hPa</span></div><div className="absolute inset-y-0 right-0 flex w-1/2 flex-col">{BANDS.map(band => <div key={band.key} className="flex flex-1 flex-col items-center justify-center border-b border-[#d7dbe0] text-center last:border-0"><b className="text-[9px] text-[#5d666e] md:text-[10px]">{band.label}</b><span className="text-[8px] text-[#858c93] md:text-[9px]">{band.altitude}</span></div>)}</div></div>
        <div style={{ height: ROW.base }} className="flex items-center justify-center bg-[#dff1df] px-2 text-center">Wolkenbasis <u>m</u></div>
      </aside>
      <div className="meteogram-current__scroll min-w-0 flex-1 overflow-x-auto"><div className="relative" style={{ minWidth: width }}>
        <div className="pointer-events-none absolute inset-0 z-10 flex">{points.map((point, index) => <div key={point.timestamp} className={point.isDay ? "" : "bg-[#63709b]/[.075]"} style={{ width: POINT_WIDTH }} />)}</div>
        <div className="relative z-0">
          <div className="grid border-b border-[#d5d9de] bg-[#f7f8fa] text-[15px] font-medium tracking-[.03em] text-[#555c63]" style={{ height: ROW.day, ...grid }}>{days.map((day, index) => <div key={day.label} className="flex items-center gap-3 border-r border-[#d5d9de] pl-4" style={{ gridColumn: `span ${day.count}` }}><span>{day.label}</span>{index === 0 && <span className="rounded-full bg-[#d7c400] px-2 py-0.5 text-[11px] font-bold text-white">60%</span>}</div>)}</div>
          <div className="grid border-b border-[#d5d9de] bg-[#fafbfc] text-[16px] text-[#717880]" style={{ height: ROW.hours, ...grid }}>{points.map(point => <div key={point.timestamp} className="flex items-center justify-center">{Number(point.timestamp.slice(11, 13))}</div>)}</div>
          <div className="relative border-b border-[#d5d9de]" style={{ height: ROW.icons + ROW.temperature }}><svg viewBox={`0 0 ${width} 92`} width={width} height="92" className="pointer-events-none absolute inset-0"><defs><linearGradient id="current-temperature" x2={width} gradientUnits="userSpaceOnUse"><stop offset="0%" stopColor={temperatureColor(points[0].temperature)} />{points.map((point, index) => <stop key={point.timestamp} offset={`${index / (points.length - 1) * 100}%`} stopColor={temperatureColor(point.temperature)} />)}</linearGradient></defs><path d={temperatureArea} fill="url(#current-temperature)" fillOpacity=".56" /><path d={temperaturePath} fill="none" stroke="url(#current-temperature)" strokeWidth="2.4" strokeLinecap="round" /><line x1="0" x2={width} y1={ROW.icons} y2={ROW.icons} stroke="#aeb6be" strokeOpacity=".3" strokeDasharray="2 4" /></svg><div className="relative grid" style={{ height: ROW.icons, ...grid }}>{points.map(point => <div key={point.timestamp} className="flex items-center justify-center" title={`${point.cloudType} · Regen ${point.rain.toFixed(1)} mm`}>{weatherIcon(point)}</div>)}</div><div className="relative grid text-[21px] font-medium text-[#20252a]" style={{ height: ROW.temperature, ...grid }}>{points.map(point => <div key={point.timestamp} className="flex items-center justify-center">{point.temperature}°</div>)}</div></div>
          <div className="grid border-b border-[#d5d9de] bg-[#fafbfc] text-[15px] text-[#7b838b]" style={{ height: ROW.dew, ...grid }}>{points.map(point => <div key={point.timestamp} className="flex items-center justify-center">{point.dewPoint}°</div>)}</div>
          <div className="relative border-b border-[#d5d9de] bg-[#f7f8fa]" style={{ height: ROW.clouds }}>
            <svg viewBox={`0 0 ${width} ${ROW.clouds}`} width={width} height={ROW.clouds} className="absolute inset-0">
              <defs>
                <filter id="current-cloud-soften" x="-12%" y="-14%" width="124%" height="128%"><feGaussianBlur stdDeviation="4.2" /></filter>
                <linearGradient id="current-cloud-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#59636a" stopOpacity=".72" /><stop offset="55%" stopColor="#737c82" stopOpacity=".45" /><stop offset="100%" stopColor="#8c9498" stopOpacity=".16" /></linearGradient>
              </defs>
              {BANDS.map((band, bandIndex) => <g key={band.key}><rect x="0" y={bandIndex * 70} width={width} height="70" fill={bandIndex % 2 ? "#fafbfc" : "#f5f6f8"} fillOpacity=".45" /><line x2={width} y1={bandIndex * 70} y2={bandIndex * 70} stroke="#89929b" strokeOpacity=".18" strokeDasharray="5 5" /></g>)}
              {[9, 6, 4.5, 3.5, 1.5, .5].map(altitude => { const y = ROW.clouds - altitude / 9 * ROW.clouds; return <g key={altitude}><line x1="0" x2={width} y1={y} y2={y} stroke="#7e8992" strokeOpacity=".2" strokeDasharray="7 6" /><text x="5" y={Math.max(11, y - 4)} fontSize="10" fill="#74808a" stroke="#f7f8fa" strokeWidth="3" paintOrder="stroke">{altitude}km</text></g>; })}
              {([0, 1] as const).map(massIndex => points.slice(0, -1).map((_, index) => { const segment = cloudSegmentPath(massIndex, index); return <path key={`${massIndex}-${index}`} data-cloud-vertical-overlap="true" d={segment.d} fill={massIndex === 0 ? "url(#current-cloud-fill)" : "#626d73"} opacity={segment.opacity} filter="url(#current-cloud-soften)" />; }))}
              {points.slice(0, -1).map((_, index) => { const segment = cloudSegmentPath(0, index); return <path key={`core-${index}`} d={segment.d} fill="#505a60" opacity={segment.opacity * .23} transform={`translate(0 ${10 + Math.sin(index) * 4}) scale(1 .7)`} transformOrigin={`${index * POINT_WIDTH + POINT_WIDTH / 2}px ${ROW.clouds / 2}px`} filter="url(#current-cloud-soften)" />; })}
            </svg>
            <svg viewBox={`0 0 ${width} ${ROW.clouds}`} width={width} height={ROW.clouds} className="absolute inset-0">
              <path d={smoothPath(pressurePoints)} fill="none" stroke="#587b90" strokeWidth="1.5" />
              {points.map((point, index) => { const height = point.rain ? Math.max(3, point.rain / .5 * 55) : 0; return <g key={point.timestamp}>{point.rain > 0 && <text x={index * POINT_WIDTH + POINT_WIDTH / 2} y={ROW.clouds - height - 7} textAnchor="middle" fontSize="10" fontWeight="700" fill="#1266c5" stroke="#f7f8fa" strokeWidth="3" paintOrder="stroke">{point.rain.toFixed(1)}mm</text>}<rect x={index * POINT_WIDTH + (POINT_WIDTH - 9) / 2} y={ROW.clouds - height - 6} width="9" height={height} fill={index === 0 ? "#ae31cc" : "#1268d0"} /></g>; })}
            </svg>
            <div className="absolute right-3 top-1.5 rounded-[4px] bg-[#0869d8] px-2 py-1 text-[11px] font-bold text-white">2.2mm</div>
          </div>
          <div className="grid bg-[#dff1df] text-[15px] font-medium text-[#5c6d61]" style={{ height: ROW.base, ...grid }}>{points.map(point => <div key={point.timestamp} className="flex items-center justify-center">{point.cloudBase}</div>)}</div>
        </div>
        <div className="pointer-events-none absolute z-20 border-l border-dashed border-[#bd8d8d]/75" style={{ left: 4 * POINT_WIDTH + POINT_WIDTH / 2, top: ROW.day, bottom: 0 }}><span className="absolute -top-3.5 -translate-x-1/2 rounded-[2px] bg-[#536b73] px-1.5 py-0.5 text-[8px] font-bold text-white">JETZT</span></div>
      </div></div>
    </div>
    <footer className="flex justify-between border-t border-[#cbd0d6] bg-[#f1f3f5] px-4 py-2 text-[10px] text-[#7a828a]"><span><b className="text-[#5a646d]">Hinweis:</b> Wolkentypen und Wolkenhöhen sind modellbasierte Heuristiken, keine Beobachtungen.</span><span>Quelle: <u>Open-Meteo</u></span></footer>
  </div>;
}