import React from "react";

type CloudType = "clear" | "cirrus" | "altostratus" | "stratus" | "cumulus" | "cumulonimbus" | "mixed";
type Point = {
  timestamp: string; temperature: number; dewPoint: number; pressure: number; rain: number;
  precipProbability: number; weatherCode: number; cloudBase: number; cloudType: CloudType;
  isDay: boolean; low: number; mid: number; high: number;
};

const POINT_WIDTH = 86;
const DAY = 52;
const TYPES: CloudType[] = ["stratus", "mixed", "cumulus", "cirrus", "altostratus", "cumulonimbus"];
const DAY_NAMES = ["SONNTAG", "MONTAG", "DIENSTAG", "MITTWOCH", "DONNERSTAG", "FREITAG", "SAMSTAG"];
const wave = (i: number, center: number, range: number, period: number) => center + Math.sin(i / period) * range;

// Fixed production-shaped fixture, intentionally identical to Current.tsx.
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
function cloudColor(type: CloudType) { return type === "stratus" ? "#c48516" : type === "cumulonimbus" ? "#bd4440" : "#6f7d82"; }
function weatherIcon(p: Point) {
  const c = cloudColor(p.cloudType);
  return <svg aria-hidden="true" viewBox="0 0 38 32" className="h-8 w-9"><circle cx="11" cy="9" r="5" fill="#df9c2d" /><path d="M4 21h24a5 5 0 0 0 0-10h-4a7 7 0 0 0-13-1 5.5 5.5 0 0 0-5 5Z" fill={c} fillOpacity=".25" stroke={c} strokeWidth="1.7" />{p.cloudType === "cumulonimbus" && <path d="m18 13-4 7h4l-2 7 7-10h-4l3-4Z" fill={c} />}{p.weatherCode >= 51 && <path d="M12 25l-2 4M19 25l-2 4M26 25l-2 4" stroke="#527e91" strokeWidth="2" strokeLinecap="round" />}</svg>;
}
function baseLabel(v: number) { return v >= 5000 ? `${Math.round(v / 500) * 500}` : `${Math.round(v / 100) * 100}`; }

