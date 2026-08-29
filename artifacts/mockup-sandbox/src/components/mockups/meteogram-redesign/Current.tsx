import React from "react";
import "./_group.css";

type CloudType = "clear" | "cirrus" | "altostratus" | "stratus" | "cumulus" | "cumulonimbus" | "mixed";
type Point = {
  timestamp: string; temperature: number; dewPoint: number; pressure: number; rain: number;
  precipProbability: number; weatherCode: number; cloudBase: number; cloudType: CloudType;
  isDay: boolean; low: number; mid: number; high: number;
};

const POINT_WIDTH = 64;
const ROW = { day: 48, hours: 38, icons: 54, temperature: 42, temperatureArea: 96, dew: 34, clouds: 216, base: 38 };
const DAY_NAMES = ["SONNTAG", "MONTAG", "DIENSTAG", "MITTWOCH", "DONNERSTAG", "FREITAG", "SAMSTAG"];
const TYPES: CloudType[] = ["stratus", "mixed", "cumulus", "cirrus", "altostratus", "cumulonimbus"];
const wave = (i: number, center: number, range: number, period: number) => center + Math.sin(i / period) * range;

// Fixed data keeps the production analysisJson shape so this isolated preview is representative.
const analysisJson: Record<string, unknown> = (() => {
  const timestamps = Array.from({ length: 16 }, (_, i) => new Date(Date.UTC(2026, 7, 29, i * 3)).toISOString().slice(0, 19));
  const rain = timestamps.map((_, i) => i === 9 ? .1 : i === 10 ? 2.3 : i === 14 ? .8 : 0);
  return { weatherRaw: { openMeteoForecast: { timezone: "Europe/Vienna", city: {
    name: "Weiden am See", coordinates: { lat: 47.925, lon: 16.869 }, url: "https://open-meteo.com/",
    hourly: {
      timestamps, temp2mC: timestamps.map((_, i) => Math.round(wave(i, 21, 7, 3.4))),
      dewPoint2mC: timestamps.map((_, i) => Math.round(wave(i, 12, 2, 5.1))),
      pressureMslHPa: timestamps.map((_, i) => Math.round(wave(i, 1018, 6, 8.2))), rainMm: rain,
      precipProbabilityPct: rain.map(v => v >= 2 ? 90 : v ? 55 : 8),
      weatherCode: rain.map((v, i) => v >= 2 ? 81 : v ? 61 : i % 7 < 2 ? 2 : 1),
      cloudBaseM: timestamps.map((_, i) => Math.max(250, Math.round(wave(i, 1550, 1100, 4.5) / 50) * 50)),
      cloudType: timestamps.map((_, i) => TYPES[Math.floor(i / 3) % TYPES.length]),
      capeJkg: timestamps.map((_, i) => i >= 12 ? 900 : 80),
      isDay: timestamps.map(t => { const h = Number(t.slice(11, 13)); return h >= 6 && h < 21 ? 1 : 0; }),
      cloudCoverLowPct: timestamps.map((_, i) => Math.round(Math.max(5, Math.min(100, wave(i, 52, 43, 2.7))))),
      cloudCoverMidPct: timestamps.map((_, i) => Math.round(Math.max(0, Math.min(100, wave(i, 44, 40, 4.2))))),
      cloudCoverHighPct: timestamps.map((_, i) => Math.round(Math.max(0, Math.min(100, wave(i, 48, 46, 5.8))))),
    },
  } } } };
})();

function pointsFromContract(json: Record<string, unknown>): Point[] {
  const hourly = (((json.weatherRaw as { openMeteoForecast: { city: { hourly: Record<string, unknown[]> } } }).openMeteoForecast.city.hourly));
  return hourly.timestamps.map((timestamp, i) => ({
    timestamp: String(timestamp), temperature: Number(hourly.temp2mC[i]), dewPoint: Number(hourly.dewPoint2mC[i]),
    pressure: Number(hourly.pressureMslHPa[i]), rain: Number(hourly.rainMm[i]), precipProbability: Number(hourly.precipProbabilityPct[i]),
    weatherCode: Number(hourly.weatherCode[i]), cloudBase: Number(hourly.cloudBaseM[i]), cloudType: hourly.cloudType[i] as CloudType,
    isDay: Number(hourly.isDay[i]) === 1, low: Number(hourly.cloudCoverLowPct[i]), mid: Number(hourly.cloudCoverMidPct[i]), high: Number(hourly.cloudCoverHighPct[i]),
  }));
}

