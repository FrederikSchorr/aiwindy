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
  const pad = (n: number) => String(n).padStart(2, "0");
  const datePart = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const timePart = `${pad(date.getHours())}h${pad(date.getMinutes())}m${pad(date.getSeconds())}s`;
  const safeName = userInput.replace(/[\\/:*?"<>|]/g, "").trim().slice(0, 50);
  return `${datePart} ${timePart} ${safeName}.json`;
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
      const replacer = (_key: string, value: unknown) => {
        if (_key.endsWith("Base64")) return undefined;
        if ((_key === "austriaWindCloudRain" || _key === "greeceWindWaveCloudRain") && value && typeof value === "object") {
          const obj = { ...(value as Record<string, unknown>) };
          delete obj["cape"];
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
      fs.writeFileSync(filePath, JSON.stringify(data, replacer, 2), "utf-8");
    } catch (e) {
      console.error("Failed to save analysis JSON:", e);
    }
  };

  return { data, save, filePath };
}
