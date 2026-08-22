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
import {
  fetchOpenMeteoWeather,
  getOpenMeteoTimezone,
  preprocessOpenMeteoLocal,
  type OpenMeteoTarget,
} from "./weather-open-meteo.js";

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

function warningCenterFor(
  countryCode: string,
  data: Record<string, unknown>,
  sailingAreaName?: string | null,
): NationalWarningCenter {
  if (countryCode === "GR") {
    const bulletin = data["greeceMarineForecast"] as any;
    return bulletin?.available || bulletin?.text
      ? { status: "integrated", label: "HNMS Griechenland", url: bulletin?.url }
      : { status: "unavailable", label: "HNMS Griechenland", url: bulletin?.url };
  }
  if (countryCode === "HR") {
    const report = data["croatiaAdriaRegional"] as any;
    return report?.xml
      ? { status: "integrated", label: "DHMZ Kroatien", url: report?.url }
      : { status: "unavailable", label: "DHMZ Kroatien", url: report?.url };
  }
  if (countryCode === "AT" && sailingAreaName?.toLowerCase().includes("neusiedler")) {
    const report = data["austriaNeusiedlerLakeWarnings"] as any;
    return report?.text_de
      ? { status: "integrated", label: "LSZ Burgenland", url: report?.url }
      : { status: "unavailable", label: "LSZ Burgenland", url: report?.url };
  }
  return { status: "unsupported" };
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
  // Greece already has an Open-Meteo adapter paired with its HNMS bulletin.
  // Keep that tested integration as-is and avoid duplicate API calls there.
  if (countryCode === "GR") {
    const greece = await fetchGreeceWeather(sailingAreaObj, cityObj, onProgress);
    return {
      ...greece,
      warningCenter: warningCenterFor(countryCode, greece.data, sailingAreaName),
    };
  }

  const targets = targetsFor(coordinates, sailingAreaObj, cityObj);
  const nationalPromise = countryCode === "HR"
    ? fetchCroatiaWeather(sailingAreaName)
    : countryCode === "AT"
      ? fetchAustriaWeather(sailingAreaObj, cityObj)
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
  const genericLocal = preprocessOpenMeteoLocal(
    rawData,
    getOpenMeteoTimezone(countryCode ?? ""),
  );

  if (countryCode === "AT") {
    const nationalWind = await preprocessLocalWindAT(rawData, anthropic, signal);
    const nationalCloudRain = await preprocessLocalCloudRainAT(rawData, anthropic, signal);
    const nationalTemperature = preprocessLocalWeatherAT(rawData);
    return {
      ...genericLocal,
      ...preprocessLocalWarningsNeusiedler(rawData, position.sailingArea),
      nationalWind: nationalWind["wind"],
      nationalCloudRain: nationalCloudRain["cloudRain"],
      nationalTemperature: nationalTemperature["temperature"],
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

  if (countryCode !== "HR") return genericLocal;

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
    ...genericLocal,
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
    nationalTemperature: {
      source: "DHMZ",
      url: "https://prognoza.hr/sedam/hrvatska/7d_meteogrami.xml",
      city: localResult?.city ?? null,
      text_de: localResult?.text_de ?? null,
    },
  };
}
