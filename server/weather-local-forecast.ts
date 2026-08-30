type JsonRecord = Record<string, any>;

const COMPASS_DIRECTIONS = [
  "N", "NNO", "NO", "ONO", "O", "OSO", "SO", "SSO",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
] as const;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function timestampKey(timestamp: unknown, timezone: string): string | null {
  if (typeof timestamp !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})(?::(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?(Z|[+-]\d{2}:?\d{2})?$/i.exec(timestamp);
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fractionText, offsetText] = match;
  if (offsetText && minuteText === undefined) return null;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText ?? "00");
  const second = Number(secondText ?? "00");
  const millisecond = Number((fractionText ?? "").padEnd(3, "0") || "0");
  const validationDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
  if (
    validationDate.getUTCFullYear() !== year
    || validationDate.getUTCMonth() !== month - 1
    || validationDate.getUTCDate() !== day
    || validationDate.getUTCHours() !== hour
    || validationDate.getUTCMinutes() !== minute
    || validationDate.getUTCSeconds() !== second
  ) return null;

  const fractionKey = millisecond ? `.${String(millisecond).padStart(3, "0")}` : "";
  if (!offsetText) {
    return `${yearText}-${monthText}-${dayText}T${hourText}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}${fractionKey}`;
  }

  const normalizedOffset = offsetText.toUpperCase() === "Z"
    ? "Z"
    : offsetText.includes(":")
      ? offsetText
      : `${offsetText.slice(0, 3)}:${offsetText.slice(3)}`;
  const offsetHours = normalizedOffset === "Z" ? 0 : Number(normalizedOffset.slice(1, 3));
  const offsetMinutes = normalizedOffset === "Z" ? 0 : Number(normalizedOffset.slice(4, 6));
  if (offsetHours > 23 || offsetMinutes > 59) return null;
  const instant = new Date(
    `${yearText}-${monthText}-${dayText}T${hourText}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}${fractionKey}${normalizedOffset}`,
  );
  if (!Number.isFinite(instant.getTime())) return null;
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      }).formatToParts(instant).map(part => [part.type, part.value]),
    );
    return parts.year && parts.month && parts.day && parts.hour && parts.minute && parts.second
      ? `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${fractionKey}`
      : null;
  } catch {
    return null;
  }
}

function compassDegrees(value: unknown): number | null {
  const numeric = finiteNumber(value);
  if (numeric !== null) return ((numeric % 360) + 360) % 360;
  if (typeof value !== "string") return null;
  const index = COMPASS_DIRECTIONS.indexOf(
    value.trim().toUpperCase() as typeof COMPASS_DIRECTIONS[number],
  );
  return index === -1 ? null : index * 22.5;
}

function cumulativeIntervals(values: unknown[]): Array<number | null> {
  return values.map((value, index) => {
    const current = finiteNumber(value);
    if (current === null) return null;
    const previous = index > 0 ? finiteNumber(values[index - 1]) : 0;
    const delta = previous === null || current < previous ? current : current - previous;
    return Math.max(0, Math.round(delta * 100) / 100);
  });
}

