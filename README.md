# AIWindy — AI-Powered Sailing Weather Advisor

An AI-powered sailing weather analysis app that combines European synoptic data, national weather services, and high-resolution regional models to generate structured sailing forecasts.

---

## Architecture Overview

```
Client (React + Vite)
  └── POST /api/chat (SSE)
        ├── Message classification (GPT-4.1-mini)
        ├── Location detection (Claude Sonnet)
        ├── European weather data
        │   ├── Meteonews (general overview text)
        │   ├── Wetterzentrale (850 hPa charts)
        │   └── KNMI (front analysis charts)
        ├── National weather data (per country)
        │   ├── AT: GeoSphere Austria JSON APIs
        │   ├── HR: DHMZ XML feeds
        │   └── GR: EMY gale warnings + OpenSkiron WRF 4km GRIB
        ├── LLM preprocessing (Claude Haiku/Sonnet)
        └── Weather output generation (5 sections, Claude/GPT)
```

The backend pipeline is **JSON-based**: raw data → preprocessed structured text → AI-generated output sections. Each stage writes to a persistent analysis JSON file (`analyses/`).

---

## Data Sources

### European (all locations)

| Source | Data | File |
|---|---|---|
| [Meteonews](https://www.meteonews.at/de/Allgemeine_Lage/K33/Europa) | General European weather overview (German text) | `server/weather-europe.ts` |
| [Wetterzentrale](https://www.wetterzentrale.de) | 850 hPa temperature / air mass charts (images) | `server/weather-europe.ts` |
| [KNMI](https://www.knmi.nl) | Weather fronts analysis chart (image) | `server/weather-europe.ts` |

### National (per country)

| Country | Source | Data |
|---|---|---|
| 🇦🇹 Austria | GeoSphere Austria JSON APIs | Hourly wind, temperature, precipitation, cloud cover for sailing area and city |
| 🇭🇷 Croatia | DHMZ XML feeds | Adriatic forecast text + city meteogram temperatures |
| 🇬🇷 Greece | EMY (HNMS) gale warnings + OpenSkiron WRF 4km GRIB | Wind, gust, rain, CAPE, cloud cover, 2m temperature |

Other countries supported for general chat context (scraping fallback): DE, IT, FR, SI, ME, GB, NL, ES, PT, TR, DK, SE, NO, PL, CH.

---

## OpenSkiron WRF 4km Integration (Greece)

OpenSkiron publishes high-resolution (4 km) WRF numerical weather model output for Greek waters as GRIB1 files (`.grb.bz2`). Since GRIB parsing is not possible in Node.js/TypeScript, a Python subprocess handles fetch and extraction.

### Domain Coverage

| OpenSkiron Domain | Greek Sailing Areas |
|---|---|
| `Ionian_Islands_4km` | Ionisches Meer Nord, Ionisches Meer Süd, Patraikos, Korinthiakos, Kythira-See |
| `Aegean_SW_4km` | Kretisches Meer West/Ost, Saronischer Golf, Ägäis Mitte/Südwest/Südost |
| `Aegean_NW_4km` | Ägäis Nordwest/Nordost, Thrakisches Meer, Thermaikos Golf |
| `Aegean_SE_4km` | Dodekanes |

Each sailing area in `data/sailingareas.json` has an `openskiron_domain` field pointing to its domain.

### Python Script: `scripts/openskiron_fetch.py`

```
python scripts/openskiron_fetch.py <domain> <wind_lat> <wind_lon> <city_lat> <city_lon>
```

**Workflow:**
1. Scrapes `https://openskiron.org/en/openwrf` to discover the current timestamped URL (e.g. `Ionian_Islands_4km_WRF_WAM_260403-00.grb.bz2`)
2. Downloads and bz2-decompresses if not already cached in `cache/openskiron/`; URL is stored in a `.url` sidecar file to detect staleness
3. Opens GRIB1 with `cfgrib.open_dataset()` using GRIB1 parameter IDs (shortNames are `unknown` due to non-standard WRF table):
   - Param 33 / `heightAboveGround/10` → U wind component (m/s)
   - Param 34 / `heightAboveGround/10` → V wind component (m/s)
   - Param 180 / `surface` → Wind gust speed (m/s)
   - Param 61 / `surface` → Cumulative precipitation (mm)
   - Param 157 / `surface` → CAPE (J/kg)
   - Param 71 / `entireAtmosphere` → Total cloud cover (%, already 0–100)
   - Param 11 / `heightAboveGround/2` → 2m temperature (K)
4. Extracts full hourly time series (typically 49 steps, 0–48h) at nearest grid point
5. Outputs JSON to stdout:

```json
{
  "timestamps": ["2026-04-03T00:00:00Z", "..."],
  "windSpeedKt": [7.2, 8.1, "..."],
  "windDir": ["SW", "NW", "..."],
  "gustKt": [7.2, 9.3, "..."],
  "rainMm": [0.0, 0.12, "..."],
  "cape": [473, 320, "..."],
  "cloudCover": [10, 35, "..."],
  "waterTempC": [null, "..."],
  "temp2mC": [11.0, 14.5, "..."]
}
```

Note: `waterTempC` is `null` in current OpenSkiron GRIB files (SST not included in WRF output).

### Windows ecCodes Setup

On Windows, `cfgrib` requires native ecCodes DLLs that aren't included in the pip package. The following DLLs must be placed in `%APPDATA%\Python\Python3XX\Scripts\` (or alongside the script):

```
eccodes.dll, eccodes_memfs.dll, aec.dll, jasper.dll, libjpeg.dll,
jpeg8.dll, libpng16.dll, szip.dll, turbojpeg.dll, zlib.dll
```

These can be extracted from Anaconda/conda-forge packages. The script's Windows DLL setup block automatically adds this directory to `PATH` and calls `os.add_dll_directory()` before importing cfgrib.

`ECCODES_LOG_LEVEL=0` is set by the TypeScript spawn call to suppress C-level warnings from ecCodes when processing GRIB1 missingValue flags.

---

## Raw Data Schema (`weatherRaw`)

Each national integration populates `analysis.data.weatherRaw` with typed entries. For Greece:

### `greeceWindCloudRain`
Full hourly forecast time series at **sailing area coordinates**:
```typescript
{
  source: "OpenSkiron WRF 4km",
  url: "https://openskiron.org/gribs_wrf_4km/",
  sailingArea: { name_de: string, coordinates: { lat, lon } },
  timestamps: string[],     // ISO 8601 UTC
  windSpeedKt: number[],
  windDir: string[],        // 16-point compass (N/NNW/NW/…)
  gustKt: number[],
  rainMm: number[],         // hourly delta (not cumulative)
  cape: number[],           // J/kg
  cloudCover: number[],     // % (0–100)
  waterTempC: null[],       // null (not in WRF output)
}
```

### `greeceTemperature`
Full hourly forecast time series at **city coordinates**:
```typescript
{
  source: "OpenSkiron WRF 4km",
  url: "https://openskiron.org/gribs_wrf_4km/",
  city: { name_de: string, coordinates: { lat, lon } },
  timestamps: string[],
  temp2mC: number[],        // °C (rounded to 1 decimal)
}
```

### `greeceGaleWarning`
```typescript
{
  source: "EMY",
  url: "https://poseidon.hcmr.gr/...",
  text: string | null,      // raw HTML-stripped warning text
}
```

---

## Preprocessed Output Schema (`weatherPreprocessed.local`)

After LLM preprocessing, `analysis.data.weatherPreprocessed.local` contains:

| Key | Content | Method |
|---|---|---|
| `wind` | Wind table: direction, speed, gusts, 06–20h, max 2 days, TZ Europe/Athens | Claude Haiku |
| `cloudRainThunderstorm` | Cloud cover, hourly rain deltas, ⛈️ if CAPE ≥ 1000 J/kg | Claude Haiku |
| `temperature` | Daily min/max (today/tomorrow/day after), TZ Europe/Athens | Deterministic |
| `waterTemp` | Mean of waterTempC array → `"Wassertemperatur: XX°C"` | Deterministic |
| `warnings` | EMY marine warning extracted for the specific sailing area | Claude Haiku |

---

## Regional Wind Model Selection

Wind model is selected via static JSON — no LLM call:

1. `data/sailingareas.json` — 133 sailing areas, each with `windyModel` (highest priority)
2. `data/countries.json` — country-level fallback
3. `server/location.ts` — coordinate-based fallback for unlisted countries

Models in use: `aromeHd` (1.3km), `czeAladin` (2.3km), `ukv` (2km), `iconEu` (7km), `gfs` (22km).

---

## Key Files

```
server/
  weather-europe.ts          European data (Meteonews, Wetterzentrale, KNMI)
  weather-national.ts        National dispatch (AT/HR/GR)
  weather-national-austria.ts  GeoSphere Austria integration
  weather-national-croatia.ts  DHMZ Croatia integration
  weather-national-greece.ts   EMY + OpenSkiron Greece integration
  weather-output.ts          AI output generation (5 sections)
  analysis-store.ts          JSON persistence for analyses
  location.ts                Location detection (sailing area + city)
  routes.ts                  Express API endpoints

data/
  sailingareas.json          133 sailing areas with windyModel + openskiron_domain
  countries.json             Country-level wind model fallback
  windymodels.json           Windy model definitions

scripts/
  openskiron_fetch.py        Python: GRIB1 fetch + extraction for Greece

tests/
  test-levkada.ts            End-to-end test: Lefkada (OpenSkiron + EMY + full pipeline)

client/src/pages/
  home.tsx                   Single-column chat UI with progressive section rendering
```

---

## Setup

### Requirements

- Node.js 20+ with `npm`
- Python 3.10+ with pip
- On Windows: ecCodes DLLs (see above)

### Installation

```bash
npm install
pip install -r requirements.txt
```

### Environment Variables (`.env`)

```
AI_INTEGRATIONS_ANTHROPIC_API_KEY=sk-ant-...
AI_INTEGRATIONS_ANTHROPIC_BASE_URL=https://api.anthropic.com   # optional
OPENAI_API_KEY=sk-...
```

### Development

```bash
npm run dev
```

### End-to-End Test (Greece / Lefkada)

```bash
npx tsx --env-file=.env tests/test-levkada.ts
```

Runs the full pipeline for Lefkada:
1. European data (Meteonews, Wetterzentrale, KNMI)
2. National data (EMY gale warning + OpenSkiron WRF 4km)
3. LLM preprocessing (national synopsis + local wind/cloud/temp/waterTemp/warnings)
4. Weather output generation (5 sections)

---

## Analysis Output Format

Each analysis is saved to `analyses/<timestamp> <location>.json`:

```json
{
  "id": "uuid",
  "createdAt": "2026-04-03T09:54:00Z",
  "position": { "userInput": "Lefkada", "countryCode": "GR", ... },
  "data": {
    "weatherRaw": {
      "greeceWindCloudRain": { "timestamps": [...], "windSpeedKt": [...], ... },
      "greeceTemperature": { "timestamps": [...], "temp2mC": [...] },
      "greeceGaleWarning": { "text": "..." }
    },
    "weatherPreprocessed": {
      "europe": { "generalWeather": {...}, "frontCurrent": {...}, ... },
      "national": { "synopsis": { "text_de": "..." } },
      "local": {
        "wind": { "text_de": "Fr 03.04: SO-Wind 5–10 kt bis Mittag..." },
        "cloudRainThunderstorm": { "text_de": "..." },
        "temperature": { "text_de": "Fr 03.04: max 17°C" },
        "waterTemp": { "text_de": "Wassertemperatur: 24°C" },
        "warnings": { "text_de": "Keine Marine-Warnung von EMY" }
      }
    },
    "weatherOutput": {
      "pressureAirmass": { "text": "..." },
      "weatherFront": { "text": "..." },
      "windWaves": { "text": "- 💨 Heute: SO 3–10 kn..." },
      "cloudRainThunderstorm": { "text": "..." },
      "temperature": { "text": "..." }
    },
    "sources": {
      "europe": ["[Europawetter](https://...) von Meteonews", ...],
      "national": ["[EMY Griechenland](https://...)", "[OpenSkiron WRF 4km](https://...)"]
    }
  }
}
```

---

## Cache

GRIB files are cached in `cache/openskiron/` (excluded from git). A URL sidecar file (`<domain>.url`) tracks which run was last downloaded — the GRIB is only re-downloaded when OpenSkiron publishes a new model run.

---

## Frontend

Single-column chat interface built with React + Tailwind + shadcn/ui. Progressive rendering via SSE:

| SSE event | UI update |
|---|---|
| `{ location }` | Header + Section 1 (Windy 850hPa map, no marker) |
| `{ weatherEurope }` | Sections 2–5 (KNMI fronts chart + 3 Windy iframes) |
| `{ weatherOutput }` | Bullet text fills in for all 5 sections |

The 5 output sections displayed:
1. **Druck & Luftmassen** — Windy ECMWF 850hPa map
2. **Fronten** — KNMI fronts chart + LLM analysis
3. **Wind & Welle** — Windy regional model map + wind/wave bullets
4. **Wolken & Regen** — Windy clouds overlay + precipitation bullets
5. **Temperatur** — Windy meteogram + temperature summary
