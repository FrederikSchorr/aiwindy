import React from "react";
import "./_group.css";

type CloudType = "clear" | "cirrus" | "altostratus" | "stratus" | "cumulus" | "cumulonimbus" | "mixed";
type Point = {
  timestamp: string; temperature: number; dewPoint: number; pressure: number; rain: number;
  precipProbability: number; weatherCode: number; cloudBase: number; cloudType: CloudType;
  isDay: boolean; low: number; mid: number; high: number;
};

const POINT_WIDTH = 78;
const DAY_H = 46;
const DAY_NAMES = ["SONNTAG", "MONTAG", "DIENSTAG", "MITTWOCH", "DONNERSTAG", "FREITAG", "SAMSTAG"];
const TYPES: CloudType[] = ["stratus", "mixed", "cumulus", "cirrus", "altostratus", "cumulonimbus"];
const wave = (i: number, center: number, range: number, period: number) => center + Math.sin(i / period) * range;

// The production-shaped fixture is intentionally identical to Current.tsx.
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

const cloudTone = (type: CloudType) => type === "stratus" ? "#bf751c" : type === "cumulonimbus" ? "#b34646" : "#617986";
const tempTone = (v: number) => v < 12 ? "#719d72" : v < 18 ? "#9b8a42" : v < 24 ? "#be7049" : "#b85177";
const baseLabel = (v: number) => v >= 5000 ? `${Math.round(v / 500) * 500}` : `${Math.round(v / 100) * 100}`;
const pathFor = (points: Array<[number, number]>) => points.reduce((path, [x, y], i) => !i ? `M ${x} ${y}` : `${path} C ${(points[i - 1][0] + x) / 2} ${points[i - 1][1]}, ${(points[i - 1][0] + x) / 2} ${y}, ${x} ${y}`, "");

function WeatherGlyph({ point }: { point: Point }) {
  const tone = cloudTone(point.cloudType);
  const rainy = point.weatherCode >= 51;
  return <svg aria-hidden="true" viewBox="0 0 42 34" className="h-8 w-10">
    <circle cx="12" cy="10" r="6" fill="#e4ad42" opacity=".9" />
    <path d="M5 23h27a5.5 5.5 0 0 0 0-11h-4.5A7.5 7.5 0 0 0 13 10a6 6 0 0 0-8 5.7A5.5 5.5 0 0 0 5 23Z" fill={tone} fillOpacity=".2" stroke={tone} strokeWidth="1.7" />
    {point.cloudType === "cumulonimbus" && <path d="m23 14-4 8h4l-2 7 7-11h-4l3-4Z" fill={tone} />}
    {rainy && <path d="M14 27l-2 4M22 27l-2 4M30 27l-2 4" stroke="#427ca1" strokeWidth="2" strokeLinecap="round" />}
  </svg>;
}

