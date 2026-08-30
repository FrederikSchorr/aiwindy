import React from "react";

export const FORECAST_LABEL_RAIL_WIDTH = 108;
export const FORECAST_POINT_WIDTH = 30;

export function ForecastClockGlyph() {
  return (
    <span
      className="text-[16px] leading-none text-[#37434b]"
      aria-hidden="true"
      data-testid="forecast-clock-glyph"
    >
      ◷
    </span>
  );
}