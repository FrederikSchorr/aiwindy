import React from "react";
import "./_group.css";
import { WeatherIcon, type WeatherIconKind } from "./_WeatherIcon";

const ICONS = [
  { kind: "clear-night", label: "Klare Nacht", detail: "nur der Mond" },
  { kind: "partly-cloudy-night", label: "Nacht · wenig Wolken", detail: "Mond + kleine Wolke" },
  { kind: "overcast-night", label: "Nacht · bedeckt", detail: "Mond + dichte Wolken" },
  { kind: "clear-day", label: "Sonne ohne Wolken", detail: "klarer Tag" },
  { kind: "few-clouds-day", label: "Tag · wenig Wolken", detail: "Sonne + kleine Wolke" },
  { kind: "partly-cloudy-day", label: "Tag · aufgelockert", detail: "Sonne + Wolken" },
  { kind: "overcast-day", label: "Tag · bedeckt", detail: "dunkle Wolkendecke" },
  { kind: "light-rain", label: "Leichter Regen", detail: "zwei Regenstreifen" },
  { kind: "heavy-rain", label: "Starker Regen", detail: "vier Regenstreifen" },
  { kind: "thunderstorm", label: "Gewitter", detail: "großer orangefarbener Blitz" },
] satisfies Array<{ kind: WeatherIconKind; label: string; detail: string }>;

export function WeatherIconGallery() {
  return <div className="min-h-full bg-[#f5f6f8] px-7 py-6 text-[#30353a]">
    <div className="mb-5 flex items-end justify-between border-b border-[#d8dce1] pb-3">
      <div>
        <h1 className="text-[20px] font-medium tracking-[.02em] text-[#4c555d]">Wetter-Icons</h1>
        <p className="mt-1 text-[12px] text-[#7a8188]">Das vollständige Set der Windy-inspirierten Meteogramm-Zustände</p>
      </div>
      <span className="text-[11px] text-[#8a9198]">10 Varianten</span>
    </div>
    <div className="grid grid-cols-5 gap-3">
      {ICONS.map(icon => <div key={icon.kind} className="flex min-h-[108px] items-center gap-3 rounded-[5px] border border-[#dce0e4] bg-white px-3 py-3 shadow-[0_1px_2px_rgba(70,80,90,.04)]">
        <div className="flex h-[58px] w-[58px] shrink-0 items-center justify-center overflow-hidden rounded-[3px] bg-[#fafbfc]">
          <WeatherIcon kind={icon.kind} className="h-12 w-12" />
        </div>
        <div className="min-w-0">
          <div className="text-[12px] font-semibold leading-[15px] text-[#4c555d]">{icon.label}</div>
          <div className="mt-1 text-[10px] leading-[13px] text-[#8a9198]">{icon.detail}</div>
        </div>
      </div>)}
    </div>
  </div>;
}