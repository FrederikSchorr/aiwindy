# AIWindy — AI-Powered Sailing Weather Advisor

An AI-powered sailing weather analysis app for European waters. Each analysis presents 5 interactive [Windy](https://www.windy.com) maps paired with AI-generated explanations — zooming in from the continental scale down to the local sailing area:

1. **Druck & Luftmassen** — Europe-wide 850hPa pressure and air mass map (ECMWF)
2. **Fronten** — KNMI weather fronts analysis chart with AI interpretation
3. **Wind & Welle** — Regional high-resolution wind model map (1–7 km) with forecast bullets
4. **Wolken & Regen** — Cloud and precipitation overlay with thunderstorm risk
5. **Temperatur** — Local meteogram with temperature summary

The app combines data from European synoptic services (Meteonews, Wetterzentrale, KNMI), national weather APIs (GeoSphere Austria, DHMZ Croatia, EMY/OpenSkiron Greece), and multiple AI models to generate concise, sailor-relevant analysis. Users can also upload photos or videos for meteorological AI analysis.

---

## Architecture Overview

```
Client (React + Vite)
  └── POST /api/chat (SSE)
        ├── Message classification (GPT-4.1-mini)
        ├── Location detection (Claude Sonnet)
        ├── European weather data
        │   ├── Meteonews (general overview text)
        │   ├── Wetterzentrale (850 hPa charts with local timestamps)
        │   └── KNMI (front analysis charts with local timestamps)
        ├── National weather data (per country)
        │   ├── AT: GeoSphere Austria JSON APIs
        │   ├── HR: DHMZ XML feeds
        │   └── GR: EMY gale warnings + OpenSkiron WRF 4km GRIB
        ├── LLM preprocessing (Claude Haiku/Sonnet)
        └── Weather output generation (5 sections, Claude/GPT)
  └── POST /api/upload (SSE)
        ├── Photo: EXIF GPS/timestamp → GPT-4.1 Vision analysis
        └── Video: ffprobe metadata + ffmpeg thumbnail → Gemini 2.5 Flash analysis
```

The backend pipeline is **JSON-based**: raw data → preprocessed structured text → AI-generated output sections. Each stage writes to a persistent analysis JSON file (`analyses/`).

---

## Data Sources

### European (all locations)

| Source | Data | File |
|---|---|---|
| [Meteonews](https://www.meteonews.at/de/Allgemeine_Lage/K33/Europa) | General European weather overview (German text) | `server/weather-europe.ts` |
| [Wetterzentrale](https://www.wetterzentrale.de) | 850 hPa temperature / air mass charts (current + forecast images with local timestamps) | `server/weather-europe.ts` |
| [KNMI](https://www.knmi.nl) | Weather fronts analysis + forecast charts (images with local timestamps) | `server/weather-europe.ts` |

### National (per country)

| Country | Source | Data | File |
|---|---|---|---|
| 🇦🇹 Austria | GeoSphere Austria JSON APIs | Hourly wind, temperature, precipitation, cloud cover for sailing area + city. Neusiedler See wind warnings. | `server/weather-national-austria.ts` |
| 🇭🇷 Croatia | DHMZ XML feeds | Adriatic sailing forecast text, regional maritime warnings, city meteogram temperatures | `server/weather-national-croatia.ts` |
| 🇬🇷 Greece | EMY gale warnings + OpenSkiron WRF 4km GRIB | Area-specific gale warnings (via emy_name from sailingareas.json). Wind, wave (Douglas scale), cloud cover, temperature, CAPE via Python subprocess. Cached in `cache/openskiron/`. | `server/weather-national-greece.ts` |

Other countries (20 total in sailingareas.json): analysis uses Europe-wide data + Windy maps. LLM preprocessing pipeline available for future integrations.

---

## Photo & Video Upload

Camera button in chat input. Accepts images (JPEG, PNG, WebP, HEIC) and videos (MP4, QuickTime, WebM), max 20MB.

| Feature | Photos | Videos |
|---|---|---|
| Metadata | EXIF extraction (exif-parser) → GPS + timestamp | ffprobe → GPS (ISO6709) + creation_time from MP4 atoms |
| AI Analysis | GPT-4.1 Vision — meteorological relevance | Gemini 2.5 Flash (native @google/generative-ai SDK) |
| Thumbnail | Original image | ffmpeg: 1s frame extraction, "▶ Video" overlay |
| SSE event | `{ exifMeta }` | `{ videoMeta: { thumbnailBase64, time, locationName, countryCode } }` |

If GPS found: reverse geocodes via Nominatim, shows location + date, offers "ja" button to trigger weather analysis for that location.

---

## OpenSkiron WRF 4km (Greece)

Python subprocess (`scripts/openskiron_fetch.py`) handles GRIB1 fetch and extraction since GRIB parsing requires native ecCodes.

```
python scripts/openskiron_fetch.py <domain> <wind_lat> <wind_lon> <city_lat> <city_lon>
```

1. Scrapes `openskiron.org/en/openwrf` to discover current timestamped URL
2. Downloads + bz2-decompresses if not cached in `cache/openskiron/`; `.url` sidecar detects staleness
3. Opens GRIB1 with `cfgrib` (non-standard WRF table → uses parameter IDs, not shortNames)
4. Extracts 49-step hourly time series at nearest grid point → JSON to stdout

4 domains cover all Greek sailing areas (`openskiron_domain` in sailingareas.json):
`Ionian_Islands_4km`, `Aegean_SW_4km`, `Aegean_NW_4km`, `Aegean_SE_4km`

---

## Regional Wind Model Selection

Static JSON lookup — no LLM call:

1. `data/sailingareas.json` — 133 sailing areas across 20 countries, each with `windyModel` (highest priority)
2. `data/countries.json` — country-level fallback
3. `server/location.ts` — coordinate-based fallback for unlisted countries

Models: `aromeHd` (1.3km), `czeAladin` (2.3km), `ukv` (2km), `iconEu` (7km), `gfs` (22km).

---

## Key Files

```
server/
  routes.ts                    Express API endpoints
  weather-europe.ts            European data (Meteonews, Wetterzentrale, KNMI) + time helpers
  weather-national.ts          National dispatch (AT/HR/GR) + preprocessing pipeline
  weather-national-austria.ts  GeoSphere Austria integration
  weather-national-croatia.ts  DHMZ Croatia integration
  weather-national-greece.ts   EMY + OpenSkiron Greece integration
  weather-output.ts            AI output generation (5 sections)
  analysis-store.ts            JSON persistence for analyses
  location.ts                  Location detection (sailing area + city via Claude Sonnet)

data/
  sailingareas.json            133 sailing areas with windyModel, coordinates, openskiron_domain, emy_name
  countries.json               Country-level wind model fallback
  windymodels.json             Windy model definitions (key + label)

scripts/
  openskiron_fetch.py          Python: GRIB1 fetch + extraction for Greece

client/src/pages/
  home.tsx                     Single-column chat UI with progressive section rendering
```

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

Chat mode includes full last analysis context (meta, sections, preprocessed data) for follow-up questions.

---

## Setup

### Requirements

- Node.js 20+ with `npm`
- Python 3.10+ with pip (for OpenSkiron/Greece only)

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

### Custom Domain

- Domain: aiwindy.schorr.wien
- Redirect from *.replit.app/*.replit.dev to custom domain in production