function smoothPath(points: Array<[number, number]>) {
  return points.reduce((path, [x, y], i) => !i ? `M ${x} ${y}` : `${path} C ${(points[i - 1][0] + x) / 2} ${points[i - 1][1]}, ${(points[i - 1][0] + x) / 2} ${y}, ${x} ${y}`, "");
}
function color(type: CloudType) { return type === "stratus" ? "#fab219" : type === "cumulonimbus" ? "#d03b3b" : "#898781"; }
function icon(point: Point) {
  const c = color(point.cloudType), rainy = point.weatherCode >= 51;
  if (point.cloudType === "clear") return <svg viewBox="0 0 32 32" className="h-9 w-9"><circle cx="16" cy="16" r="7" fill="#f4b400" /><path d="M16 3v4M16 25v4M3 16h4M25 16h4M6.8 6.8l2.8 2.8M22.4 22.4l2.8 2.8M25.2 6.8l-2.8 2.8M9.6 22.4l-2.8 2.8" stroke="#e7a600" strokeWidth="2.3" strokeLinecap="round" /></svg>;
  return <svg viewBox="0 0 36 32" className="h-9 w-10"><circle cx="11" cy="10" r="5" fill="#f4b400" /><path d="M4 21h24a5 5 0 0 0 0-10h-4a7 7 0 0 0-13-1 5.5 5.5 0 0 0-5 5Z" fill={c} fillOpacity=".24" stroke={c} strokeWidth="1.7" />{point.cloudType === "cumulonimbus" && <path d="m18 13-4 7h4l-2 7 7-10h-4l3-4Z" fill={c} />}{rainy && <path d="M12 25l-2 4M19 25l-2 4M26 25l-2 4" stroke="#6e9db4" strokeWidth="2" strokeLinecap="round" />}</svg>;
}
function tempColor(v: number) { return v < 12 ? "#a7d66d" : v < 18 ? "#f1dd70" : v < 24 ? "#f5a15c" : "#ec5e91"; }
function formatBase(v: number) { return v >= 5000 ? `${Math.round(v / 500) * 500}` : `${Math.round(v / 100) * 100}`; }

