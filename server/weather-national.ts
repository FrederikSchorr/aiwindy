import Anthropic from "@anthropic-ai/sdk";
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
  DHMZ_SOURCE_URL,
} from "./weather-national-croatia.js";

type SailingAreaObj = { name_de: string; type: "sea" | "lake"; coordinates: { lat: number; lon: number } } | null | undefined;
type CityObj = { name_de: string; coordinates: { lat: number; lon: number } } | null | undefined;

export async function fetchNationalWeather(
  countryCode: string,
  coordinates?: { lat: number; lon: number },
  sailingAreaName?: string | null,
  sailingAreaObj?: SailingAreaObj,
  cityObj?: CityObj,
): Promise<{ data: Record<string, unknown>; sourceUrls: string[] }> {
  switch (countryCode) {
    case "HR": return { data: await fetchCroatiaWeather(sailingAreaName), sourceUrls: [DHMZ_SOURCE_URL] };
    case "AT": return fetchAustriaWeather(sailingAreaObj, cityObj);
    default:   return { data: {}, sourceUrls: [] };
  }
}

export async function preprocessNationalWeather(
  rawData: Record<string, unknown>,
  anthropic: Anthropic,
  countryCode?: string,
): Promise<Record<string, unknown>> {
  if (countryCode === "AT") return preprocessNationalWeatherAT(rawData);
  if (countryCode !== "HR") return {};
  const adriaXml = (rawData["croatiaAdriaForecast"] as any)?.xml as string | null;
  return {
    "synopsis": {
      source: "DHMZ",
      url: "https://prognoza.hr/jadran_h.xml",
      text_de: adriaXml ? await preprocessDhmzSynopsis(adriaXml, anthropic) : null,
    },
  };
}

export async function preprocessLocalWeather(
  rawData: Record<string, unknown>,
  position: { userInput: string; city: string; sailingArea: string | null },
  anthropic: Anthropic,
  countryCode?: string,
): Promise<Record<string, unknown>> {
  if (countryCode === "AT") {
    return {
      ...preprocessLocalWarningsNeusiedler(rawData, position.sailingArea),
      ...await preprocessLocalWindAT(rawData, anthropic),
      ...await preprocessLocalCloudRainAT(rawData, anthropic),
      ...preprocessLocalWeatherAT(rawData),
    };
  }

  if (countryCode !== "HR") return {};

  const regionalXml = (rawData["croatiaAdriaRegional"] as any)?.xml as string | null;
  const forecastXml = (rawData["croatiaCityForecast"] as any)?.xml as string | null;

  const warningText = regionalXml
    ? await extractDhmzWarning(regionalXml, position.sailingArea, anthropic)
    : null;

  const forecastText = regionalXml
    ? await extractDhmzSailingAreaForecast(regionalXml, position.sailingArea, anthropic)
    : null;

  const localResult = forecastXml
    ? await preprocessDhmzLocalTemperature(forecastXml, position.city, position.sailingArea, anthropic)
    : null;

  return {
    "warnings": {
      source: "DHMZ",
      url: "https://prognoza.hr/pomorci.xml",
      sailingArea: position.sailingArea ?? null,
      text_de: warningText,
    },
    "sailingarea forecast": {
      source: "DHMZ",
      url: "https://prognoza.hr/pomorci.xml",
      sailingArea: position.sailingArea ?? null,
      text_de: forecastText,
    },
    "temperature": {
      source: "DHMZ",
      url: "https://prognoza.hr/sedam/hrvatska/7d_meteogrami.xml",
      city: localResult?.city ?? null,
      text_de: localResult?.text_de ?? null,
    },
  };
}
