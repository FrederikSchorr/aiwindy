import React from "react";
import "./_group.css";

type WindPoint = {
  timestamp: string;
  dayLabel: string;
  hour: string;
  speed: number;
  gust: number;
  direction: number;
  isDay: boolean;
};

const POINT_WIDTH = 42;
const ROW = { day: 42, hours: 32, wind: 42, gust: 42, direction: 52 };
const FORECAST_HOURS = 6 * 8;
const DAY_NAMES = ["SONNTAG", "MONTAG", "DIENSTAG", "MITTWOCH", "DONNERSTAG", "FREITAG", "SAMSTAG"];
const windSpeeds = [
  0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24,
  26, 28, 30, 32, 35, 38, 40, 42, 45, 48, 50, 48, 45, 42, 40, 38,
  35, 32, 30, 28, 26, 24, 22, 20, 18, 16, 14, 12, 10, 8, 5, 2,
];
const gustOffsets = [2, 3, 4, 5, 4, 5, 6, 6];
const directions = [
  250, 245, 240, 235, 230, 225, 220, 215, 220, 225, 230, 235, 240, 245, 250, 255, 260, 265, 270, 275, 280, 285, 280, 275,
  260, 255, 250, 245, 240, 235, 230, 225, 220, 215, 210, 205, 210, 215, 220, 225, 230, 235, 240, 245, 250, 255, 260, 265,
  280, 275, 270, 265, 260, 255, 250, 245, 240, 235, 230, 225, 220, 215, 210, 205, 200, 195, 200, 205, 210, 215, 220, 225,
];

function toHex(value: number) {
  return Math.round(value).toString(16).padStart(2, "0");
}

function mixColor(start: string, end: string, amount: number) {
  const a = start.slice(1).match(/.{2}/g)!.map(part => parseInt(part, 16));
  const b = end.slice(1).match(/.{2}/g)!.map(part => parseInt(part, 16));
  return `#${a.map((channel, index) => toHex(channel + (b[index] - channel) * amount)).join("")}`;
}

const COLOR_STOPS = [
  { value: 0, color: "#f1f2f2" },
  { value: 4, color: "#e1e5e6" },
  { value: 6, color: "#9bdfe5" },
  { value: 8, color: "#12bdca" },
  { value: 10, color: "#28ce51" },
  { value: 15, color: "#8fd20c" },
  { value: 20, color: "#ddd000" },
  { value: 25, color: "#ff9800" },
  { value: 30, color: "#ff5600" },
  { value: 35, color: "#ff0080" },
  { value: 40, color: "#d90098" },
  { value: 50, color: "#a000b2" },
];

function windColor(value: number) {
  const bounded = Math.max(0, Math.min(60, value));
  const nextIndex = COLOR_STOPS.findIndex(stop => stop.value >= bounded);
  if (nextIndex <= 0) return COLOR_STOPS[0].color;
  const previous = COLOR_STOPS[nextIndex - 1];
  const next = COLOR_STOPS[nextIndex];
  return mixColor(previous.color, next.color, (bounded - previous.value) / (next.value - previous.value));
}

function textColor(background: string) {
  const channels = background.slice(1).match(/.{2}/g)!.map(part => parseInt(part, 16));
  const luminance = (channels[0] * 299 + channels[1] * 587 + channels[2] * 114) / 1000;
  return luminance > 78 ? "#1f2d33" : "#ffffff";
}

function makePoints(): WindPoint[] {
  return Array.from({ length: FORECAST_HOURS }, (_, index) => {
    const date = new Date(Date.UTC(2026, 7, 30, index * 3));
    const day = DAY_NAMES[date.getUTCDay()];
    const speed = windSpeeds[index % windSpeeds.length];
    return {
      timestamp: date.toISOString(),
      dayLabel: `${day} ${String(date.getUTCDate()).padStart(2, "0")}`,
      hour: String(date.getUTCHours()).padStart(2, "0"),
      speed,
      gust: Math.min(50, speed + gustOffsets[index % gustOffsets.length]),
      direction: directions[index % directions.length],
      isDay: date.getUTCHours() >= 7 && date.getUTCHours() < 21,
    };
  });
}

function DirectionArrow({ degrees }: { degrees: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-7 w-7 shrink-0"
      aria-hidden="true"
      shapeRendering="geometricPrecision"
      style={{ transform: `rotate(${degrees}deg)`, transformOrigin: "center" }}
    >
      <path d="M12 1 20.5 14l-3.4-1.3V23H8.6V12.7L3.5 14 12 1Z" fill="#5e7890" />
    </svg>
  );
}

function dayGroups(points: WindPoint[]) {
  return points.reduce<Array<{ label: string; count: number }>>((groups, point) => {
    const last = groups.at(-1);
    if (last?.label === point.dayLabel) last.count += 1;
    else groups.push({ label: point.dayLabel, count: 1 });
    return groups;
  }, []);
}

