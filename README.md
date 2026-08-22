# AIWindy — AI-Powered Sailing Weather Advisor

**Live App: [aiwindy.schorr.wien](https://aiwindy.schorr.wien)**

An AI-powered sailing weather analysis app for European waters. Each analysis presents 5 interactive [Windy](https://www.windy.com) maps paired with AI-generated explanations — zooming in from the continental scale down to the local sailing area:

1. **Druck & Luftmassen** — Europe-wide 850hPa pressure and air mass map (ECMWF)
2. **Fronten** — KNMI weather fronts analysis chart with AI interpretation
3. **Wind & Welle** — Regional high-resolution wind model map (1–7 km) with forecast bullets
4. **Wolken & Regen** — Cloud and precipitation overlay with thunderstorm risk
5. **Temperatur** — Local meteogram with temperature summary

The app combines data from European synoptic services (Meteonews, Wetterzentrale, KNMI), national weather APIs (GeoSphere Austria, DHMZ Croatia, HNMS/Open-Meteo Greece), and multiple AI models to generate concise, sailor-relevant analysis. Users can also upload photos or videos for meteorological AI analysis.

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
         │   └── GR: HNMS gale warnings + Open-Meteo Forecast & Marine APIs
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

Claude Sonnet detects `sailingArea` + `city` from user input, matched against `data/sailingareas.json` (133 sailing areas across 20 countries). The full sailing area list is sent as system prompt with Anthropic prompt caching (`cache_control: ephemeral`) to reduce cost and latency. Geocoding via Nominatim.

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
| 🇬🇷 Greece | Open-Meteo Forecast API | `api.open-meteo.com/v1/forecast` | Wind, Böen, Wolken, Regen, Wettercode, CAPE, Temperatur (JSON) | `server/weather-national-greece.ts` |
| 🇬🇷 Greece | Open-Meteo Marine API | `marine-api.open-meteo.com/v1/marine` | Wellenhöhe, Richtung, Periode, Windsee und Dünung (JSON) | `server/weather-national-greece.ts` |

Other countries (20 total in sailingareas.json): analysis uses Europe-wide data + Windy maps. LLM preprocessing pipeline available for future integrations.

---

## Open-Meteo (Greece)

The Greece integration keeps HNMS for national maritime bulletins and fetches hourly forecast data directly from Open-Meteo:

1. **Forecast API** at the sailing area provides wind in knots, gusts, cloud cover, rain, weather codes and CAPE.
2. **Marine API** at the sailing area provides combined waves, wind sea and swell in meters, degrees and seconds.
3. **Forecast API** at the city provides the local 2 m temperature.

The saved raw-data keys are `greeceOpenMeteoForecast` and `greeceOpenMeteoMarine`; preprocessing continues to provide the stable local keys for warnings, wind, wave, clouds/rain, temperature and water temperature.

---

## Weather Data Preprocessing

Two-stage LLM preprocessing (`server/weather-national.ts`):

1. **National synopsis** (`preprocessNationalWeather`) — extracts/translates the country-level weather overview (e.g. DHMZ Adria synopsis, EMY marine bulletin, Austrocontrol Wetterlage)
2. **Local weather** (`preprocessLocalWeather`) — extracts area-specific data: warnings, wind, wave, cloud/rain/thunderstorm, temperature. Each country module has dedicated functions (e.g. `extractDhmzWarning`, `preprocessGreeceLocalWind`)

LLM calls (Claude Sonnet / GPT-4.1-mini) extract and translate from raw XML/HTML into structured German text. Numeric data (GeoSphere and Open-Meteo JSON) is preprocessed without LLM.

---

## Weather Output Generation

Single Claude Sonnet 4.6 call (`server/weather-output.ts`) with all preprocessed data + weather chart images (Wetterzentrale 850hPa, KNMI fronts). Returns a JSON object with 5 section texts (bullet-point style). Each section has strict rules for content scope, bullet count, and word limits.

---

## Caching

| Layer | Key Pattern | Storage | Invalidation | File |
|---|---|---|---|---|
| Location lookups | `loc:{normalized input}` | PostgreSQL `cache_store` | No TTL (permanent) | `server/cache-db.ts` |
| Analysis results | `analyses` table (JSONB) | PostgreSQL | Append-only (1 row per analysis) | `server/analysis-store.ts` |

---

## Photo & Video Upload

Camera button in chat input. Accepts images (JPEG, PNG, WebP, HEIC) and videos (MP4, QuickTime, WebM), max 20MB.

| Feature | Photos | Videos |
|---|---|---|
| Metadata | EXIF extraction (exif-parser) → GPS + timestamp | ffprobe → GPS (ISO6709) + creation_time from MP4 atoms |
| AI Analysis | GPT-4.1 Vision | Gemini 2.5 Flash |
| Thumbnail | Original image | ffmpeg: 1s frame extraction, "▶ Video" overlay |
| SSE event | `{ exifMeta }` | `{ videoMeta: { thumbnailBase64, time, locationName, countryCode } }` |

Analysis sections: 📷 Aufnahme, ☁️ Wolkentyp, 🌧️ Regen, 🌊 Wellen, 🌫️ Bedeckungsgrad, 🌤️ Wetterentwicklung. Videos additionally: 💨 Windgeschwindigkeit.

If GPS found: reverse geocodes via Nominatim, shows location + date, offers "ja" button to trigger weather analysis for that location.

---

## Key Files

```
server/
  routes.ts                    Express API endpoints (chat, upload, geocode, KNMI proxy)
  weather-europe.ts            European data (Meteonews, Wetterzentrale, KNMI) + time helpers
  weather-national.ts          National dispatch (AT/HR/GR) + preprocessing pipeline
  weather-national-austria.ts  GeoSphere Austria + Austrocontrol + LSZ Burgenland
  weather-national-croatia.ts  DHMZ Croatia integration
  weather-national-greece.ts   HNMS + Open-Meteo Greece integration
  weather-output.ts            AI output generation (single Claude Sonnet call → 5 sections)
  analysis-store.ts            Analysis JSON persistence (filesystem + PostgreSQL)
  location.ts                  Location detection (sailing area + city via Claude Sonnet)
  cache-db.ts                  PostgreSQL cache helpers (TTL, location cache)

data/
  sailingareas.json            133 sailing areas with windyModel, coordinates and emy_name
  countries.json               Country-level wind model fallback
  windymodels.json             Windy model definitions (key + label)
  windsystems.json             Local wind systems per country (Bora, Meltemi, etc.)

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

Chat mode (CHAT classification) uses GPT-4.1 with full last analysis context (meta, sections, preprocessed data) for follow-up questions.

---

## Setup

### Requirements

- Node.js 20+ with `npm`

### Installation

```bash
npm install
```

### Environment Variables

```
DATABASE_URL=postgresql://...
SESSION_SECRET=...
AI_INTEGRATIONS_ANTHROPIC_API_KEY=sk-ant-...
AI_INTEGRATIONS_OPENAI_API_KEY=sk-...
AI_INTEGRATIONS_GEMINI_API_KEY=...
```

### Development

```bash
npm run dev
```

### Custom Domain

- Domain: aiwindy.schorr.wien
- Redirect from *.replit.app/*.replit.dev to custom domain in production
