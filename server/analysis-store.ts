import fs from "fs";
import path from "path";
import { saveAnalysis } from "./cache-db.js";

// ── Types ──────────────────────────────────────────────────────────────────

export interface AnalysisPosition {
  userInput: string;
  country: string;
  countryCode: string;
  windyModel: string;
  sailingArea: {
    name_de: string;                          // e.g. "Adria Mitte (Kroatien)"
    type: "sea" | "lake";
    coordinates: { lat: number; lon: number }; // from sailingareas.json
  } | null;
  city: {
    name_de: string;                          // e.g. "Split"
    coordinates: { lat: number; lon: number }; // from Nominatim
  } | null;
  openskiron_domain?: { domain: string; created: string; status: "cached" | "downloaded" };
}

export interface AnalysisSources {
  windy: string[];
  national: string[];
  europe: string[];
}

export interface AnalysisMeta {
  app: string;
  version: string;
  website: string;
  github: string;
  copyright: string;
  requestDate: string;
  finalizedDate?: string;
  durationSec?: number;
}

export interface AnalysisJson {
  meta: AnalysisMeta;
  position: AnalysisPosition;
  sources: AnalysisSources;
  weatherRaw: Record<string, unknown>;
  weatherPreprocessed: {
    europe: Record<string, unknown>;
    national: Record<string, unknown>;
    local: Record<string, unknown>;
  };
  weatherOutput: Record<string, unknown>;
}

// ── Directory setup ────────────────────────────────────────────────────────

const ANALYSES_DIR = path.join(process.cwd(), "analyses");

function ensureDir() {
  if (!fs.existsSync(ANALYSES_DIR)) {
    fs.mkdirSync(ANALYSES_DIR, { recursive: true });
  }
}

// ── Filename ───────────────────────────────────────────────────────────────

function buildFilename(userInput: string, date: Date): string {
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Vienna",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).format(date);
  const [datePart, timePart] = fmt.split(" ");
  const [hh, mm, ss] = timePart.split(":");
  const safeName = userInput.replace(/[\\/:*?"<>|]/g, "").trim().slice(0, 50);
  return `${datePart} ${hh}h${mm}m${ss}s ${safeName}.json`;
}

// ── Public API ─────────────────────────────────────────────────────────────

export function createAnalysis(position: AnalysisPosition): {
  data: AnalysisJson;
  save: () => void;
  filePath: string;
  getExportData: () => Record<string, unknown>;
} {
  const now = new Date();
  const data: AnalysisJson = {
    meta: {
      app: "aiWindy",
      version: "2.0",
      website: "https://aiwindy.schorr.wien",
      github: "https://github.com/FrederikSchorr/aiwindy",
      copyright: "© Frederik Schorr",
      requestDate: now.toISOString(),
    },
    position: { ...position },
    sources: { windy: [], national: [], europe: [] },
    weatherRaw: {},
    weatherPreprocessed: { europe: {}, national: {}, local: {} },
    weatherOutput: {},
  };

  ensureDir();
  const filePath = path.join(ANALYSES_DIR, buildFilename(position.userInput, now));

  const save = () => {
    try {
      const exportData = JSON.parse(JSON.stringify(data));
      const rawGw = exportData.weatherRaw?.["generalWeather"];
      if (rawGw && typeof rawGw.text_de === "string" && rawGw.text_de.length > 100) {
        rawGw.text_de = rawGw.text_de.slice(0, 100) + "...";
      }
      const replacer = (_key: string, value: unknown) => {
        if (_key.endsWith("Base64")) return undefined;
        if ((_key === "austriaWindCloudRain" || _key === "greeceWindWaveCloudRain") && value && typeof value === "object") {
          const obj = { ...(value as Record<string, unknown>) };
          for (const [k, v] of Object.entries(obj)) {
            if (Array.isArray(v) && v.length > 20) obj[k] = v.filter((_, i) => i % 3 === 0);
          }
          return obj;
        }
        if (_key === "greeceTemperature" && value && typeof value === "object") {
          const obj = { ...(value as Record<string, unknown>) };
          delete obj["timestamps"];
          for (const [k, v] of Object.entries(obj)) {
            if (Array.isArray(v) && v.length > 20) obj[k] = v.filter((_, i) => i % 3 === 0);
          }
          return obj;
        }
        if (_key === "xml" && typeof value === "string" && value.length > 2000) return value.slice(0, 2000) + "...";
        return value;
      };
      const jsonStr = JSON.stringify(exportData, replacer, 2);
      fs.writeFileSync(filePath, jsonStr, "utf-8");

      const hasWeatherOutput = exportData.weatherOutput && Object.keys(exportData.weatherOutput).length > 0;
      if (hasWeatherOutput) {
        const finalizedDate = new Date();
        const durationSec = Math.round((finalizedDate.getTime() - now.getTime()) / 1000);
        exportData.meta.finalizedDate = finalizedDate.toISOString();
        exportData.meta.durationSec = durationSec;
        data.meta.finalizedDate = finalizedDate.toISOString();
        data.meta.durationSec = durationSec;
        const finalJsonStr = JSON.stringify(getSanitizedAnalysisExport(data), null, 2);
        fs.writeFileSync(filePath, finalJsonStr, "utf-8");
        const dbData = JSON.parse(finalJsonStr);
        saveAnalysis(dbData).then(
          () => console.log(`[analysis-db] saved: ${position.userInput}`),
          (e) => console.error("[analysis-db] failed to save:", e),
        );
      }
    } catch (e) {
      console.error("Failed to save analysis JSON:", e);
    }
  };

  return {
    data,
    save,
    filePath,
    getExportData: () => getSanitizedAnalysisExport(data),
  };
}

/**
 * Mirrors the persisted analysis JSON while leaving out large chart images and
 * reducing long forecast arrays, so it can be included in feedback email text.
 */
export function getSanitizedAnalysisExport(data: AnalysisJson): Record<string, unknown> {
  const exportData = JSON.parse(JSON.stringify(data));
  const rawGw = exportData.weatherRaw?.["generalWeather"];
  if (rawGw && typeof rawGw.text_de === "string" && rawGw.text_de.length > 100) {
    rawGw.text_de = rawGw.text_de.slice(0, 100) + "...";
  }

  const replacer = (_key: string, value: unknown) => {
    if (_key.endsWith("Base64")) return undefined;
    if ((_key === "austriaWindCloudRain" || _key === "greeceWindWaveCloudRain") && value && typeof value === "object") {
      const obj = { ...(value as Record<string, unknown>) };
      for (const [key, entry] of Object.entries(obj)) {
        if (Array.isArray(entry) && entry.length > 20) obj[key] = entry.filter((_, index) => index % 3 === 0);
      }
      return obj;
    }
    if (_key === "greeceTemperature" && value && typeof value === "object") {
      const obj = { ...(value as Record<string, unknown>) };
      delete obj["timestamps"];
      for (const [key, entry] of Object.entries(obj)) {
        if (Array.isArray(entry) && entry.length > 20) obj[key] = entry.filter((_, index) => index % 3 === 0);
      }
      return obj;
    }
    if (_key === "xml" && typeof value === "string" && value.length > 2000) return value.slice(0, 2000) + "...";
    return value;
  };

  return JSON.parse(JSON.stringify(exportData, replacer));
}