export function QuietWeatherMap() {
  const points = pointsFromContract(analysisJson);
  const width = points.length * POINT_WIDTH;
  const temps = points.map(p => p.temperature);
  const minTemp = Math.min(...temps) - 2, maxTemp = Math.max(...temps) + 2;
  const yTemp = (v: number) => 8 + (1 - (v - minTemp) / (maxTemp - minTemp)) * 82;
  const tempPoints = points.map((p, i) => [i * POINT_WIDTH + POINT_WIDTH / 2, yTemp(p.temperature)] as [number, number]);
  const pressure = points.map(p => p.pressure);
  const pMin = Math.min(...pressure) - 3, pMax = Math.max(...pressure) + 3;
  const pressurePoints = points.map((p, i) => [i * POINT_WIDTH + POINT_WIDTH / 2, 6 + (1 - (p.pressure - pMin) / (pMax - pMin)) * 26] as [number, number]);
  const days = points.reduce<Array<{ label: string; count: number }>>((all, point) => {
    const d = new Date(`${point.timestamp.slice(0, 10)}T12:00:00Z`);
    const label = `${DAY_NAMES[d.getUTCDay()]} ${point.timestamp.slice(8, 10)}`;
    const last = all[all.length - 1];
    if (last?.label === label) last.count++; else all.push({ label, count: 1 });
    return all;
  }, []);
  const grid = { gridTemplateColumns: `repeat(${points.length}, ${POINT_WIDTH}px)` };
  const currentIndex = 0;

  return <section aria-labelledby="quiet-map-title" className="w-full max-w-[1500px] overflow-hidden border border-[#c7d2d3] bg-[#f5f7f4] text-[#33464c] shadow-[0_18px_55px_rgba(55,77,76,.12)]">
    <header className="flex flex-col gap-5 border-b border-[#c7d2d3] bg-[#eef3ef] px-5 py-5 md:flex-row md:items-end md:justify-between md:px-8">
      <div>
        <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.2em] text-[#6b7e7a]"><span className="h-2 w-2 rounded-full bg-[#7a9d82]" />Atmosphärische Karte · 48 Stunden</div>
        <h1 id="quiet-map-title" className="font-serif text-3xl tracking-[-.035em] text-[#263d42] md:text-4xl">Weiden am See</h1>
        <p className="mt-1 text-sm text-[#70817e]">47.925° N · 16.869° E · Ortszeit Europe/Vienna</p>
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded-full border border-[#cbd9cd] bg-[#e0ece1] px-3 py-1.5 font-semibold text-[#52735b]">Ruhiger Start</span>
        <span className="rounded-full border border-[#d7c9ae] bg-[#f3ead9] px-3 py-1.5 font-semibold text-[#8a6533]">Regen Sa 03:00</span>
        <span className="rounded-full border border-[#dfc1c1] bg-[#f3dfdf] px-3 py-1.5 font-semibold text-[#9c4d4d]">Gewitterrisiko So</span>
      </div>
    </header>
    <div className="border-b border-[#d5dddd] bg-[#f8faf7] px-5 py-3 text-[11px] leading-5 text-[#6d7c7c] md:px-8">
      <span className="font-semibold text-[#405b5b]">Lesart:</span> Die Wolkenflächen bilden den Horizont — je dichter, desto bedeckter. Das ist eine Modellkarte für Muster, kein Beobachtungsbild.
    </div>
    <div className="flex min-w-0">
      <aside className="w-[126px] shrink-0 border-r border-[#cbd5d5] bg-[#e9efec] text-[10px] text-[#627371] md:w-[190px]" aria-label="Feste Legende">
        <div style={{ height: DAY_H }} className="border-b border-[#cbd5d5] px-4 py-3 font-semibold uppercase tracking-[.12em]">Zeit · Wetter</div>
        <div style={{ height: 94 }} className="flex items-end border-b border-[#d4dddd] px-4 pb-3 text-[#ad6747]"><span>Temperatur<br /><small className="text-[#86918d]">°C</small></span></div>
        <div style={{ height: 35 }} className="flex items-center border-b border-[#d4dddd] px-4">Taupunkt · °C</div>
        <div style={{ height: 216 }} className="relative border-b border-[#cbd5d5]">
          <span className="absolute bottom-3 left-4 font-semibold text-[#457292]">Niederschlag<br /><small className="font-normal text-[#82918f]">mm · Wahrscheinlichkeit</small></span>
          <div className="absolute right-3 top-0 flex h-full flex-col justify-around text-right text-[9px]"><span>HOCH<br /><i className="not-italic">6–13 km</i></span><span>MITTEL<br /><i className="not-italic">2–6 km</i></span><span>TIEF<br /><i className="not-italic">0–2 km</i></span></div>
        </div>
        <div style={{ height: 38 }} className="flex items-center border-b border-[#d4dddd] px-4">Druck · hPa</div>
        <div style={{ height: 39 }} className="flex items-center bg-[#e0ece1] px-4">Wolkenbasis · m</div>
      </aside>
      <div className="meteogram-current__scroll min-w-0 flex-1 overflow-x-auto">
        <div className="relative" style={{ minWidth: width }}>
          <div className="pointer-events-none absolute inset-0 z-10 flex" aria-hidden="true">{points.map((p, i) => <div key={i} className={`h-full shrink-0 border-r border-[#879994]/[.09] ${p.isDay ? "" : "bg-[#5b688e]/[.08]"}`} style={{ width: POINT_WIDTH }} />)}</div>
          <div className="relative z-0">
            <div className="grid border-b border-[#cbd5d5] bg-[#f1f5f1] text-[11px] font-bold tracking-[.12em] text-[#56706d]" style={{ height: DAY_H, ...grid }}>{days.map((d, i) => <div key={i} className="flex items-center border-r border-[#cbd5d5] pl-4" style={{ gridColumn: `span ${d.count}` }}>{d.label}</div>)}</div>
            <div className="grid border-b border-[#cbd5d5] text-[13px] text-[#6f7d7a]" style={{ height: 32, ...grid }}>{points.map((p, i) => <div key={i} className="flex items-center justify-center">{p.timestamp.slice(11, 13)}<span className="ml-0.5 text-[9px]">h</span></div>)}</div>
            <div className="relative border-b border-[#cbd5d5]" style={{ height: 94 }}>
              <svg role="img" aria-label="Temperaturverlauf von 14 bis 28 Grad Celsius" viewBox={`0 0 ${width} 94`} width={width} height="94" className="absolute inset-0">
                <defs><linearGradient id="quiet-temp-fill" x2="0" y2="1"><stop stopColor="#d99b70" stopOpacity=".24" /><stop offset="1" stopColor="#d99b70" stopOpacity=".02" /></linearGradient></defs>
                <path d={`${pathFor([[0, tempPoints[0][1]], ...tempPoints, [width, tempPoints.at(-1)![1]]])} L ${width} 94 L 0 94Z`} fill="url(#quiet-temp-fill)" />
                <path d={pathFor(tempPoints)} fill="none" stroke="#b96f4d" strokeWidth="2.2" />
              </svg>
              <div className="relative grid text-[19px] font-medium" style={{ height: 94, ...grid }}>{points.map((p, i) => <div key={i} className="flex flex-col items-center justify-end pb-2" title={`Temperatur ${p.temperature} °C`}><WeatherGlyph point={p} /><span style={{ color: tempTone(p.temperature) }}>{p.temperature}°</span></div>)}</div>
            </div>
            <div className="grid border-b border-[#cbd5d5] text-[13px] text-[#71817e]" style={{ height: 35, ...grid }}>{points.map((p, i) => <div key={i} className="flex items-center justify-center" title={`Taupunkt ${p.dewPoint} °C`}>{p.dewPoint}°</div>)}</div>
            <div className="relative border-b border-[#cbd5d5]" style={{ height: 216 }}>
              <svg role="img" aria-label="Wolkenkarte mit drei Modellschichten, Niederschlag und Luftdruck" viewBox={`0 0 ${width} 216`} width={width} height="216" className="absolute inset-0">
                <defs><filter id="quiet-cloud-soft"><feGaussianBlur stdDeviation="5" /></filter></defs>
                {(["high", "mid", "low"] as const).map((band, row) => <g key={band}><line x2={width} y1={row * 72} y2={row * 72} stroke="#788b87" strokeOpacity=".26" /><text x="8" y={row * 72 + 15} fontSize="8" fill="#71817e" opacity=".8">{band === "high" ? "HOCH" : band === "mid" ? "MITTEL" : "TIEF"}</text>{points.map((p, i) => { const pct = p[band]; const h = Math.max(5, Math.min(59, 72 * (.28 + pct / 150))); return <ellipse key={i} cx={i * POINT_WIDTH + POINT_WIDTH / 2} cy={row * 72 + 72 - h * .55} rx={Math.min(68, POINT_WIDTH * (.62 + pct / 105)) / 2} ry={h / 2} fill="#667b80" opacity={.16 + pct / 430} filter="url(#quiet-cloud-soft)" />; })}</g>)}
                {points.map((p, i) => { const h = p.rain ? Math.max(4, p.rain / 2.3 * 47) : 0; return <g key={i}>{h > 0 && <><rect x={i * POINT_WIDTH + 33} y={210 - h} width="12" height={h} rx="6" fill="#4c86a9" opacity=".9" /><text x={i * POINT_WIDTH + POINT_WIDTH / 2} y={202 - h} textAnchor="middle" fontSize="9" fontWeight="600" fill="#3f7290">{p.rain.toFixed(1)} mm</text></>}</g>; })}
              </svg>
              <div className="relative grid" style={{ height: 216, ...grid }}>{points.map((p, i) => <div key={i} className="flex items-end justify-center pb-2" title={`${p.cloudType}, modellierte Wolkenbedeckung: hoch ${p.high} %, mittel ${p.mid} %, tief ${p.low} % · Regen ${p.rain.toFixed(1)} mm · Wahrscheinlichkeit ${p.precipProbability} %`}><span className="rounded-full border border-[#859794]/40 bg-[#eef3ef]/75 px-1.5 py-0.5 text-[9px] text-[#607572]">{p.cloudType}</span></div>)}</div>
            </div>
            <div className="relative border-b border-[#cbd5d5]" style={{ height: 38 }}>
              <svg role="img" aria-label="Luftdruckverlauf in Hektopascal" viewBox={`0 0 ${width} 38`} width={width} height="38" className="absolute inset-0"><path d={pathFor(pressurePoints)} fill="none" stroke="#66818a" strokeWidth="1.7" /></svg>
              <div className="relative grid text-[11px] text-[#61777a]" style={{ height: 38, ...grid }}>{points.map((p, i) => <div key={i} className="flex items-center justify-center" title={`Luftdruck ${p.pressure} hPa`}>{p.pressure}</div>)}</div>
            </div>
            <div className="grid bg-[#e0ece1] text-[12px] font-semibold text-[#56735e]" style={{ height: 39, ...grid }}>{points.map((p, i) => <div key={i} className="flex items-center justify-center" title={`Wolkenuntergrenze ${baseLabel(p.cloudBase)} Meter`}>{baseLabel(p.cloudBase)}</div>)}</div>
          </div>
          <div className="pointer-events-none absolute z-20 border-l-2 border-dashed border-[#58716d]/75" style={{ left: currentIndex * POINT_WIDTH + POINT_WIDTH / 2, top: DAY_H, bottom: 0 }}><span className="absolute -left-3 -top-5 rounded bg-[#58716d] px-1.5 py-0.5 text-[9px] font-bold text-[#f5f7f4]">JETZT</span></div>
        </div>
      </div>
    </div>
    <footer className="flex flex-col gap-2 border-t border-[#c7d2d3] bg-[#eef3ef] px-5 py-3 text-[10px] leading-4 text-[#71817e] md:flex-row md:items-center md:justify-between md:px-8">
      <span><strong className="text-[#526b68]">Hinweis:</strong> Wolkentypen und Wolkenhöhen sind modellbasierte Heuristiken, keine Beobachtungen.</span>
      <span className="flex items-center gap-3"><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#bf751c]" />Stratus</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#b34646]" />Cumulonimbus</span><span>Quelle: <a className="underline" href="https://open-meteo.com/">Open-Meteo</a></span></span>
    </footer>
  </section>;
}