function overlayByTimestamp(
  targetHourly: JsonRecord | null | undefined,
  source: JsonRecord | null | undefined,
  timezone: string,
  fields: Array<{
    target: string;
    source: string;
    transform?: (value: unknown) => number | null;
  }>,
): boolean {
  const targetTimestamps = Array.isArray(targetHourly?.timestamps) ? targetHourly.timestamps : [];
  const sourceTimestamps = Array.isArray(source?.timestamps) ? source.timestamps : [];
  if (!targetTimestamps.length || !sourceTimestamps.length) return false;

  const sourceIndex = new Map<string, number | null>();
  sourceTimestamps.forEach((timestamp, index) => {
    const key = timestampKey(timestamp, timezone);
    if (!key) return;
    sourceIndex.set(key, sourceIndex.has(key) ? null : index);
  });
  const targetKeys = targetTimestamps.map(timestamp => timestampKey(timestamp, timezone));
  const targetKeyCounts = new Map<string, number>();
  targetKeys.forEach(key => {
    if (key) targetKeyCounts.set(key, (targetKeyCounts.get(key) ?? 0) + 1);
  });

  let used = false;
  for (const field of fields) {
    const sourceValues = Array.isArray(source?.[field.source]) ? source[field.source] : [];
    if (!sourceValues.length) continue;
    const targetValues = Array.isArray(targetHourly?.[field.target])
      ? [...targetHourly[field.target]]
      : targetTimestamps.map(() => null);
    targetTimestamps.forEach((_timestamp, targetIndex) => {
      const key = targetKeys[targetIndex];
      if (!key || targetKeyCounts.get(key) !== 1) return;
      const index = key ? sourceIndex.get(key) : undefined;
      if (index === undefined || index === null) return;
      const value = field.transform
        ? field.transform(sourceValues[index])
        : finiteNumber(sourceValues[index]);
      if (value === null) return;
      targetValues[targetIndex] = value;
      used = true;
    });
    targetHourly![field.target] = targetValues;
  }
  return used;
}

function structuredSources(rawData: JsonRecord, countryCode?: string): {
  wind: JsonRecord[];
  city: JsonRecord[];
} {
  const declared = Array.isArray(rawData.structuredLocalForecasts)
    ? rawData.structuredLocalForecasts.filter((entry: unknown) => entry && typeof entry === "object")
    : [];
  const wind = declared.filter((entry: JsonRecord) => entry.target === "wind");
  const city = declared.filter((entry: JsonRecord) => entry.target === "city");

  if (countryCode === "AT") {
    if (rawData.austriaWindCloudRain) wind.unshift(rawData.austriaWindCloudRain);
    if (rawData.austriaCityCloudRain) city.unshift({
      ...rawData.austriaCityCloudRain,
      rainMm: cumulativeIntervals(
        Array.isArray(rawData.austriaCityCloudRain.rainKgm2)
          ? rawData.austriaCityCloudRain.rainKgm2
          : [],
      ),
    });
    if (rawData.austriaTemperature) city.unshift(rawData.austriaTemperature);
  }
  return { wind, city };
}

export function resolveLocalForecast(
  rawData: JsonRecord,
  countryCode?: string,
): JsonRecord | null {
  const baseline = rawData.openMeteoForecast;
  if (!baseline || typeof baseline !== "object") return null;
  const resolved = clone(baseline);
  const timezone = typeof resolved.timezone === "string" ? resolved.timezone : "UTC";
  const sailingHourly = resolved.sailingArea?.hourly;
  const cityHourly = resolved.city?.hourly;
  const providers = structuredSources(rawData, countryCode);
  const windSources = new Set<string>();
  const citySources = new Set<string>();

  for (const source of providers.wind) {
    const used = overlayByTimestamp(sailingHourly, source, timezone, [
      { target: "windSpeedKt", source: "windSpeedKt" },
      { target: "gustKt", source: "gustKt" },
      { target: "windDirDeg", source: "windDirDeg", transform: compassDegrees },
      { target: "windDirDeg", source: "windDir", transform: compassDegrees },
    ]);
    if (used && typeof source.source === "string") windSources.add(source.source);
  }

  for (const source of providers.city) {
    const used = overlayByTimestamp(cityHourly, source, timezone, [
      { target: "temp2mC", source: "temp2mC" },
      { target: "cloudCoverPct", source: "cloudCover" },
      { target: "rainMm", source: "rainMm" },
    ]);
    if (used && typeof source.source === "string") citySources.add(source.source);
  }

  const baselineSource = typeof baseline.source === "string"
    ? baseline.source
    : "Open-Meteo Forecast API";
  resolved.source = "Priorisierte lokale Prognose";
  if (resolved.sailingArea) {
    resolved.sailingArea.source = [...windSources, baselineSource].join(" + ");
  }
  if (resolved.city) {
    resolved.city.source = [...citySources, baselineSource].join(" + ");
  }
  resolved.resolvedSources = {
    wind: [...windSources, baselineSource],
    city: [...citySources, baselineSource],
  };
  return resolved;
}