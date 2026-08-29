import React from "react";

type CloudType = "clear" | "cirrus" | "altostratus" | "stratus" | "cumulus" | "cumulonimbus" | "mixed";
type Point = {
  timestamp: string; temperature: number; dewPoint: number; pressure: number; rain: number;
  precipProbability: number; weatherCode: number; cloudBase: number; cloudType: CloudType;
  isDay: boolean; low: number; mid: number; high: number;
};

const POINT_WIDTH = 76;
const DAYS = ["SONNTAG", "MONTAG", "DIENSTAG", "MITTWOCH", "DONNERSTAG", "FREITAG", "SAMSTAG"];
const TYPES: CloudType[] = ["stratus", "mixed", "cumulus", "cirrus", "altostratus", "cumulonimbus"];
const wave = (i: number, center: number, range: number, period: number) => center + Math.sin(i / period) * range;

// Kept in lockstep with Current.tsx: this is intentionally the same Weiden am See fixture.
const analysisJson = (() => {
  const timestamps = Array.from({ length: 16 }, (_, i) => new Date(Date.UTC(2026, 7, 29, i * 3)).toISOString().slice(0, 19));
  const rain = timestamps.map((_, i) => i === 9 ? .1 : i === 10 ? 2.3 : i === 14 ? .8 : 0);
  return { weatherRaw: { openMeteoForecast: { timezone: "Europe/Vienna", city: { name: "Weiden am See", coordinates: { lat: 47.925, lon: 16.869 }, hourly: {
    timestamps, temp2mC: timestamps.map((_, i) => Math.round(wave(i, 21, 7, 3.4))),
    dewPoint2mC: timestamps.map((_, i) => Math.round(wave(i, 12, 2, 5.1))),
    pressureMslHPa: timestamps.map((_, i) => Math.round(wave(i, 1018, 6, 8.2))), rainMm: rain,
    precipProbabilityPct: rain.map(v => v >= 2 ? 90 : v ? 55 : 8),
    weatherCode: rain.map((v, i) => v >= 2 ? 81 : v ? 61 : i % 7 < 2 ? 2 : 1),
    cloudBaseM: timestamps.map((_, i) => Math.max(250, Math.round(wave(i, 1550, 1100, 4.5) / 50) * 50)),
    cloudType: timestamps.map((_, i) => TYPES[Math.floor(i / 3) % TYPES.length]),
    isDay: timestamps.map(t => { const h = Number(t.slice(11, 13)); return h >= 6 && h < 21 ? 1 : 0; }),
    cloudCoverLowPct: timestamps.map((_, i) => Math.round(Math.max(5, Math.min(100, wave(i, 52, 43, 2.7))))),
    cloudCoverMidPct: timestamps.map((_, i) => Math.round(Math.max(0, Math.min(100, wave(i, 44, 40, 4.2))))),
    cloudCoverHighPct: timestamps.map((_, i) => Math.round(Math.max(0, Math.min(100, wave(i, 48, 46, 5.8)))))
  } } } } };
})();

function pointsFromContract(json: typeof analysisJson): Point[] {
  const h = json.weatherRaw.openMeteoForecast.city.hourly;
  return h.timestamps.map((timestamp, i) => ({
    timestamp: String(timestamp), temperature: Number(h.temp2mC[i]), dewPoint: Number(h.dewPoint2mC[i]),
    pressure: Number(h.pressureMslHPa[i]), rain: Number(h.rainMm[i]), precipProbability: Number(h.precipProbabilityPct[i]),
    weatherCode: Number(h.weatherCode[i]), cloudBase: Number(h.cloudBaseM[i]), cloudType: h.cloudType[i] as CloudType,
    isDay: Number(h.isDay[i]) === 1, low: Number(h.cloudCoverLowPct[i]), mid: Number(h.cloudCoverMidPct[i]), high: Number(h.cloudCoverHighPct[i])
  }));
}

