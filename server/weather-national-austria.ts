import Anthropic from "@anthropic-ai/sdk";

// ── Constants ─────────────────────────────────────────────────────────────────

export const AUSTROCONTROL_URL = "https://www.austrocontrol.at/wetter/wetter_fuer_alle/wettervorhersage";
export const GEOSPHERE_TIMESERIES_URL = "https://dataset.api.hub.geosphere.at/v1/timeseries/forecast/nwp-v1-1h-2500m";
export const GEOSPHERE_SOURCE_URL = "https://www.geosphere.at/de/karten/wetterprognose/";
export const LSZ_BURGENLAND_URL = "https://www.lsz-b.at/fuer-buergerinnen/sturmwarnung-webcams/";

type SailingAreaObj = { name_de: string; type: "sea" | "lake"; coordinates: { lat: number; lon: number } } | null | undefined;
type CityObj = { name_de: string; coordinates: { lat: number; lon: number } } | null | undefined;

// ── Fetch ─────────────────────────────────────────────────────────────────────

export async function fetchAustriaWeather(
  sailingAreaObj?: SailingAreaObj,
  cityObj?: CityObj,
): Promise<{ data: Record<string, unknown>; sourceUrls: string[] }> {
  const windCoords = sailingAreaObj?.coordinates ?? cityObj?.coordinates ?? { lat: 47.8, lon: 13.0 };
  const tempCoords = cityObj?.coordinates ?? sailingAreaObj?.coordinates ?? { lat: 47.8, lon: 13.0 };
  const isNeusiedler = sailingAreaObj?.name_de?.toLowerCase().includes("neusiedler") ?? false;

  const [flightWeather, windCloudRain, temperature, lakeWarnings] = await Promise.all([
    fetchAustriaFlightWeather(),
    fetchAustriaWindCloudRain(windCoords, sailingAreaObj, cityObj),
    fetchAustriaTemperature(tempCoords, cityObj ?? sailingAreaObj),
    fetchNeusiedlerLakeWarnings(isNeusiedler),
  ]);
  const data: Record<string, unknown> = { ...flightWeather, ...windCloudRain, ...temperature, ...lakeWarnings };
  const sourceUrls = [AUSTROCONTROL_URL, GEOSPHERE_SOURCE_URL];
  if (Object.keys(lakeWarnings).length > 0) sourceUrls.push(LSZ_BURGENLAND_URL);
  return { data, sourceUrls };
}

async function fetchAustriaFlightWeather(): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(AUSTROCONTROL_URL, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/html" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) { console.error(`Austrocontrol fetch failed (${res.status})`); return {}; }
    const html = await res.text();
    const clean = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/\s+/g, " ").trim();

    const start = clean.search(/FXOS\d+/);
    if (start < 0) { console.error("Austrocontrol: no forecast section found"); return {}; }
    const forecastSection = clean.slice(start);

    const rawBlocks = forecastSection.split(/(FXOS\d+)/);
    const blocks: string[] = [rawBlocks[0]];
    for (let i = 1; i < rawBlocks.length; i += 2) {
      blocks.push(rawBlocks[i] + (rawBlocks[i + 1] ?? ""));
    }

    const trunc = (s: string) => s.length > 1000 ? s.slice(0, 1000) + "..." : s;
    return {
      "austriaFlightWeather": {
        source: "Austrocontrol",
        url: AUSTROCONTROL_URL,
        today_de:    blocks[1] ? trunc(blocks[1].trim()) : null,
        tonight_de:  blocks[2] ? trunc(blocks[2].trim()) : null,
        tomorrow_de: blocks[3] ? trunc(blocks[3].trim()) : null,
      },
    };
  } catch (e) {
    console.error("fetchAustriaFlightWeather error:", e instanceof Error ? e.message : e);
    return {};
  }
}

