import Anthropic from "@anthropic-ai/sdk";
import sailingAreasJson from "../data/sailingareas.json" with { type: "json" };
import {
  fetchAustriaWeather,
  preprocessNationalWeatherAT,
  preprocessLocalWeatherAT,
  preprocessLocalWindAT,
  preprocessLocalCloudRainAT,
  preprocessLocalWarningsNeusiedler,
} from "./weather-national-austria.js";
import {
  fetchCroatiaWeather,
  preprocessDhmzSynopsis,
  extractDhmzWarning,
  extractDhmzSailingAreaForecast,
  preprocessDhmzLocalTemperature,
} from "./weather-national-croatia.js";
import {
  fetchGreeceWeather,
  preprocessGreeceNationalSynopsis,
  extractGreeceWarning,
  preprocessGreeceLocalWind,
  preprocessGreeceLocalWave,
  preprocessGreeceLocalCloudRainThunderstorm,
  preprocessGreeceLocalTemperature,
  preprocessGreeceLocalWaterTemp,
} from "./weather-national-greece.js";

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
}> {
  switch (countryCode) {
    case "HR":
      return fetchCroatiaWeather(sailingAreaName);
    case "AT":
      return fetchAustriaWeather(sailingAreaObj, cityObj);
    case "GR":
      return fetchGreeceWeather(sailingAreaObj, cityObj, onProgress);
    default:
      return {
        data: {},
        sourceUrls: [
          `Keine lokalen Wetterdaten für ${country || countryCode} angebunden`,
        ],
      };
  }
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
  if (countryCode === "AT") {
    return {
      ...preprocessLocalWarningsNeusiedler(rawData, position.sailingArea),
      ...(await preprocessLocalWindAT(rawData, anthropic, signal)),
      ...(await preprocessLocalCloudRainAT(rawData, anthropic, signal)),
      ...preprocessLocalWeatherAT(rawData),
    };
  }

  if (countryCode === "GR") {
    const galeData = rawData["greeceMarineForecast"] as Record<string, unknown> | null;
    const emyName = getGreekEmyName(position.sailingArea);
    return {
      ...(await extractGreeceWarning(galeData, emyName, anthropic, signal)),
      ...(await preprocessGreeceLocalWind(rawData, anthropic, signal)),
      ...(await preprocessGreeceLocalWave(rawData, anthropic, signal)),
      ...(await preprocessGreeceLocalCloudRainThunderstorm(rawData, anthropic, signal)),
      ...preprocessGreeceLocalTemperature(rawData),
      ...preprocessGreeceLocalWaterTemp(rawData),
    };
  }

  if (countryCode !== "HR") return {};

  const regionalXml = (rawData["croatiaAdriaRegional"] as any)?.xml as
    | string
    | null;
  const forecastXml = (rawData["croatiaCityForecast"] as any)?.xml as
    | string
    | null;

  const warningText = regionalXml
    ? await extractDhmzWarning(regionalXml, position.sailingArea, anthropic, signal)
    : null;

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
    warnings: {
      source: "DHMZ",
      url: "https://prognoza.hr/pomorci.xml",
      sailingArea: position.sailingArea ?? null,
      text_de: warningText,
    },
    sailingareaForecast: {
      source: "DHMZ",
      url: "https://prognoza.hr/pomorci.xml",
      sailingArea: position.sailingArea ?? null,
      text_de: forecastText,
    },
    temperature: {
      source: "DHMZ",
      url: "https://prognoza.hr/sedam/hrvatska/7d_meteogrami.xml",
      city: localResult?.city ?? null,
      text_de: localResult?.text_de ?? null,
    },
  };
}