function smoothPath(points: Array<[number, number]>) {
  return points.reduce((path, [x, y], i) => !i ? `M ${x} ${y}` : `${path} C ${(points[i - 1][0] + x) / 2} ${points[i - 1][1]}, ${(points[i - 1][0] + x) / 2} ${y}, ${x} ${y}`, "");
}
function cloudColor(type: CloudType) { return type === "stratus" ? "#b76c28" : type === "cumulonimbus" ? "#b44242" : "#61747a"; }
function base(v: number) { return v >= 5000 ? `${Math.round(v / 500) * 500}` : `${Math.round(v / 100) * 100}`; }
function weatherIcon(p: Point) {
  const c = cloudColor(p.cloudType); const rainy = p.weatherCode >= 51;
  return <svg viewBox="0 0 38 32" className="h-8 w-10" aria-hidden="true">
    <circle cx="11" cy="10" r="5" fill="#d68b3a" />
    <path d="M4 21h24a5 5 0 0 0 0-10h-4a7 7 0 0 0-13-1 5.5 5.5 0 0 0-5 5Z" fill={c} fillOpacity=".19" stroke={c} strokeWidth="1.7" />
    {p.cloudType === "cumulonimbus" && <path d="m18 13-4 7h4l-2 7 7-10h-4l3-4Z" fill={c} />}
    {rainy && <path d="M12 25l-2 4M19 25l-2 4M26 25l-2 4" stroke="#4d8aa0" strokeWidth="2" strokeLinecap="round" />}
  </svg>;
}

