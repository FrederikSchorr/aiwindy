import CityMeteogram from "@/components/city-meteogram";

const HOURS = 48;
const CLOUD_TYPES = ["stratus", "mixed", "cumulus", "cirrus", "altostratus", "cumulonimbus"] as const;

function wave(index: number, center: number, range: number, period: number): number {
  return center + Math.sin(index / period) * range;
}

export const METEOGRAM_REFERENCE_ANALYSIS: Record<string, unknown> = (() => {
  const timestamps = Array.from({ length: HOURS }, (_, index) => {
    const date = new Date(Date.UTC(2026, 7, 29, index * 3));
    return date.toISOString().slice(0, 19);
  });
  const rain = timestamps.map((_, index) => index === 29 ? 0.1 : index === 30 ? 2.3 : index === 44 ? 0.8 : 0);
  return {
    weatherRaw: {
      openMeteoForecast: {
        timezone: "Europe/Vienna",
        city: {
          name: "Weiden am See",
          coordinates: { lat: 47.925, lon: 16.869 },
          url: "https://open-meteo.com/",
          hourly: {
            timestamps,
            temp2mC: timestamps.map((_, index) => Math.round(wave(index, 21, 7, 3.4))),
            dewPoint2mC: timestamps.map((_, index) => Math.round(wave(index, 12, 2, 5.1))),
            pressureMslHPa: timestamps.map((_, index) => Math.round(wave(index, 1018, 6, 8.2))),
            rainMm: rain,
            precipProbabilityPct: rain.map((value) => value >= 2 ? 90 : value > 0 ? 55 : 8),
            weatherCode: rain.map((value, index) => value >= 2 ? 81 : value > 0 ? 61 : index % 7 < 2 ? 2 : 1),
            cloudBaseM: timestamps.map((_, index) => Math.max(250, Math.round(wave(index, 1550, 1100, 4.5) / 50) * 50)),
            cloudType: timestamps.map((_, index) => CLOUD_TYPES[Math.floor(index / 8) % CLOUD_TYPES.length]),
            capeJkg: timestamps.map((_, index) => index >= 38 && index <= 42 ? 900 : 80),
            isDay: timestamps.map((timestamp) => {
              const hour = Number(timestamp.slice(11, 13));
              return hour >= 6 && hour < 21 ? 1 : 0;
            }),
            cloudCoverLowPct: timestamps.map((_, index) => Math.round(Math.max(5, Math.min(100, wave(index, 52, 43, 2.7))))),
            cloudCoverMidPct: timestamps.map((_, index) => Math.round(Math.max(0, Math.min(100, wave(index, 44, 40, 4.2))))),
            cloudCoverHighPct: timestamps.map((_, index) => Math.round(Math.max(0, Math.min(100, wave(index, 48, 46, 5.8))))),
          },
        },
      },
    },
  };
})();

export default function MeteogramReference() {
  return (
    <main className="min-h-screen bg-[#f7f8f9] px-0 py-8 text-slate-900 sm:px-6" data-testid="meteogram-reference-page">
      <header className="mx-auto mb-5 w-full max-w-[1120px] px-4 sm:px-0">
        <p className="text-xs font-semibold uppercase tracking-[.12em] text-slate-500">Entwicklungsreferenz · feste Daten</p>
        <h1 className="mt-1 text-2xl font-semibold">Stadt-Meteogramm</h1>
        <p className="mt-1 text-sm text-slate-500">Unveränderlicher Vergleich für Desktop- und Mobile-Screenshots.</p>
      </header>
      <CityMeteogram analysisJson={METEOGRAM_REFERENCE_ANALYSIS} cityName="Weiden am See" />
    </main>
  );
}