async function fetchAustriaWindCloudRain(
  coords: { lat: number; lon: number },
  sailingAreaObj: SailingAreaObj,
  cityObj: CityObj,
): Promise<Record<string, unknown>> {
  const { lat, lon } = coords;
  const url = `${GEOSPHERE_TIMESERIES_URL}?parameters=u10m,v10m,ugust,vgust,tcc,rr_acc&lat_lon=${lat},${lon}`;
  try {
    const res = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) { console.error(`GeoSphere windCloudRain fetch failed (${res.status})`); return nullWindCloudRain(sailingAreaObj, cityObj); }
    const data = await res.json() as {
      timestamps: string[];
      features: Array<{ properties: { parameters: Record<string, { data: number[] }> } }>;
    };
    const timestamps = data.timestamps;
    const params = data.features[0].properties.parameters;

    const windDir = (u: number, v: number): string => {
      const deg = (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360;
      const dirs = ["N","NNO","NO","ONO","O","OSO","SO","SSO","S","SSW","SW","WSW","W","WNW","NW","NNW"];
      return dirs[Math.round(deg / 22.5) % 16];
    };
    const windSpeedKt = (u: number, v: number) =>
      Math.round(Math.sqrt(u * u + v * v) * 1.94384 * 10) / 10;

    const locationRef = sailingAreaObj ? { sailingArea: sailingAreaObj } : { city: cityObj };
    return {
      "austriaWindCloudRain": {
        source: "GeoSphere Austria",
        url: GEOSPHERE_TIMESERIES_URL,
        ...locationRef,
        timestamps,
        wind_speed_kt: timestamps.map((_, i) => windSpeedKt(params.u10m.data[i], params.v10m.data[i])),
        wind_dir:      timestamps.map((_, i) => windDir(params.u10m.data[i], params.v10m.data[i])),
        gust_kt:       timestamps.map((_, i) => windSpeedKt(params.ugust.data[i], params.vgust.data[i])),
        cloud_cover:   timestamps.map((_, i) => Math.round(params.tcc.data[i] * 100)),
        "rain_kgm-2":  params.rr_acc.data,
      },
    };
  } catch (e) {
    console.error("fetchAustriaWindCloudRain error:", e instanceof Error ? e.message : e);
    return nullWindCloudRain(sailingAreaObj, cityObj);
  }
}

function nullWindCloudRain(sailingAreaObj: SailingAreaObj, cityObj: CityObj): Record<string, unknown> {
  const locationRef = sailingAreaObj ? { sailingArea: sailingAreaObj } : { city: cityObj };
  return {
    "austriaWindCloudRain": {
      source: "GeoSphere Austria",
      url: GEOSPHERE_TIMESERIES_URL,
      ...locationRef,
      timestamps: null, wind_speed_kt: null, wind_dir: null,
      gust_kt: null, cloud_cover: null, "rain_kgm-2": null,
    },
  };
}

async function fetchAustriaTemperature(
  coords: { lat: number; lon: number },
  locationObj: SailingAreaObj | CityObj,
): Promise<Record<string, unknown>> {
  const { lat, lon } = coords;
  const url = `${GEOSPHERE_TIMESERIES_URL}?parameters=t2m&lat_lon=${lat},${lon}`;
  try {
    const res = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) { console.error(`GeoSphere temperature fetch failed (${res.status})`); return nullTemperature(locationObj); }
    const data = await res.json() as {
      timestamps: string[];
      features: Array<{ properties: { parameters: Record<string, { data: number[] }> } }>;
    };
    const params = data.features[0].properties.parameters;
    return {
      "austriaTemperature": {
        source: "GeoSphere Austria",
        url: GEOSPHERE_TIMESERIES_URL,
        city: locationObj,
        temp_2m_C: params.t2m.data,
      },
    };
  } catch (e) {
    console.error("fetchAustriaTemperature error:", e instanceof Error ? e.message : e);
    return nullTemperature(locationObj);
  }
}

function nullTemperature(locationObj: SailingAreaObj | CityObj): Record<string, unknown> {
  return {
    "austriaTemperature": {
      source: "GeoSphere Austria",
      url: GEOSPHERE_TIMESERIES_URL,
      city: locationObj,
      temp_2m_C: null,
    },
  };
}

async function fetchNeusiedlerLakeWarnings(isNeusiedler: boolean): Promise<Record<string, unknown>> {
  if (!isNeusiedler) return {};
  try {
    const res = await fetch(LSZ_BURGENLAND_URL, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) { console.error(`LSZ Burgenland fetch failed (${res.status})`); return {}; }
    const html = await res.text();
    const matches = Array.from(html.matchAll(/<title>([^<]+?)<br \/>([^<]+?)<\/title>/g));
    if (!matches.length) return {};
    const text_de = matches.map(m => `${m[1]}: ${m[2]}`).join("\n");
    return {
      "austriaNeusiedlerLakeWarnings": {
        source: "LSZ Burgenland",
        url: LSZ_BURGENLAND_URL,
        text_de,
      },
    };
  } catch (e) {
    console.error("fetchNeusiedlerLakeWarnings error:", e instanceof Error ? e.message : e);
    return {};
  }
}

// ── Preprocessing ─────────────────────────────────────────────────────────────