export function EditorialForecastStrip() {
  const points = pointsFromContract(analysisJson);
  const width = points.length * POINT_WIDTH;
  const temperatures = points.map(p => p.temperature);
  const min = Math.min(...temperatures) - 2, max = Math.max(...temperatures) + 2;
  const yTemp = (v: number) => 12 + (1 - (v - min) / (max - min)) * 78;
  const tempPoints = points.map((p, i) => [i * POINT_WIDTH + POINT_WIDTH / 2, yTemp(p.temperature)] as [number, number]);
  const pressure = points.map(p => p.pressure), pMin = Math.min(...pressure) - 3, pMax = Math.max(...pressure) + 3;
  const pressurePoints = points.map((p, i) => [i * POINT_WIDTH + POINT_WIDTH / 2, 12 + (1 - (p.pressure - pMin) / (pMax - pMin)) * 164] as [number, number]);
  const dayGroups = points.reduce<Array<{ label: string; count: number; date: string }>>((all, p) => {
    const d = new Date(`${p.timestamp.slice(0, 10)}T12:00:00Z`), label = DAYS[d.getUTCDay()];
    const fullDate = p.timestamp.slice(0, 10);
    const last = all.at(-1); if (last?.date === fullDate) last.count++; else all.push({ label, count: 1, date: fullDate }); return all;
  }, []);
  const grid = { gridTemplateColumns: `repeat(${points.length}, ${POINT_WIDTH}px)` };
  const chapterText = dayGroups.map((d, i) => i === 0 ? "Sanfter Auftakt, klare Sicht" : "Der Regen zieht kurz durch");
  return <section className="w-full overflow-hidden border-y border-[#cad3d1] bg-[#f5f6f1] text-[#253b3d]" aria-labelledby="editorial-title">
    <div className="mx-auto max-w-[1500px] px-4 py-5 md:px-8 md:py-7">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[.22em] text-[#b76c28]">Wettergeschichte · 48 Stunden</p>
          <h2 id="editorial-title" className="font-serif text-3xl leading-none tracking-[-.035em] md:text-5xl">Weiden am See</h2>
          <p className="mt-2 max-w-xl text-sm leading-5 text-[#667777]">Ein ruhiger Start, dann ein kurzer nasser Einschnitt — die entscheidenden Wendepunkte für den nächsten Törn.</p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-[#cdd7d2] bg-[#e9eeea] px-3 py-2 text-[11px] text-[#58706d]">
          <span className="h-2 w-2 rounded-full bg-[#b76c28]" /> Modelllauf · 29. Aug 2026 · 09:00 CEST
        </div>
      </header>
      <div className="flex min-w-0 overflow-hidden rounded-[18px] border border-[#cbd5d2] bg-[#fbfcf8] shadow-[0_15px_45px_rgba(49,70,66,.08)]">
        <aside className="z-30 w-[132px] shrink-0 border-r border-[#cbd5d2] bg-[#edf1ec] text-[10px] text-[#667777] md:w-[205px]" aria-label="Diagrammlegende">
          <div className="flex h-[96px] flex-col justify-end border-b border-[#d5ddda] px-3 pb-3 md:px-5">
            <span className="font-mono text-[9px] uppercase tracking-widest text-[#879692]">Ausgewählter Ort</span><strong className="mt-1 text-sm text-[#253b3d]">47.925° N · 16.869° E</strong>
          </div>
          <div className="flex h-[72px] items-center px-3 font-mono text-[10px] uppercase tracking-wider md:px-5">Ortszeit</div>
          <div className="flex h-[104px] items-end px-3 pb-3 font-semibold text-[#a95c2a] md:px-5">Temperatur</div>
          <div className="flex h-[42px] items-center px-3 text-[#6b7d7c] md:px-5">Taupunkt</div>
          <div className="relative h-[210px] border-t border-[#d5ddda]">
            <div className="absolute inset-y-0 left-0 flex w-[46%] flex-col justify-center px-3 text-center md:px-5"><span className="font-semibold">Regen</span><span className="mt-1 font-mono text-[9px]">mm · Wahrscheinlichkeit</span></div>
            <div className="absolute inset-y-0 right-0 flex w-[54%] flex-col justify-around border-l border-dashed border-[#ccd5d1] px-2 text-center font-mono text-[9px]"><span><b>HOCH</b><br />6–13 km</span><span><b>MITTEL</b><br />2–6 km</span><span><b>TIEF</b><br />0–2 km</span></div>
          </div>
          <div className="flex h-[46px] items-center px-3 text-center md:justify-center md:px-5">Wolkenuntergrenze <span className="ml-1 font-mono text-[9px]">m</span></div>
        </aside>
        <div className="min-w-0 flex-1 overflow-x-auto" aria-label="Horizontale Forecast-Zeitleiste">
          <div className="relative min-w-max" style={{ width }}>
            <div className="pointer-events-none absolute inset-0 z-10 flex">{points.map((p, i) => <div key={i} className={!p.isDay ? "bg-[#4d5681]/[.07]" : ""} style={{ width: POINT_WIDTH }} aria-hidden="true" />)}</div>
            <div className="relative z-0">
              <div className="flex h-[96px] border-b border-[#d5ddda] bg-[#f1f4ef]">
                {dayGroups.map((d, i) => <div key={`chapter-${d.date}-${i}`} className="relative flex shrink-0 flex-col justify-end border-r border-[#cfd8d3] px-4 pb-3" style={{ width: d.count * POINT_WIDTH }}>
                  <span className="font-mono text-[9px] uppercase tracking-[.18em] text-[#879692]">{d.date.slice(8, 10)}. AUGUST</span><strong className="mt-1 font-serif text-[22px] font-normal">{d.label}</strong><span className="mt-1 text-[11px] text-[#a95c2a]">{chapterText[i]}</span>
                </div>)}
              </div>
              <div className="grid h-[72px] border-b border-[#d5ddda] text-[14px] text-[#6e7f7d]" style={grid}>{points.map((p, i) => <div key={i} className="flex items-center justify-center font-mono">{p.timestamp.slice(11, 13)}<span className="ml-0.5 text-[9px]">h</span></div>)}</div>
              <div className="relative h-[104px] border-b border-[#d5ddda]" aria-label="Temperaturverlauf">
                <svg className="absolute inset-0" width={width} height="104" viewBox={`0 0 ${width} 104`} role="img" aria-label="Temperaturverlauf von 14 bis 28 Grad Celsius"><path d={`${smoothPath([[0, tempPoints[0][1]], ...tempPoints, [width, tempPoints.at(-1)![1]]])} L ${width} 104 L 0 104Z`} fill="#c98048" fillOpacity=".14" /><path d={smoothPath(tempPoints)} fill="none" stroke="#b76c28" strokeWidth="2.3" /></svg>
                <div className="relative grid h-full" style={grid}>{points.map((p, i) => <div key={i} className="flex flex-col items-center justify-end pb-3"><span className="font-serif text-[24px]">{p.temperature}°</span></div>)}</div>
              </div>
              <div className="grid h-[42px] border-b border-[#d5ddda] text-[14px] text-[#788886]" style={grid}>{points.map((p, i) => <div key={i} className="flex items-center justify-center">{p.dewPoint}°</div>)}</div>
              <div className="relative h-[210px] border-b border-[#d5ddda]" aria-label="Niederschlag, Luftdruck und Wolkenstockwerke">
                <svg className="absolute inset-0" width={width} height="210" viewBox={`0 0 ${width} 210`} role="img" aria-label="Luftdruckverlauf und Niederschlagsbalken">
                  <path d={smoothPath(pressurePoints)} fill="none" stroke="#68878a" strokeWidth="1.5" strokeDasharray="3 3" />
                  {points.map((p, i) => p.rain > 0 && <g key={i}><rect x={i * POINT_WIDTH + 31} y={195 - p.rain * 25} width="14" height={p.rain * 25} rx="3" fill="#4d8aa0" /><text x={i * POINT_WIDTH + 38} y={188 - p.rain * 25} textAnchor="middle" fontSize="9" fill="#356d7b">{p.rain.toFixed(1)}</text></g>)}
                  {[70, 140].map(y => <line key={y} x1="0" x2={width} y1={y} y2={y} stroke="#d4ddda" strokeDasharray="2 5" />)}
                </svg>
                <div className="relative grid h-full" style={grid}>{points.map((p, i) => <div key={i} className="flex items-start justify-center pt-3" title={`Wolkentyp: ${p.cloudType}; ${p.low}% tiefe Wolken, ${p.mid}% mittlere Wolken, ${p.high}% hohe Wolken`} aria-label={`Wolkentyp ${p.cloudType}, tiefe ${p.low} Prozent, mittlere ${p.mid} Prozent, hohe ${p.high} Prozent`}>{weatherIcon(p)}</div>)}</div>
              </div>
              <div className="grid h-[46px] bg-[#e4eee7] text-[13px] font-medium text-[#45635d]" style={grid}>{points.map((p, i) => <div key={i} className="flex items-center justify-center" title={`Wolkenuntergrenze ${base(p.cloudBase)} Meter`}>{base(p.cloudBase)}</div>)}</div>
            </div>
            <div className="pointer-events-none absolute bottom-0 top-0 z-20 border-l border-dashed border-[#b76c28]" style={{ left: POINT_WIDTH * 1.5 }} aria-label="Aktuelle Zeit: Sonntag, 04 Uhr" />
            <div className="pointer-events-none absolute top-2 z-30 -translate-x-1/2 rounded-full bg-[#b76c28] px-2 py-1 font-mono text-[9px] font-bold text-[#fffaf1]" style={{ left: POINT_WIDTH * 1.5 }}>JETZT</div>
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[11px] text-[#71817d]">
        <p><span className="mr-2 inline-block h-2 w-2 rounded-full bg-[#b76c28]" />Aktueller Moment · <span className="mx-1 inline-block h-2 w-2 rounded-full bg-[#4d8aa0]" />Niederschlag in mm</p>
        <p className="font-mono text-[10px]">Wolkentypen sind modellbasierte Heuristiken, keine Beobachtungen.</p>
      </div>
      <details className="mt-3 text-[11px] text-[#60716e]"><summary className="cursor-pointer font-semibold underline underline-offset-2">Daten als Text lesen</summary><div className="mt-2 grid gap-x-6 gap-y-1 rounded-lg bg-[#e9efea] p-3 sm:grid-cols-2">{points.map((p, i) => <p key={`text-point-${p.timestamp}-${i}`}><b>{p.timestamp.slice(8, 10)}.{p.timestamp.slice(11, 13)} Uhr:</b> {p.temperature}°C, Taupunkt {p.dewPoint}°C, {p.rain.toFixed(1)} mm Regen, Druck {p.pressure} hPa, Wolkenbasis {base(p.cloudBase)} m.</p>)}</div></details>
    </div>
  </section>;
}