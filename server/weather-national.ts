import Anthropic from "@anthropic-ai/sdk";
import sailingAreasJson from "../data/sailingareas.json" with { type: "json" };
import {
  fetchAustriaWeather,
  preprocessNationalWeatherAT,
  preprocessLocalWeatherAT,
  preprocessLocalCloudRainAT,
  preprocessLocalWarningsNeusiedler,
} from "./weather-national-austria.js";
import {
  fetchCroatiaWeather,
  preprocessDhmzSynopsis,
  extractDhmzWarning,
  extractDhmzSailingAreaForecast,
  parseDhmzWarningSection,
  preprocessDhmzLocalTemperature,
} from "./weather-national-croatia.js";
import {
  fetchGreeceGaleWarning,
  preprocessGreeceNationalSynopsis,
  extractGreeceWarning,
  preprocessGreeceLocalWind,
  preprocessGreeceLocalWave,
  preprocessGreeceLocalTemperature,
  preprocessGreeceLocalWaterTemp,
} from "./weather-national-greece.js";
import {
  fetchOpenMeteoWeather,
  getOpenMeteoTimezone,
  preprocessOpenMeteoLocal,
  type OpenMeteoTarget,
} from "./weather-open-meteo.js";
import { resolveLocalForecast } from "./weather-local-forecast.js";

function getGreekEmyName(sailingAreaNameDe: string | null): string | null {
  if (!sailingAreaNameDe) return null;
  const reviere = (sailingAreasJson as any)["Griechenland"]?.reviere ?? [];
  const found = reviere.find((r: any) => r.deutsch === sailingAreaNameDe);
  return found?.emy_name ?? null;
}

type SailingAreaObj =
  | {
      name_de: string;
      type: "sea" | "lake";
      coordinates: { lat: number; lon: number };
    }
  | null
  | undefined;
type CityObj =
  | { name_de: string; coordinates: { lat: number; lon: number } }
  | null
  | undefined;

export type NationalWarningCenter = {
  status: "integrated" | "unavailable" | "unsupported";
  label?: string;
  url?: string;
};

const COUNTRY_NAMES: Record<string, string> = {
  AT: "Österreich",
  BE: "Belgien",
  CH: "die Schweiz",
  DE: "Deutschland",
  DK: "Dänemark",
  ES: "Spanien",
  FR: "Frankreich",
  GB: "Großbritannien",
  GR: "Griechenland",
  HR: "Kroatien",
  IE: "Irland",
  IT: "Italien",
  ME: "Montenegro",
  NL: "die Niederlande",
  NO: "Norwegen",
  PL: "Polen",
  PT: "Portugal",
  SE: "Schweden",
  SI: "Slowenien",
  TR: "die Türkei",
};

function warningCenterFor(
  countryCode: string,
  data: Record<string, unknown>,
  sailingAreaName?: string | null,
): NationalWarningCenter {
  if (countryCode === "GR") {
    const bulletin = data["greeceMarineForecast"] as any;
    return bulletin?.available === true
      ? { status: "integrated", label: "HNMS Griechenland", url: bulletin?.url }
      : { status: "unavailable", label: "HNMS Griechenland", url: bulletin?.url };
  }
  if (countryCode === "HR") {
    const regional = data["croatiaAdriaRegional"] as any;
    const adria = data["croatiaAdriaForecast"] as any;
    const report = regional?.xml ? regional : adria;
    return report?.xml
      ? { status: "integrated", label: "DHMZ Kroatien", url: report?.url }
      : { status: "unavailable", label: "DHMZ Kroatien", url: regional?.url ?? adria?.url };
  }
  if (countryCode === "AT" && sailingAreaName?.toLowerCase().includes("neusiedler")) {
    const report = data["austriaNeusiedlerLakeWarnings"] as any;
    return report?.text_de
      ? { status: "integrated", label: "LSZ Burgenland", url: report?.url }
      : { status: "unavailable", label: "LSZ Burgenland", url: report?.url };
  }
  return { status: "unsupported", label: COUNTRY_NAMES[countryCode] ?? countryCode };
}