export function preprocessNationalWeatherAT(rawData: Record<string, unknown>): Record<string, unknown> {
  const flight = rawData["austriaFlightWeather"] as any;
  const url: string | null = flight?.url ?? null;

  const parts: string[] = [];
  const today = extractWetterlage(flight?.today_de);
  if (today) parts.push(`Heute tagsüber: ${today}`);
  const tonight = extractWetterlage(flight?.tonight_de);
  if (tonight) parts.push(`Kommende Nacht: ${tonight}`);
  const tomorrow = extractWetterlage(flight?.tomorrow_de);
  if (tomorrow) parts.push(`Morgen: ${tomorrow}`);

  return {
    "synopsis": {
      source: "Austrocontrol",
      url,
      text_de: parts.length ? parts.join("\n\n") : null,
    },
  };
}

function extractWetterlage(block: string | null | undefined): string | null {
  if (!block) return null;
  const match = block.match(/WETTERLAGE\s*:\s*([\s\S]*?)\s*\.\s*(?:WETTERABLAUF|HINWEISE)/);
  return match ? match[1].trim() : null;
}

export function preprocessLocalWeatherAT(rawData: Record<string, unknown>): Record<string, unknown> {
  const windCloudRain = rawData["austriaWindCloudRain"] as any;
  const tempData = rawData["austriaTemperature"] as any;
  const url: string | null = tempData?.url ?? null;

  if (!windCloudRain?.timestamps || !tempData?.temp_2m_C) {
    return { "temperature": { source: "GeoSphere Austria", url, text_de: null } };
  }

  const TZ = 2; // CEST = UTC+2
  const DAY_NAMES: Record<number, string> = { 1: "Mo", 2: "Di", 3: "Mi", 4: "Do", 5: "Fr", 6: "Sa", 0: "So" };

  const byDate = new Map<string, number[]>();
  for (let i = 0; i < windCloudRain.timestamps.length; i++) {
    const local = new Date(new Date(windCloudRain.timestamps[i]).getTime() + TZ * 3600000);
    const day = local.toISOString().slice(0, 10);
    const dayName = DAY_NAMES[local.getUTCDay()];
    const parts = day.split("-");
    const label = `${dayName} ${parts[2]}.${parts[1]}`;
    if (!byDate.has(label)) byDate.set(label, []);
    byDate.get(label)!.push(tempData.temp_2m_C[i]);
  }

  const lines = Array.from(byDate.entries())
    .slice(0, 3)
    .map(([day, temps]) => `${day}: ${Math.min(...temps)}–${Math.max(...temps)}°C`);

  return {
    "temperature": {
      source: "GeoSphere Austria",
      url,
      text_de: lines.join("\n"),
    },
  };
}

export async function preprocessLocalWindAT(
  rawData: Record<string, unknown>,
  anthropic: Anthropic,
): Promise<Record<string, unknown>> {
  const forecast = rawData["austriaWindCloudRain"] as any;
  const url: string | null = forecast?.url ?? null;
  if (!forecast?.timestamps || !forecast?.wind_speed_kt) {
    return { "wind": { source: "GeoSphere Austria", url, text_de: null } };
  }

  const TZ = 2; // CEST
  const DAY_NAMES: Record<number, string> = { 1: "Mo", 2: "Di", 3: "Mi", 4: "Do", 5: "Fr", 6: "Sa", 0: "So" };

  type Row = { time: string; dir: string; spd: number; gust: number };
  const byDate = new Map<string, Row[]>();

  for (let i = 0; i < forecast.timestamps.length; i++) {
    const local = new Date(new Date(forecast.timestamps[i]).getTime() + TZ * 3600000);
    const hour = local.getUTCHours();
    if (hour < 6 || hour > 20) continue;
    const day = local.toISOString().slice(0, 10);
    const dayName = DAY_NAMES[local.getUTCDay()];
    const parts = day.split("-");
    const label = `${dayName} ${parts[2]}.${parts[1]}`;
    if (!byDate.has(label)) byDate.set(label, []);
    byDate.get(label)!.push({
      time: `${String(hour).padStart(2, "0")}:00`,
      dir: forecast.wind_dir[i],
      spd: Math.round(forecast.wind_speed_kt[i]),
      gust: Math.round(forecast.gust_kt[i]),
    });
  }

  const days = Array.from(byDate.entries()).slice(0, 2);
  if (!days.length) return { "wind": { source: "GeoSphere Austria", url, text_de: null } };

  const table = days.map(([label, rows]) => {
    const rowStr = rows.map(r => `${r.time} ${r.dir} ${r.spd}kt Böe ${r.gust}kt`).join("  ");
    return `${label}:\n${rowStr}`;
  }).join("\n\n");

  const prompt = `Du bist ein Segelwetter-Experte. Beschreibe den Windverlauf für jeden Tag in je einem deutschen Satz (max. 25 Wörter). Nenne Richtung, Stärke in Knoten, Böen und signifikante Änderungen im Tagesverlauf. Format: "Di 31.03: ...\nMi 01.04: ..."

${table}`;

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    });
    const text = (msg.content[0] as any)?.text?.trim() ?? null;
    return { "wind": { source: "GeoSphere Austria", url, text_de: text } };
  } catch {
    return { "wind": { source: "GeoSphere Austria", url, text_de: null } };
  }
}

