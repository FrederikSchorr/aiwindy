# AIWindy — AI-Powered Sailing Weather Advisor

**Live App: [aiwindy.schorr.wien](https://aiwindy.schorr.wien)**

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

## Message Classification

GPT-4.1-mini classifies each user message:

- **ANALYSE \<location\>** — Location-specific weather query → full 5-section analysis
- **CHAT** — General meteorology/sailing question or follow-up → direct GPT-4.1 answer (with full last analysis context: meta, sections, preprocessed data)
- **UNCLEAR** — Ambiguous query → asks user to specify location

---

## Location Detection & Windy Model Selection

Claude Sonnet detects `sailingArea` + `city` from user input, matched against `data/sailingareas.json` (133 sailing areas across 20 countries). Geocoding via Nominatim.

Windy wind model is selected via static JSON lookup — no LLM call:

1. `data/sailingareas.json` — each sailing area has `windyModel` (highest priority)
2. `data/countries.json` — country-level fallback
3. `server/location.ts` — coordinate-based fallback for unlisted countries

Models: `aromeHd` (1.3km), `czeAladin` (2.3km), `ukv` (2km), `iconEu` (7km), `gfs` (22km).

---

## European Weather Data

| Source | URL | Data | File |
|---|---|---|---|
| Meteonews | `meteonews.at/de/Allgemeine_Lage/K33/Europa` | Allgemeine Wetterlage Europa (HTML scrape) | `server/weather-europe.ts` |
| Wetterzentrale | `wetterzentrale.de/maps` | 850hPa ECMWF Temperatur-/Druckkarten (Bild-URLs) | `server/weather-europe.ts` |
| KNMI | `cdn.knmi.nl/.../weerkaarten` | Frontenanalyse + Frontenprognose (GIF charts) | `server/weather-europe.ts` |
| Windy | `embed.windy.com` | Interaktive Karten: 850hPa, Wind, Wolken, Meteogramm | Frontend iframes |

---

## National Weather Data

| Country | Source | URL | Data | File |
|---|---|---|---|---|
| 🇦🇹 Austria | GeoSphere Austria | `dataset.api.hub.geosphere.at` | Hourly wind, gusts, temperature, precipitation, cloud cover (JSON API) | `server/weather-national-austria.ts` |
| 🇦🇹 Austria | Austrocontrol | `austrocontrol.at/wetter/wetter_fuer_alle/wettervorhersage` | Flugwetter Wetterlage + FXOS Vorhersage (HTML scrape) | `server/weather-national-austria.ts` |
| 🇦🇹 Austria | LSZ Burgenland | `lsz-b.at/fuer-buergerinnen/sturmwarnung-webcams/` | Neusiedler See Sturmwarnungen (HTML scrape) | `server/weather-national-austria.ts` |
| 🇭🇷 Croatia | DHMZ | `prognoza.hr/jadran_h.xml` | Adria Segelwetter-Vorhersage (XML API) | `server/weather-national-croatia.ts` |
| 🇭🇷 Croatia | DHMZ | `prognoza.hr/pomorci.xml` | Maritime Warnungen, Wind, Seegang, Sicht (XML API) | `server/weather-national-croatia.ts` |
| 🇭🇷 Croatia | DHMZ | `prognoza.hr/sedam/hrvatska/7d_meteogrami.xml` | Städte-Meteogramme, Temperatur (XML API) | `server/weather-national-croatia.ts` |
| 🇬🇷 Greece | HNMS/EMY | `newportal.hnms.gr/emy/.../naftilia_deltio_thalasson_ektiposi` | Sturmwarnungen, Seewetter-Bulletin (HTML scrape) | `server/weather-national-greece.ts` |
| 🇬🇷 Greece | OpenSkiron | `openskiron.org/en/openwrf` | WRF 4km GRIB: Wind, Welle (Douglas), Wolken, Temperatur, CAPE | `server/weather-national-greece.ts` + `openskiron_fetch.py` |

Other countries (20 total in sailingareas.json): analysis uses Europe-wide data + Windy maps. LLM preprocessing pipeline available for future integrations.

---

## OpenSkiron WRF 4km (Greece)

Python subprocess (`scripts/openskiron_fetch.py`) handles GRIB1 fetch and extraction since GRIB parsing requires native ecCodes.

```
python scripts/openskiron_fetch.py <domain> <wind_lat> <wind_lon> <city_lat> <city_lon> [grib_url]
```

1. Node.js discovers current GRIB URL, checks DB cache (URL-based invalidation), passes URL as optional 7th arg
2. Downloads + bz2-decompresses if not cached in `cache/openskiron/`; `.url` sidecar detects staleness
3. Opens GRIB1 with `cfgrib` (non-standard WRF table → uses parameter IDs, not shortNames)
4. Extracts 49-step hourly time series at nearest grid point → JSON to stdout; results cached in DB per coordinate pair

4 domains cover all Greek sailing areas (`openskiron_domain` in sailingareas.json):
`Ionian_Islands_4km`, `Aegean_SW_4km`, `Aegean_NW_4km`, `Aegean_SE_4km`

---

## Weather Data Preprocessing

LLM preprocessing pipeline (`server/weather-national.ts`): scrape → validate (GPT-4.1-mini checks for actual weather content) → extract meteorological text → feed to section LLM calls. Used for national weather sources.

---

## Weather Output Generation

5 parallel LLM calls generate section texts (`server/weather-output.ts`), each receiving the full preprocessed weather context. Results streamed to frontend via SSE.

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
  cache-db.ts                  PostgreSQL cache helpers (TTL, location cache, OpenSkiron cache)

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
