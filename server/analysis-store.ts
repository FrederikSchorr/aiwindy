import fs from "fs";
import path from "path";

// ── Types ──────────────────────────────────────────────────────────────────

export interface AnalysisPosition {
  userInput: string;
  sailingArea: string | null;
  type: "sea" | "lake" | null;
  country: string;
  countryCode: string;
  coordinates: { lat: number; lon: number };
  location?: string; // Nominatim city name when no sailing area found
}

export interface AnalysisJson {
  date: string;
  position: AnalysisPosition;
  sources: Record<string, unknown>;
  weatherReports: {
    original: Record<string, unknown>;
    preprocessed: Record<string, unknown>;
  };
  outputs: Record<string, unknown>;
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
    sources: {},
    weatherReports: { original: {}, preprocessed: {} },
    outputs: {},
  };

  ensureDir();
  const filePath = path.join(ANALYSES_DIR, buildFilename(position.userInput, now));

  const save = () => {
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    } catch (e) {
      console.error("Failed to save analysis JSON:", e);
    }
  };

  return { data, save, filePath };
}