function targetsFor(
  coordinates: { lat: number; lon: number } | undefined,
  sailingAreaObj: SailingAreaObj,
  cityObj: CityObj,
): { sailingArea: OpenMeteoTarget; city: OpenMeteoTarget } | null {
  const fallback = coordinates ?? sailingAreaObj?.coordinates ?? cityObj?.coordinates;
  if (!fallback) return null;
  return {
    sailingArea: {
      name_de: sailingAreaObj?.name_de ?? cityObj?.name_de ?? "Lokale Prognose",
      coordinates: sailingAreaObj?.coordinates ?? fallback,
    },
    city: {
      name_de: cityObj?.name_de ?? sailingAreaObj?.name_de ?? "Lokale Prognose",
      coordinates: cityObj?.coordinates ?? fallback,
    },
  };
}

export async function fetchNationalWeather(
  countryCode: string,
  coordinates?: { lat: number; lon: number },
  sailingAreaName?: string | null,
  sailingAreaObj?: SailingAreaObj,
  cityObj?: CityObj,
  country?: string,
  onProgress?: (status: string) => void,
): Promise<{
  data: Record<string, unknown>;
  sourceUrls: string[];
  warningCenter: NationalWarningCenter;
}> {
  const targets = targetsFor(coordinates, sailingAreaObj, cityObj);
  const nationalPromise = countryCode === "HR"
    ? fetchCroatiaWeather(sailingAreaName)
    : countryCode === "AT"
      ? fetchAustriaWeather(sailingAreaObj, cityObj)
      : countryCode === "GR"
        ? fetchGreeceGaleWarning(onProgress)
        : Promise.resolve({ data: {} as Record<string, unknown>, sourceUrls: [] as string[] });
  const openMeteoPromise = targets
    ? fetchOpenMeteoWeather(
      targets.sailingArea,
      targets.city,
      getOpenMeteoTimezone(countryCode),
      onProgress,
    )
    : Promise.resolve({ data: {} as Record<string, unknown>, sourceUrls: [] as string[] });
  const [national, openMeteo] = await Promise.all([nationalPromise, openMeteoPromise]);

  return {
    data: { ...national.data, ...openMeteo.data },
    sourceUrls: [...national.sourceUrls, ...openMeteo.sourceUrls],
    warningCenter: warningCenterFor(countryCode, national.data, sailingAreaName),
  };
}

export async function preprocessNationalWeather(
  rawData: Record<string, unknown>,
  anthropic: Anthropic,
  countryCode?: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  if (countryCode === "AT") return preprocessNationalWeatherAT(rawData);
  if (countryCode === "GR") {
    const text = (rawData["greeceMarineForecast"] as any)?.text as string | null;
    return await preprocessGreeceNationalSynopsis(text, anthropic, signal);
  }
  if (countryCode !== "HR") return {};
  const adriaXml = (rawData["croatiaAdriaForecast"] as any)?.xml as
    | string
    | null;
  return {
    synopsis: {
      source: "DHMZ",
      url: "https://prognoza.hr/jadran_h.xml",
      text_de: adriaXml
        ? await preprocessDhmzSynopsis(adriaXml, anthropic, signal)
        : null,
    },
  };
}

