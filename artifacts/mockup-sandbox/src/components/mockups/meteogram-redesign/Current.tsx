import React from "react";
import "./_group.css";

type CloudBand = "high" | "mid" | "low";
type Point = {
  timestamp: string;
  temperature: number;
  dewPoint: number;
  pressure: number;
  rain: number;
  cloudBase: number;
  cloudType: "clear" | "cirrus" | "stratus" | "cumulus" | "mixed";
  isDay: boolean;
  clouds: Record<CloudBand, number>;
};

const POINT_WIDTH = 60;
const ROW = { day: 43, hours: 34, icons: 50, temperature: 42, dew: 31, clouds: 210, base: 35 };
const BANDS: Array<{ key: CloudBand; label: string; altitude: string }> = [
  { key: "high", label: "HOCH", altitude: "6–13 km" },
  { key: "mid", label: "MITTEL", altitude: "2–6 km" },
  { key: "low", label: "TIEF", altitude: "0–2 km" },
];
const DAY_NAMES = ["SONNTAG", "MONTAG", "DIENSTAG", "MITTWOCH", "DONNERSTAG", "FREITAG", "SAMSTAG"];
const TYPES = ["stratus", "mixed", "cumulus", "cirrus", "stratus", "cumulus"] as const;
const wave = (i: number, center: number, range: number, period: number) => center + Math.sin(i / period) * range;
const points: Point[] = Array.from({ length: 16 }, (_, i) => {
  const date = new Date(Date.UTC(2026, 7, 29, i * 3));
  const timestamp = date.toISOString().slice(0, 19);
  const rain = i === 9 ? .1 : i === 10 ? 2.3 : i === 14 ? .8 : 0;
  const hour = date.getUTCHours();
  return {
    timestamp,
    temperature: Math.round(wave(i, 21, 7, 3.4)),
    dewPoint: Math.round(wave(i, 12, 2, 5.1)),
    pressure: Math.round(wave(i, 1018, 6, 8.2)),
    rain,
    cloudBase: Math.max(250, Math.round(wave(i, 1550, 1100, 4.5) / 50) * 50),
    cloudType: TYPES[Math.floor(i / 3) % TYPES.length],
    isDay: hour >= 6 && hour < 21,
    clouds: {
      low: Math.round(Math.max(5, Math.min(100, wave(i, 52, 43, 2.7)))),
      mid: Math.round(Math.max(0, Math.min(100, wave(i, 44, 40, 4.2)))),
      high: Math.round(Math.max(0, Math.min(100, wave(i, 48, 46, 5.8)))),
    },
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
function cloudAreaPath(band: CloudBand, bandIndex: number, inset: number, lift: number) {
  const top = points.map((point, index) => {
    const pct = point.clouds[band];
    const x = index * POINT_WIDTH + POINT_WIDTH / 2;
    const y = bandIndex * 70 + 54 - pct * lift - inset;
    return [x, y] as [number, number];
  });
  const bottom = points.map((point, index) => {
    const pct = point.clouds[band];
    const x = index * POINT_WIDTH + POINT_WIDTH / 2;
    const y = bandIndex * 70 + 57 - pct * .08 + inset;
    return [x, y] as [number, number];
  });
  return `${smoothPath([[0, bottom[0][1]], ...top, [points.length * POINT_WIDTH, top.at(-1)![1]]])} ${smoothPath([...bottom].reverse()).replace(/^M /, "L ")} Z`;
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
  return <svg viewBox="0 0 36 32" className="h-9 w-10" aria-hidden="true"><circle cx="11" cy="10" r="5" fill="#f4b400" /><path d="M4 21h25a5 5 0 0 0 0-10h-4a7 7 0 0 0-13-1 5.5 5.5 0 0 0-5 5Z" fill={stroke} fillOpacity=".25" stroke={stroke} strokeWidth="1.7" /><path d="M12 25l-2 4M19 25l-2 4M26 25l-2 4" stroke="#2278a7" strokeWidth="2" strokeLinecap="round" /></svg>;
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
      <div><div className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#737b84]">Wettervorhersage · 6 Tage</div><h1 className="text-[23px] font-medium tracking-[-.025em] text-[#343a40]">Weiden am See</h1><p className="text-[11px] text-[#7a828a]">47.925° N · 16.869° E · Ortszeit Europe/Vienna</p></div>
      <div className="flex gap-1.5 text-[10px] font-semibold text-[#64707a]"><span className="border border-[#c7cdd2] bg-white px-2 py-1">Modellprognose</span><span className="border border-[#a9cde1] bg-[#e3f0f8] px-2 py-1 text-[#27678d]">Regen ab DIENSTAG 15:00</span><span className="border border-[#e1b5b5] bg-[#fae5e5] px-2 py-1 text-[#a34848]">Gewitterrisiko</span></div>
    </header>
    <div className="border-b border-[#d3d7dc] bg-[#fafbfc] px-4 py-1.5 text-[10px] text-[#7a828a]"><strong className="text-[#555d65]">Lesart:</strong> Farben und Wolkenflächen zeigen den prognostizierten Verlauf. Wolkentypen sind heuristische Modelldaten.</div>
    <div className="flex min-w-0">
      <aside className="w-[112px] shrink-0 border-r border-[#cbd0d6] bg-[#eceff2] text-[10px] leading-[12px] text-[#737b82] md:w-[176px]">
        <div style={{ height: ROW.day }} className="flex flex-col justify-center border-b border-[#d4d8dc] px-3"><b className="truncate text-[12px] text-[#4a5158]">Weiden am See</b><span className="truncate text-[9px]">Europe/Vienna · 48 Werte</span><a className="mt-1 w-fit text-[9px] font-semibold underline" href="https://open-meteo.com/">Open-Meteo ↗</a></div>
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
          <div className="grid border-b border-[#d5d9de] bg-[#f7f8fa] text-[15px] font-medium tracking-[.03em] text-[#555c63]" style={{ height: ROW.day, ...grid }}>{days.map(day => <div key={day.label} className="flex items-center border-r border-[#d5d9de] pl-4" style={{ gridColumn: `span ${day.count}` }}>{day.label}</div>)}</div>
          <div className="grid border-b border-[#d5d9de] bg-[#fafbfc] text-[16px] text-[#717880]" style={{ height: ROW.hours, ...grid }}>{points.map(point => <div key={point.timestamp} className="flex items-center justify-center">{Number(point.timestamp.slice(11, 13))}</div>)}</div>
          <div className="relative border-b border-[#d5d9de]" style={{ height: ROW.icons + ROW.temperature }}><svg viewBox={`0 0 ${width} 92`} width={width} height="92" className="pointer-events-none absolute inset-0"><defs><linearGradient id="current-temperature" x2={width} gradientUnits="userSpaceOnUse"><stop offset="0%" stopColor={temperatureColor(points[0].temperature)} />{points.map((point, index) => <stop key={point.timestamp} offset={`${index / 15 * 100}%`} stopColor={temperatureColor(point.temperature)} />)}</linearGradient></defs><path d={temperatureArea} fill="url(#current-temperature)" fillOpacity=".56" /><path d={temperaturePath} fill="none" stroke="url(#current-temperature)" strokeWidth="2.4" strokeLinecap="round" /><line x1="0" x2={width} y1={ROW.icons} y2={ROW.icons} stroke="#aeb6be" strokeOpacity=".3" strokeDasharray="2 4" /></svg><div className="relative grid" style={{ height: ROW.icons, ...grid }}>{points.map(point => <div key={point.timestamp} className="flex items-center justify-center" title={`${point.cloudType} · Regen ${point.rain.toFixed(1)} mm`}>{weatherIcon(point)}</div>)}</div><div className="relative grid text-[21px] font-medium text-[#20252a]" style={{ height: ROW.temperature, ...grid }}>{points.map(point => <div key={point.timestamp} className="flex items-center justify-center">{point.temperature}°</div>)}</div></div>
          <div className="grid border-b border-[#d5d9de] bg-[#fafbfc] text-[15px] text-[#7b838b]" style={{ height: ROW.dew, ...grid }}>{points.map(point => <div key={point.timestamp} className="flex items-center justify-center">{point.dewPoint}°</div>)}</div>
          <div className="relative border-b border-[#d5d9de] bg-[#f7f8fa]" style={{ height: ROW.clouds }}><svg viewBox={`0 0 ${width} ${ROW.clouds}`} width={width} height={ROW.clouds} className="absolute inset-0"><defs><filter id="current-cloud-soften" x="-10%" y="-30%" width="120%" height="160%"><feGaussianBlur stdDeviation="3.2" /></filter><linearGradient id="current-cloud-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#56626a" stopOpacity=".2" /><stop offset="100%" stopColor="#7f898f" stopOpacity=".06" /></linearGradient></defs>{BANDS.map((band, bandIndex) => <g key={band.key}><rect x="0" y={bandIndex * 70} width={width} height="70" fill={bandIndex % 2 ? "#fafbfc" : "#f5f6f8"} fillOpacity=".45" /><line x2={width} y1={bandIndex * 70} y2={bandIndex * 70} stroke="#89929b" strokeOpacity=".22" strokeDasharray="5 5" /><path data-cloud-shape-band={band.key} d={cloudAreaPath(band.key, bandIndex, 0, .37)} fill="url(#current-cloud-fill)" filter="url(#current-cloud-soften)" /><path d={cloudAreaPath(band.key, bandIndex, 7, .25)} fill="#5f6a72" opacity=".12" filter="url(#current-cloud-soften)" /></g>)}</svg><svg viewBox={`0 0 ${width} ${ROW.clouds}`} width={width} height={ROW.clouds} className="absolute inset-0"><path d={smoothPath(pressurePoints)} fill="none" stroke="#587b90" strokeWidth="1.5" />{pressurePoints.map(([x, y,], index) => <g key={index}>{index % 6 === 0 && <text x={x} y={Math.max(13, y - 6)} textAnchor="middle" fontSize="10" fill="#466d84" stroke="#f7f8fa" strokeWidth="3" paintOrder="stroke">{points[index].pressure} hPa</text>}</g>)}{points.map((point, index) => { const height = point.rain ? Math.max(3, point.rain / 2.3 * 55) : 0; return <g key={point.timestamp}>{point.rain > 0 && <text x={index * POINT_WIDTH + POINT_WIDTH / 2} y={ROW.clouds - height - 7} textAnchor="middle" fontSize="10" fontWeight="700" fill="#1266c5" stroke="#f7f8fa" strokeWidth="3" paintOrder="stroke">{point.rain.toFixed(1)}mm</text>}<rect x={index * POINT_WIDTH + 25} y={ROW.clouds - height - 6} width="9" height={height} fill="#1268d0" /></g>; })}</svg><div className="absolute right-3 top-1.5 rounded-[4px] bg-[#0869d8] px-2 py-1 text-[11px] font-bold text-white">2.4mm</div></div>
          <div className="grid bg-[#dff1df] text-[15px] font-medium text-[#5c6d61]" style={{ height: ROW.base, ...grid }}>{points.map(point => <div key={point.timestamp} className="flex items-center justify-center">{point.cloudBase}</div>)}</div>
        </div>
        <div className="pointer-events-none absolute z-20 border-l border-dashed border-[#56646d]/75" style={{ left: 8 * POINT_WIDTH + POINT_WIDTH / 2, top: ROW.day, bottom: 0 }}><span className="absolute -top-3.5 -translate-x-1/2 rounded-[2px] bg-[#536b73] px-1.5 py-0.5 text-[8px] font-bold text-white">JETZT</span></div>
      </div></div>
    </div>
    <footer className="flex justify-between border-t border-[#cbd0d6] bg-[#f1f3f5] px-4 py-2 text-[10px] text-[#7a828a]"><span><b className="text-[#5a646d]">Hinweis:</b> Wolkentypen und Wolkenhöhen sind modellbasierte Heuristiken, keine Beobachtungen.</span><span>Quelle: <u>Open-Meteo</u></span></footer>
  </div>;
}