import React from "react";
import "./_group.css";

const ICON_CELLS = [
  [0, 50.1],
  [50.1, 56.6],
  [106.7, 45.6],
  [152.3, 48.1],
  [200.4, 49.5],
  [249.9, 50.5],
  [300.4, 50.9],
  [351.3, 48.7],
] as const;

const ICONS = [
  { index: 0, label: "Nacht · wenig Wolken", detail: "Mond + kleine Wolke" },
  { index: 1, label: "Nacht · bedeckt", detail: "Mond + dichte Wolken" },
  { index: 2, label: "Tag · wenig Wolken", detail: "Sonne + kleine Wolke" },
  { index: 3, label: "Tag · aufgelockert", detail: "Sonne + Wolken" },
  { index: 4, label: "Tag · bedeckt", detail: "dichte Wolkendecke" },
  { index: 5, label: "Leichter Regen", detail: "zwei Regenstreifen" },
  { index: 6, label: "Starker Regen", detail: "vier Regenstreifen" },
  { index: 7, label: "Gewitter", detail: "Regen + Blitz" },
] as const;

function SpriteIcon({ index }: { index: number }) {
  const [cellX, cellWidth] = ICON_CELLS[index];
  const scale = 1;
  return <span
    className="block shrink-0 bg-no-repeat"
    style={{
      width: cellWidth * scale,
      height: 55 * scale,
      backgroundImage: `url(${import.meta.env.BASE_URL}weather-icons/windy-inspired-strip.svg)`,
      backgroundSize: `${400 * scale}px ${79 * scale}px`,
      backgroundPosition: `${-cellX * scale}px ${-10 * scale}px`,
    }}
    aria-hidden="true"
  />;
}

export function WeatherIconGallery() {
  return <div className="min-h-full bg-[#f5f6f8] px-7 py-6 text-[#30353a]">
    <div className="mb-5 flex items-end justify-between border-b border-[#d8dce1] pb-3">
      <div>
        <h1 className="text-[20px] font-medium tracking-[.02em] text-[#4c555d]">Wetter-Icons</h1>
        <p className="mt-1 text-[12px] text-[#7a8188]">Das vollständige Set der Windy-inspirierten Meteogramm-Zustände</p>
      </div>
      <span className="text-[11px] text-[#8a9198]">8 Varianten</span>
    </div>
    <div className="grid grid-cols-4 gap-3">
      {ICONS.map(icon => <div key={icon.index} className="flex min-h-[108px] items-center gap-3 rounded-[5px] border border-[#dce0e4] bg-white px-3 py-3 shadow-[0_1px_2px_rgba(70,80,90,.04)]">
        <div className="flex h-[58px] w-[58px] shrink-0 items-center justify-center overflow-hidden rounded-[3px] bg-[#fafbfc]">
          <SpriteIcon index={icon.index} />
        </div>
        <div className="min-w-0">
          <div className="text-[12px] font-semibold leading-[15px] text-[#4c555d]">{icon.label}</div>
          <div className="mt-1 text-[10px] leading-[13px] text-[#8a9198]">{icon.detail}</div>
        </div>
      </div>)}
    </div>
  </div>;
}