export function SailingCockpit() {
  const points = pointsFromContract(analysisJson);
  const width = points.length * POINT_WIDTH;
  const temps = points.map(p => p.temperature);
  const min = Math.min(...temps) - 2, max = Math.max(...temps) + 2;
  const yTemp = (v: number) => 12 + (1 - (v - min) / (max - min)) * 66;
  const tempPoints = points.map((p, i) => [i * POINT_WIDTH + POINT_WIDTH / 2, yTemp(p.temperature)] as [number, number]);
  const pressure = points.map(p => p.pressure), pMin = Math.min(...pressure) - 3, pMax = Math.max(...pressure) + 3;
  const pressurePoints = points.map((p, i) => [i * POINT_WIDTH + POINT_WIDTH / 2, 12 + (1 - (p.pressure - pMin) / (pMax - pMin)) * 106] as [number, number]);
  const rainTotal = points.reduce((a, p) => a + p.rain, 0);
  const storm = points.some(p => p.cloudType === "cumulonimbus");
  const wet = points.some(p => p.rain >= 2);
  const status = storm ? "WACHSAM" : wet ? "NASS" : "GUT FAHRBAR";
  const statusTone = storm ? "bg-[#f1d4cd] text-[#963d35]" : wet ? "bg-[#efe4c9] text-[#89631d]" : "bg-[#d7e5dc] text-[#3d6652]";
  const days = points.reduce<Array<{ label: string; count: number }>>((all, p) => {
    const d = new Date(`${p.timestamp.slice(0, 10)}T12:00:00Z`), label = `${DAY_NAMES[d.getUTCDay()]} ${p.timestamp.slice(8, 10)}`;
    const last = all[all.length - 1]; if (last?.label === label) last.count++; else all.push({ label, count: 1 }); return all;
  }, []);
  const grid = { gridTemplateColumns: `repeat(${points.length}, ${POINT_WIDTH}px)` };

  return <main className="min-h-[100dvh] overflow-x-hidden bg-[#e8ece8] px-3 py-5 text-[#26373b] sm:px-6 lg:px-10" style={{ fontFamily: "'DM Sans', ui-sans-serif, sans-serif" }}>
    <div className="mx-auto max-w-[1500px]">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div><p className="mb-1 text-[10px] font-bold uppercase tracking-[.22em] text-[#73867e]">Sailing weather / cockpit view</p><h1 className="font-serif text-3xl font-medium tracking-[-.03em] text-[#24363a] sm:text-4xl">Weiden am See <span className="text-lg text-[#78908a]">/ Neusiedler See</span></h1><p className="mt-1 text-xs text-[#71807e]">Samstag, 29. August · Ortszeit Europe/Vienna · 47.925° N, 16.869° E</p></div>
        <div className="flex items-center gap-3"><div className="text-right"><p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#7b8b85]">Entscheidungslage</p><p className="text-xs text-[#53635f]">Nächste 48 Stunden</p></div><div className={`rounded-full px-4 py-2 text-[11px] font-bold uppercase tracking-[.14em] ${statusTone}`}><span className="mr-2 inline-block h-2 w-2 rounded-full bg-current align-middle" />{status}</div></div>
      </header>

      <section className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-xl border border-[#c9d4ce] bg-[#f4f5ef] p-3"><p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#81918a]">Temperatur</p><p className="mt-1 font-mono text-2xl text-[#b85d39]">{Math.round(points[0].temperature)}° <span className="text-xs text-[#7e8e88]">jetzt</span></p><p className="mt-1 text-[11px] text-[#71807d]">Spanne {Math.min(...temps)}° – {Math.max(...temps)}°</p></div>
        <div className="rounded-xl border border-[#c9d4ce] bg-[#f4f5ef] p-3"><p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#81918a]">Niederschlag</p><p className="mt-1 font-mono text-2xl text-[#4d8192]">{rainTotal.toFixed(1)} <span className="text-xs">mm</span></p><p className="mt-1 text-[11px] text-[#71807d]">Maximum 2,3 mm · 03:00</p></div>
        <div className="rounded-xl border border-[#c9d4ce] bg-[#f4f5ef] p-3"><p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#81918a]">Luftdruck</p><p className="mt-1 font-mono text-2xl text-[#426775]">{points[0].pressure} <span className="text-xs">hPa</span></p><p className="mt-1 text-[11px] text-[#71807d]">ruhiger Verlauf · ±{Math.max(...pressure) - Math.min(...pressure)} hPa</p></div>
        <div className="rounded-xl border border-[#c9d4ce] bg-[#f4f5ef] p-3"><p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#81918a]">Untergrenze</p><p className="mt-1 font-mono text-2xl text-[#507969]">{baseLabel(points[0].cloudBase)} <span className="text-xs">m</span></p><p className="mt-1 text-[11px] text-[#71807d]">Tiefstwert {baseLabel(Math.min(...points.map(p => p.cloudBase)))} m</p></div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-[#becbc5] bg-[#f4f5ef] shadow-[0_10px_25px_rgba(53,74,67,.08)]" aria-label="Sailing cockpit meteogram">
        <div className="flex border-b border-[#c9d4ce] bg-[#dde6df] px-4 py-3"><div className="flex items-center gap-3"><div className="rounded-lg bg-[#476b69] px-2 py-1 font-mono text-[10px] font-bold text-[#f5f2e8]">WX / 48H</div><div><p className="text-xs font-bold text-[#314c4b]">Wetterinstrumente</p><p className="text-[10px] text-[#70817b]">Scrollen für Zeitverlauf · alle Werte Ortszeit</p></div></div><div className="ml-auto hidden items-center gap-4 text-[10px] text-[#60746d] sm:flex"><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#587e8a]" />Taupunkt</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#c16b42]" />Temperatur</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full border border-[#657b7d]" />Druck</span></div></div>
        <div className="flex min-w-0">
          <aside className="w-[118px] shrink-0 border-r border-[#c8d2cd] bg-[#e4ebe5] text-[#657772] sm:w-[188px]">
            <div style={{ height: DAY }} className="flex flex-col justify-center border-b border-[#c8d2cd] px-3"><b className="text-[12px] text-[#30494a]">Instrumente</b><span className="mt-0.5 text-[9px]">MODELL · 3-STUNDEN-TAKT</span></div>
            <div className="flex h-[42px] items-center justify-center text-[10px] font-bold uppercase tracking-[.15em]">Zeit / Tag</div>
            <div className="flex h-[82px] items-center justify-center text-center text-[10px] font-bold uppercase tracking-[.12em]">Integriertes<br />Wetterbild</div>
            <div className="flex h-[104px] items-center justify-center text-center text-[10px] font-bold uppercase tracking-[.12em]">Temperatur<br /><span className="font-mono font-normal normal-case">°C</span></div>
            <div className="flex h-[34px] items-center justify-center text-[10px] uppercase tracking-[.12em]">Taupunkt °C</div>
            <div className="relative h-[198px] border-t border-[#c8d2cd]"><div className="absolute inset-y-0 left-0 flex w-[50%] flex-col items-center justify-center text-center text-[9px] uppercase tracking-[.1em]">Regen<br /><span className="font-mono normal-case">mm</span></div>{[["HOCH","6–13 km"],["MITTEL","2–6 km"],["TIEF","0–2 km"]].map(([a,b], i) => <div key={a} className="absolute right-0 flex w-[50%] flex-col items-center text-center" style={{ top: `${i * 33.33}%`, height: "33.33%" }}><b className="mt-2 text-[9px]">{a}</b><span className="text-[8px]">{b}</span></div>)}</div>
            <div className="flex h-[42px] items-center justify-center px-2 text-center text-[9px] uppercase tracking-[.1em]">Wolkenunter-<br />grenze · m</div>
          </aside>
          <div className="min-w-0 flex-1 overflow-x-auto" tabIndex={0} aria-label="Scrollbarer Forecast-Verlauf">
            <div className="relative" style={{ minWidth: width }}>
              <div className="pointer-events-none absolute inset-0 z-10 flex">{points.map((p, i) => <div key={i} className={!p.isDay ? "bg-[#59648c]/[.10]" : ""} style={{ width: POINT_WIDTH }} />)}</div>
              <div className="relative z-0">
                <div className="grid border-b border-[#c8d2cd] bg-[#edf1eb] text-[11px] font-bold tracking-[.13em]" style={{ height: DAY, ...grid }}>{days.map((d, i) => <div key={i} className="flex items-center border-r border-[#c8d2cd] pl-4" style={{ gridColumn: `span ${d.count}` }}>{d.label}</div>)}</div>
                <div className="grid border-b border-[#c8d2cd] text-[13px] font-mono text-[#647875]" style={{ height: 42, ...grid }}>{points.map((p, i) => <div key={i} className="flex items-center justify-center">{p.timestamp.slice(11,13)}<span className="ml-1 text-[8px] font-sans uppercase tracking-normal">{p.isDay ? "Tag" : "Nacht"}</span></div>)}</div>
                <div className="relative border-b border-[#c8d2cd]" style={{ height: 82 }}><svg className="absolute inset-0" width={width} height="82" viewBox={`0 0 ${width} 82`} role="img" aria-label="Integrierte Wetterbilder und Regenmengen"><path d={smoothPath([[0, 60], ...points.map((p,i) => [i*POINT_WIDTH+POINT_WIDTH/2, 60] as [number,number]), [width,60]])} fill="none" />{points.map((p,i) => <g key={i} transform={`translate(${i*POINT_WIDTH+POINT_WIDTH/2-19},25)`}><title>{`${p.timestamp.slice(11,13)} Uhr: ${p.cloudType}, ${p.rain.toFixed(1)} mm Regen, Wahrscheinlichkeit ${p.precipProbability}%`}</title>{weatherIcon(p)}</g>)}</svg></div>
                <div className="relative border-b border-[#c8d2cd]" style={{ height: 104 }}><svg className="absolute inset-0" width={width} height="104" viewBox={`0 0 ${width} 104`} role="img" aria-label="Temperaturverlauf in Grad Celsius"><path d={`${smoothPath([[0, tempPoints[0][1]], ...tempPoints, [width, tempPoints[tempPoints.length-1][1]]])} L ${width} 104 L 0 104Z`} fill="#d47c51" fillOpacity=".14" /><path d={smoothPath(tempPoints)} fill="none" stroke="#bc6845" strokeWidth="2.5" />{points.map((p,i) => <g key={i}><title>{`${p.timestamp.slice(11,13)} Uhr: Temperatur ${p.temperature} °C`}</title><circle cx={tempPoints[i][0]} cy={tempPoints[i][1]} r="3.5" fill="#bc6845" /><text x={tempPoints[i][0]} y="94" textAnchor="middle" fontSize="11" fill="#8c563f">{p.temperature}°</text></g>)}</svg></div>
                <div className="grid border-b border-[#c8d2cd] text-[12px] font-mono text-[#58747d]" style={{ height: 34, ...grid }}>{points.map((p,i) => <div key={i} className="flex items-center justify-center" title={`Taupunkt ${p.dewPoint} °C`}>{p.dewPoint}°</div>)}</div>
                <div className="relative border-b border-[#c8d2cd]" style={{ height: 198 }}><svg className="absolute inset-0" width={width} height="198" viewBox={`0 0 ${width} 198`} role="img" aria-label="Wolkenbänder, Regenbalken und Luftdruck"><defs><pattern id="hatch-cockpit" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M-2 10L4 4M3 15L15 3" stroke="#647875" strokeOpacity=".16" /></pattern></defs>{(["high","mid","low"] as const).map((band,row) => <g key={band}><line y1={row*66} x2={width} y2={row*66} stroke="#71817d" strokeOpacity=".25" />{points.map((p,i) => { const pct=p[band], h=8+pct*.42; return <g key={i}><title>{`${band === "high" ? "HOCH" : band === "mid" ? "MITTEL" : "TIEF"}: ${pct}% Bewölkung um ${p.timestamp.slice(11,13)} Uhr`}</title><ellipse cx={i*POINT_WIDTH+POINT_WIDTH/2} cy={row*66+34} rx={18+pct*.22} ry={h/2} fill="#75827e" opacity={.13+pct/500} />{pct>35 && <rect x={i*POINT_WIDTH} y={row*66} width={POINT_WIDTH} height="66" fill="url(#hatch-cockpit)" />}</g>})}</g>)}{points.map((p,i) => <g key={`r${i}`}><title>{`Regen ${p.rain.toFixed(1)} mm; Luftdruck ${p.pressure} hPa`}</title>{p.rain>0 && <rect x={i*POINT_WIDTH+POINT_WIDTH/2-4} y={188-p.rain*38} width="8" height={p.rain*38} rx="2" fill="#4b8798" />}<circle cx={pressurePoints[i][0]} cy={pressurePoints[i][1]+66} r="2.4" fill="#4b6870" /></g>)}<path d={smoothPath(pressurePoints.map(([x,y]) => [x,y+66]))} fill="none" stroke="#4b6870" strokeWidth="1.5" /></svg></div>
                <div className="grid bg-[#dce9dc] text-[12px] font-mono font-medium text-[#4d7160]" style={{ height: 42, ...grid }}>{points.map((p,i) => <div key={i} className="flex items-center justify-center" title={`Wolkenuntergrenze ${baseLabel(p.cloudBase)} Meter`}>{baseLabel(p.cloudBase)}</div>)}</div>
              </div>
              <div className="pointer-events-none absolute z-20 border-l-2 border-dashed border-[#b85e42]" style={{ left: POINT_WIDTH/2, top: DAY, bottom: 0 }}><span className="absolute -left-[19px] top-1 rounded bg-[#b85e42] px-1.5 py-0.5 text-[8px] font-bold text-[#fff4e9]">JETZT</span></div>
            </div>
          </div>
        </div>
      </section>
      <footer className="mt-3 flex flex-wrap items-center justify-between gap-2 px-1 text-[10px] text-[#75827c]"><p><span className="font-bold text-[#566b65]">Lesart:</span> Dunkle Spalten = Nacht · gestrichelte Linie = aktuelle Zeit · Balken = Regenmenge</p><p className="max-w-[620px] text-right">Wolkentypen sind <strong>modellbasierte Heuristiken</strong>, keine Beobachtung. Quelle: Open-Meteo</p></footer>
    </div>
  </main>;
}