export function Current() {
  const points = pointsFromContract(analysisJson), width = points.length * POINT_WIDTH;
  const temps = points.map(p => p.temperature), min = Math.min(...temps) - 2, max = Math.max(...temps) + 2;
  const yTemp = (v: number) => 5 + (1 - (v - min) / (max - min)) * 86;
  const tempPoints = points.map((p, i) => [i * POINT_WIDTH + 32, yTemp(p.temperature)] as [number, number]);
  const tempPath = smoothPath(tempPoints);
  const pressure = points.map(p => p.pressure), pMin = Math.min(...pressure) - 3, pMax = Math.max(...pressure) + 3;
  const pressurePoints = points.map((p, i) => [i * POINT_WIDTH + 32, 10 + (1 - (p.pressure - pMin) / (pMax - pMin)) * 188] as [number, number]);
  const days = points.reduce<Array<{ label: string; count: number }>>((all, point) => {
    const d = new Date(`${point.timestamp.slice(0, 10)}T12:00:00Z`), label = `${DAY_NAMES[d.getUTCDay()]} ${point.timestamp.slice(8, 10)}`;
    const last = all[all.length - 1]; if (last?.label === label) last.count++; else all.push({ label, count: 1 }); return all;
  }, []);
  const grid = { gridTemplateColumns: `repeat(${points.length}, ${POINT_WIDTH}px)` };
  return <div className="meteogram-current overflow-hidden border-y border-slate-300/55 bg-[#f8fafb] text-slate-700">
    <div className="flex">
      <aside className="w-[116px] shrink-0 border-r border-slate-300/60 bg-[#edf1f2] text-[11px] leading-[13px] text-slate-500 md:w-[176px]">
        <div style={{ height: ROW.day }} className="flex flex-col justify-center border-b border-slate-300/50 px-3"><b className="truncate text-[13px] text-slate-800">Weiden am See</b><span className="truncate text-[9px]">Europe/Vienna · 2 Tage · 16 Punkte</span><a className="mt-1 w-fit text-[9px] font-semibold underline" href="https://open-meteo.com/">Open-Meteo ↗</a></div>
        <div style={{ height: ROW.hours }} className="flex items-center justify-center font-semibold">Stunden</div><div style={{ height: ROW.icons }} className="flex items-center justify-center">Wetter</div><div style={{ height: ROW.temperature }} className="flex items-center justify-center font-medium text-[#bd5b2d]">Temperatur</div><div style={{ height: ROW.dew }} className="flex items-center justify-center">Taupunkt</div>
        <div style={{ height: ROW.clouds }} className="relative"><div className="absolute inset-y-0 left-0 flex w-[52%] flex-col items-center justify-center text-center text-[10px]"><span>Wolken, Regen</span><u className="mt-1">mm</u></div><div className="absolute inset-y-0 right-0 flex w-[48%] flex-col">{[["HOCH", "6–13 km"], ["MITTEL", "2–6 km"], ["TIEF", "0–2 km"]].map(([name, alt]) => <div key={name} className="flex flex-1 flex-col items-center justify-center text-center"><b className="text-[10px] tracking-[.04em]">{name}</b><span className="text-[9px]">{alt}</span></div>)}</div></div>
        <div style={{ height: ROW.base }} className="flex items-center justify-center px-2 text-center">Wolkenuntergrenze&nbsp;<u>m</u></div>
      </aside>
      <div className="meteogram-current__scroll min-w-0 flex-1 overflow-x-auto"><div className="relative" style={{ minWidth: width }}>
        <div className="pointer-events-none absolute inset-0 z-10 flex">{points.map((p, i) => <div key={i} className={p.isDay ? "" : "bg-[#6872a3]/[.055]"} style={{ width: POINT_WIDTH }} />)}</div>
        <div className="relative z-0">
          <div className="grid border-b border-slate-300/45 bg-[#f4f6f7]/80 text-[15px] font-semibold tracking-[.055em]" style={{ height: ROW.day, ...grid }}>{days.map((d, i) => <div key={i} className="flex items-center pl-4" style={{ gridColumn: `span ${d.count}` }}>{d.label}</div>)}</div>
          <div className="grid border-b border-slate-300/45 text-[17px] text-slate-500" style={{ height: ROW.hours, ...grid }}>{points.map((p, i) => <div key={i} className="flex items-center justify-center">{p.timestamp.slice(11, 13)}</div>)}</div>
          <div className="relative border-b border-slate-300/45" style={{ height: ROW.temperatureArea }}><svg viewBox={`0 0 ${width} 96`} width={width} height="96" className="absolute inset-0"><defs><linearGradient id="meteogram-current-temperature" x2={width} gradientUnits="userSpaceOnUse">{points.map((p, i) => <stop key={i} offset={`${i / 15 * 100}%`} stopColor={tempColor(p.temperature)} />)}</linearGradient></defs><path d={`${smoothPath([[0, tempPoints[0][1]], ...tempPoints, [width, tempPoints.at(-1)![1]]])} L ${width} 96 L 0 96Z`} fill="url(#meteogram-current-temperature)" fillOpacity=".45" /><path d={tempPath} fill="none" stroke="url(#meteogram-current-temperature)" strokeWidth="2.5" /></svg><div className="relative grid" style={{ height: ROW.icons, ...grid }}>{points.map((p, i) => <div key={i} className="flex items-center justify-center" title={`${p.cloudType} · Regen ${p.rain.toFixed(1)} mm`}>{icon(p)}</div>)}</div><div className="relative grid text-[22px] font-medium text-slate-800" style={{ height: ROW.temperature, ...grid }}>{points.map((p, i) => <div key={i} className="flex items-center justify-center">{Math.round(p.temperature)}°</div>)}</div></div>
          <div className="grid border-b border-slate-300/45 text-[16px] text-slate-500" style={{ height: ROW.dew, ...grid }}>{points.map((p, i) => <div key={i} className="flex items-center justify-center">{Math.round(p.dewPoint)}°</div>)}</div>
          <div className="relative border-b border-slate-300/55" style={{ height: ROW.clouds }}><svg viewBox={`0 0 ${width} 216`} width={width} height="216" className="absolute inset-0"><defs><filter id="meteogram-current-blur"><feGaussianBlur stdDeviation="4.1" /></filter><pattern id="meteogram-current-hatch" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M-2 10L4 4M3 15L15 3" stroke="#53616e" strokeOpacity=".12" /></pattern></defs>{(["high", "mid", "low"] as const).map((band, row) => <g key={band}><line x2={width} y1={row * 72} y2={row * 72} stroke="#7c8791" strokeOpacity=".24" />{points.map((p, i) => { const pct = p[band], h = Math.max(5, Math.min(59, 72 * (.28 + pct / 150))), cy = row * 72 + 72 - h * .55; return <g key={i}><ellipse cx={i * 64 + 32} cy={cy} rx={Math.min(55, 64 * (.64 + pct / 104)) / 2} ry={h / 2} fill="#66737b" opacity={.18 + pct / 420} filter="url(#meteogram-current-blur)" />{pct > 35 && <rect x={i * 64} y={row * 72} width="64" height="72" fill="url(#meteogram-current-hatch)" opacity=".26" />}</g>; })}</g>)}</svg>
            <svg viewBox={`0 0 ${width} 216`} width={width} height="216" className="absolute inset-0">{points.map((p, i) => { const h = p.rain ? Math.max(3, p.rain / 2.3 * 46) : 0, y = 210 - h; return <g key={i}>{p.rain > 0 && <text x={i * 64 + 32} y={y - 6} textAnchor="middle" fontSize="10" fontWeight="700" fill="#1765b4">{p.rain.toFixed(1)}mm</text>}<rect x={i * 64 + 27} y={y} width="10" height={h} fill="#1469d2" /><path d={smoothPath(pressurePoints)} fill="none" stroke="#587b90" strokeWidth="1.55" /></g>; })}</svg>
            <div className="absolute right-[18px] top-2 rounded-[5px] bg-[#0869d8] px-2.5 py-1 text-[11px] font-bold text-white">2.4mm</div></div>
          <div className="grid bg-[#dff2e4] text-[16px] font-medium" style={{ height: ROW.base, ...grid }}>{points.map((p, i) => <div key={i} className="flex items-center justify-center">{formatBase(p.cloudBase)}</div>)}</div>
        </div><div className="pointer-events-none absolute z-20 border-l border-dashed border-slate-600/55" style={{ left: 32, top: ROW.day, bottom: 0 }} /></div></div>
    </div>
  </div>;
}