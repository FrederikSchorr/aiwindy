import fs from "fs";
import path from "path";

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

export interface AnalysisJson {
  date: string;
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
} {
  const now = new Date();
  const data: AnalysisJson = {
    date: now.toISOString(),
    position,
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
      fs.writeFileSync(filePath, JSON.stringify(exportData, replacer, 2), "utf-8");
    } catch (e) {
      console.error("Failed to save analysis JSON:", e);
    }
  };

  return { data, save, filePath };
}