export async function preprocessLocalWeather(
  rawData: Record<string, unknown>,
  position: { userInput: string; city: string; sailingArea: string | null },
  anthropic: Anthropic,
  countryCode?: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const resolvedLocalForecast = rawData["resolvedLocalForecast"]
    ?? resolveLocalForecast(rawData, countryCode);
  const effectiveRawData = resolvedLocalForecast
    ? { ...rawData, resolvedLocalForecast }
    : rawData;
  const genericLocal = preprocessOpenMeteoLocal(
    effectiveRawData,
    getOpenMeteoTimezone(countryCode ?? ""),
  );

  if (countryCode === "AT") {
    const nationalCloudRain = await preprocessLocalCloudRainAT(rawData, anthropic, signal);
    const nationalTemperature = preprocessLocalWeatherAT(rawData);
    return {
      ...genericLocal,
      ...preprocessLocalWarningsNeusiedler(rawData, position.sailingArea),
      nationalCloudRain: nationalCloudRain["cloudRain"],
      nationalTemperature: nationalTemperature["temperature"],
    };
  }

  if (countryCode === "GR") {
    const galeData = rawData["greeceMarineForecast"] as Record<string, unknown> | null;
    const emyName = getGreekEmyName(position.sailingArea);
    const [warning, greekWind, greekWave] = await Promise.all([
      extractGreeceWarning(galeData, emyName, anthropic, signal),
      preprocessGreeceLocalWind(rawData, anthropic, signal),
      preprocessGreeceLocalWave(rawData, anthropic, signal),
    ]);
    const genericWind = genericLocal["wind"] as Record<string, unknown> | undefined;
    const nationalWind = greekWind["wind"] as Record<string, unknown> | undefined;
    return {
      ...genericLocal,
      ...warning,
      ...greekWind,
      wind: {
        ...genericWind,
        ...nationalWind,
        hourlyText_de: genericWind?.hourlyText_de ?? null,
      },
      ...greekWave,
      ...preprocessGreeceLocalTemperature(rawData),
      ...preprocessGreeceLocalWaterTemp(rawData),
    };
  }

  if (countryCode !== "HR") return genericLocal;

  const regionalXml = (rawData["croatiaAdriaRegional"] as any)?.xml as
    | string
    | null;
  const adriaXml = (rawData["croatiaAdriaForecast"] as any)?.xml as
    | string
    | null;
  const forecastXml = (rawData["croatiaCityForecast"] as any)?.xml as
    | string
    | null;

  const warningCandidates = [regionalXml, adriaXml]
    .filter((xml): xml is string => typeof xml === "string" && Boolean(xml.trim()))
    .map(xml => ({ xml, section: parseDhmzWarningSection(xml) }));
  const activeWarning = warningCandidates.find(candidate =>
    candidate.section.exists
    && !candidate.section.explicitlyClear
    && Boolean(candidate.section.text),
  );
  const warningText = activeWarning
    ? await extractDhmzWarning(activeWarning.xml, position.sailingArea, anthropic, signal)
    : null;
  const warningChecked = activeWarning
    ? warningText !== null
    : warningCandidates.some(candidate => candidate.section.explicitlyClear);
  const warningDisplayText = warningText ??
    (warningChecked ? "Aktuell: Keine Sturmwarnung von DHMZ" : null);

  const forecastText = regionalXml
    ? await extractDhmzSailingAreaForecast(
        regionalXml,
        position.sailingArea,
        anthropic,
        signal,
      )
    : null;

  const localResult = forecastXml
    ? await preprocessDhmzLocalTemperature(
        forecastXml,
        position.city,
        position.sailingArea,
        anthropic,
        signal,
      )
    : null;

  return {
    ...genericLocal,
    warnings: {
      source: "DHMZ",
      url: "https://prognoza.hr/pomorci.xml",
      sailingArea: position.sailingArea ?? null,
      text_de: warningDisplayText,
      checked: warningChecked,
    },
    sailingareaForecast: {
      source: "DHMZ",
      url: "https://prognoza.hr/pomorci.xml",
      sailingArea: position.sailingArea ?? null,
      text_de: forecastText,
    },
    nationalTemperature: {
      source: "DHMZ",
      url: "https://prognoza.hr/sedam/hrvatska/7d_meteogrami.xml",
      city: localResult?.city ?? null,
      text_de: localResult?.text_de ?? null,
    },
  };
}