function LabelGlyph({ kind }: { kind: "wind" | "gust" | "direction" }) {
  if (kind === "direction") {
    return <span className="text-[17px] leading-none text-[#303b43]">⚑</span>;
  }
  return (
    <span className="text-[10px] leading-3 text-[#47525a]" aria-hidden="true">
      kt
    </span>
  );
}

export function SeaWindForecast() {
  const points = makePoints();
  const width = points.length * POINT_WIDTH;
  const days = dayGroups(points);
  const dayBoundaryIndices = points.reduce<number[]>((indices, point, index) => {
    if (index > 0 && point.dayLabel !== points[index - 1].dayLabel) indices.push(index);
    return indices;
  }, []);
  const grid = { gridTemplateColumns: `repeat(${points.length}, ${POINT_WIDTH}px)` };

  return (
    <div className="overflow-hidden rounded-[10px] border border-[#cbd0d6] bg-[#f5f6f8] font-sans text-[#30353a] shadow-[0_8px_24px_rgba(38,47,57,.1)]">
      <div className="flex min-w-0">
        <aside className="w-[116px] shrink-0 border-r border-[#cbd0d6] bg-[#eceff2] text-[#7a7e82]">
          <div style={{ height: ROW.day }} />
          <div className="flex items-center justify-end gap-2 pr-3 text-[11px]" style={{ height: ROW.hours }}>
            <span>Stunden</span>
            <span className="text-[16px] leading-none text-[#37434b]">◷</span>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-[#d8dce0] pr-3" style={{ height: ROW.wind }}>
            <span className="text-[12px]">Wind</span>
            <LabelGlyph kind="wind" />
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-[#d8dce0] pr-3" style={{ height: ROW.gust }}>
            <span className="text-[12px]">Böen</span>
            <LabelGlyph kind="gust" />
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-[#d8dce0] pr-3" style={{ height: ROW.direction }}>
            <span className="text-right text-[11px] leading-3">Windrichtung</span>
            <LabelGlyph kind="direction" />
          </div>
        </aside>

        <div className="min-w-0 flex-1 overflow-x-auto" style={{ scrollbarWidth: "thin" }}>
          <div className="relative" style={{ minWidth: width }}>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-0" style={{ top: ROW.day }}>
              <div className="grid h-full" style={grid}>
                {points.map(point => (
                  <div key={`shade-${point.timestamp}`} className={point.isDay ? "bg-[#fafbfc]" : "bg-[#e6e9f5]"} />
                ))}
              </div>
            </div>

            <div className="relative z-10">
              <div className="grid bg-[#f7f8fa] text-[13px] font-medium tracking-[.03em] text-[#555c63]" style={{ height: ROW.day, ...grid }}>
                {days.map(day => (
                  <div key={day.label} className="flex items-center border-r border-[#d5d9de] pl-3" style={{ gridColumn: `span ${day.count}` }}>
                    <span className="whitespace-nowrap">{day.label}</span>
                  </div>
                ))}
              </div>
              <div className="grid text-[14px] text-[#717880]" style={{ height: ROW.hours, ...grid }}>
                {points.map(point => (
                  <div key={`hour-${point.timestamp}`} className="flex items-center justify-center">{point.hour}</div>
                ))}
              </div>
              <div className="grid" style={{ height: ROW.wind, ...grid }}>
                {points.map(point => {
                  const background = windColor(point.speed);
                  return <div key={`wind-${point.timestamp}`} className="flex items-center justify-center text-[14px] font-medium" style={{ backgroundColor: background, color: textColor(background) }}>{point.speed}</div>;
                })}
              </div>
              <div className="grid" style={{ height: ROW.gust, ...grid }}>
                {points.map(point => {
                  const background = windColor(point.gust);
                  return <div key={`gust-${point.timestamp}`} className="flex items-center justify-center text-[13px] font-medium" style={{ backgroundColor: background, color: textColor(background) }}>{point.gust}</div>;
                })}
              </div>
              <div className="grid" style={{ height: ROW.direction, ...grid }}>
                {points.map(point => (
                  <div key={`direction-${point.timestamp}`} className="flex items-center justify-center" title={`${point.direction}°`}>
                    <DirectionArrow degrees={point.direction} />
                  </div>
                ))}
              </div>
            </div>

            {dayBoundaryIndices.map(index => (
              <div key={`boundary-${index}`} className="pointer-events-none absolute inset-y-0 z-20 border-l border-[#aeb8c0]" style={{ left: index * POINT_WIDTH }} />
            ))}
            <div className="pointer-events-none absolute z-20 border-l border-dashed border-[#bd8d8d]/75" style={{ left: 4 * POINT_WIDTH + POINT_WIDTH / 2, top: ROW.day, bottom: 0 }} />
          </div>
        </div>
      </div>
    </div>
  );
}