export async function preprocessLocalCloudRainAT(
  rawData: Record<string, unknown>,
  anthropic: Anthropic,
): Promise<Record<string, unknown>> {
  const forecast = rawData["austriaWindCloudRain"] as any;
  const url: string | null = forecast?.url ?? null;
  if (!forecast?.timestamps || !forecast?.["rain_kgm-2"] || !forecast?.cloud_cover) {
    return { "cloud_rain": { source: "GeoSphere Austria", url, text_de: null } };
  }

  const TZ = 2; // CEST
  const DAY_NAMES: Record<number, string> = { 1: "Mo", 2: "Di", 3: "Mi", 4: "Do", 5: "Fr", 6: "Sa", 0: "So" };

  const rainCum: number[] = forecast["rain_kgm-2"];
  const rainDelta = rainCum.map((v: number, i: number) => Math.max(0, v - (i > 0 ? rainCum[i - 1] : 0)));

  type Row = { time: string; cloud: number; rain: number };
  const byDate = new Map<string, Row[]>();

  for (let i = 0; i < forecast.timestamps.length; i++) {
    const local = new Date(new Date(forecast.timestamps[i]).getTime() + TZ * 3600000);
    const hour = local.getUTCHours();
    if (hour < 6 || hour > 20) continue;
    const day = local.toISOString().slice(0, 10);
    const dayName = DAY_NAMES[local.getUTCDay()];
    const parts = day.split("-");
    const label = `${dayName} ${parts[2]}.${parts[1]}`;
    if (!byDate.has(label)) byDate.set(label, []);
    byDate.get(label)!.push({
      time: `${String(hour).padStart(2, "0")}:00`,
      cloud: forecast.cloud_cover[i],
      rain: Math.round(rainDelta[i] * 10) / 10,
    });
  }

  const days = Array.from(byDate.entries()).slice(0, 2);
  if (!days.length) return { "cloud_rain": { source: "GeoSphere Austria", url, text_de: null } };

  const table = days.map(([label, rows]) => {
    const rowStr = rows.map(r => `${r.time} ${r.cloud}% ${r.rain}mm`).join("  ");
    return `${label}:\n${rowStr}`;
  }).join("\n\n");

  const prompt = `Du bist ein Segelwetter-Experte. Beschreibe Bewölkung und Niederschlag für jeden Tag in je einem deutschen Satz (max. 20 Wörter). Nenne Bewölkungsgrad und ob/wann es regnet. Format: "Di 31.03: ...\nMi 01.04: ..."

${table}`;

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 150,
      messages: [{ role: "user", content: prompt }],
    });
    const text = (msg.content[0] as any)?.text?.trim() ?? null;
    return { "cloud_rain": { source: "GeoSphere Austria", url, text_de: text } };
  } catch {
    return { "cloud_rain": { source: "GeoSphere Austria", url, text_de: null } };
  }
}

export function preprocessLocalWarningsNeusiedler(
  rawData: Record<string, unknown>,
  sailingArea: string | null,
): Record<string, unknown> {
  if (!sailingArea?.toLowerCase().includes("neusiedler")) return {};
  const text = (rawData["austriaNeusiedlerLakeWarnings"] as any)?.text_de as string | null;
  const url: string | null = (rawData["austriaNeusiedlerLakeWarnings"] as any)?.url ?? null;
  let warning: string;
  if (text?.includes("Sturmwarnung")) {
    warning = "Aktuell: Sturmwarnung der LSZ Burgenland";
  } else if (text?.includes("Windwarnung")) {
    warning = "Aktuell: Starkwindwarnung der LSZ Burgenland";
  } else {
    warning = "Aktuell: Keine Sturmwarnung der LSZ Burgenland";
  }
  return { "warnings": { source: "LSZ Burgenland", url, text_de: warning } };
}
