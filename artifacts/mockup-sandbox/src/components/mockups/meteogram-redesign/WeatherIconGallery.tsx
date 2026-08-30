import React from "react";
import "./_group.css";

const SPRITE_CELL_WIDTH = 19.68;
const ICON_CELLS = Array.from({ length: 10 }, (_, index) => [index * SPRITE_CELL_WIDTH, SPRITE_CELL_WIDTH] as const);

const ICONS = [
  { index: 0, label: "Klare Nacht", detail: "nur der Mond" },
  { index: 1, label: "Nacht · wenig Wolken", detail: "Mond + kleine Wolke" },
  { index: 2, label: "Nacht · bedeckt", detail: "Mond + dichte Wolken" },
  { index: 3, label: "Sonne ohne Wolken", detail: "klarer Tag" },
  { index: 4, label: "Tag · wenig Wolken", detail: "Sonne + kleine Wolke" },
  { index: 5, label: "Tag · aufgelockert", detail: "Sonne + Wolken" },
  { index: 6, label: "Tag · bedeckt", detail: "dunkle Wolkendecke" },
  { index: 7, label: "Leichter Regen", detail: "zwei Regenstreifen" },
  { index: 8, label: "Starker Regen", detail: "vier Regenstreifen" },
  { index: 9, label: "Gewitter", detail: "großer orangefarbener Blitz" },
] as const;

function SpriteIcon({ index }: { index: number }) {
  const [cellX, cellWidth] = ICON_CELLS[index];
  const scale = 2.4;
  return <span
    className="block shrink-0 bg-no-repeat"
    style={{
      width: cellWidth * scale,
      height: 20 * scale,
      backgroundImage: `url(${import.meta.env.BASE_URL}weather-icons/windy-inspired-strip-v2.svg)`,
      backgroundSize: `${196.8 * scale}px ${20 * scale}px`,
      backgroundPosition: `${-cellX * scale}px 0`,
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
      <span className="text-[11px] text-[#8a9198]">10 Varianten</span>
    </div>
    <div className="grid grid-cols-5 gap-3">
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