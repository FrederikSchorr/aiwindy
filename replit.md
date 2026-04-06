# Segelwetter - AI Weather Advisor

## Overview
A sailing weather advisor app with AI-powered meteorological analysis. Features a single-column chat interface with inline weather maps. Smart message classification distinguishes between general meteorology questions, location-specific sailing weather analyses, and ambiguous queries.

## Architecture
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui components
- **Backend**: Express.js API with AI message classification, geocoding, KNMI chart proxy, regional weather scraping, and OpenAI streaming chat
- **AI**: Anthropic Claude Sonnet 4.6 for fronts analysis (Vision with KNMI chart), OpenAI GPT-4.1 for chat/photos, GPT-4.1-mini for section analysis/message classification, Gemini 2.5 Flash for video analysis
- **No database required** - stateless app

## Key Files
- `client/src/pages/home.tsx` - Single-column chat UI with AnalysisView progressive rendering from JSON pipeline
- `server/routes.ts` - All API endpoints (chat, geocode, KNMI proxy, upload)
- `shared/schema.ts` - Zod schemas, TypeScript types, WeatherEuropeSSE/WeatherOutputData interfaces
- `server/weather-europe.ts` - European weather data fetching (meteonews, Wetterzentrale, KNMI), time helpers (currentRunDate, nextForecastTarget)
- `server/weather-national.ts` - Router for national weather: dispatches to country-specific modules, preprocessing pipeline
- `server/weather-national-austria.ts` - AT: GeoSphere Austria JSON APIs (forecast + warnings + Neusiedler See)
- `server/weather-national-croatia.ts` - HR: DHMZ XML APIs (Adria forecast, regional warnings, city meteograms)
- `server/weather-national-greece.ts` - GR: HNMS/EMY gale warnings + OpenSkiron GRIB via Python (wind, wave, cloud, temperature)
- `server/weather-output.ts` - AI-generated weather output (5 sections via Claude/GPT)
- `server/analysis-store.ts` - Analysis JSON persistence
- `server/location.ts` - Location detection (sailingArea + city via Claude Sonnet)
- `data/sailingareas.json` - 133 sailing areas across 20 countries with coordinates, windyModel, country-specific metadata (e.g. emy_name for GR)
- `data/countries.json` - Country-level config: windyModel fallback, country names
- `data/windymodels.json` - Windy model definitions (key + label), referenced by sailingareas.json and countries.json
- `data/locations.json` - Persistent location cache (detectLocation + geocode results), avoids LLM + Nominatim calls for known inputs

## How It Works
1. User sends a message in the chat
2. Backend classifies message via GPT-4.1-mini into:
   - **CHAT**: General meteorology question or follow-up → direct GPT-4.1 answer (with weather context if location active, plus full last analysis context: meta, sections, preprocessed weather data)
   - **ANALYSE**: Location detected → 5-section weather analysis via JSON pipeline
   - **UNCLEAR**: Ambiguous message → asks user to specify a location
3. For ANALYSE mode:
   - Detects location via Claude Sonnet (sailingArea + city objects)
   - Geocodes via Nominatim, selects regional wind model from sailingareas.json (per revier) or countries.json (per country), resolves via windymodels.json
   - SSE sequence: `{ location }` → `{ weatherEurope }` → `{ weatherOutput, sources }` → `{ done }`
   - Frontend progressively renders sections as SSE events arrive

## Chat Layout
- Single column: full width on mobile, max-w-2xl centered on desktop
- User messages: right-aligned bubbles with primary color
- AI responses: left-aligned, no bubble/border (more space for content)
- No status messages during processing, only bounce cursor during streaming

## 5-Section Segelwetteranalyse (progressive rendering from JSON pipeline)
1. **Druck & Luftmassen** - Windy 850hPa ECMWF map (Greenwich center, no marker), ECMWF via Windy source
2. **Fronten** - KNMI fronts analysis chart (base64 from weatherEurope SSE), KNMI source with local time
3. **Wind & Welle** - Windy regional wind model map (sailingArea coords, marker), model label via Windy source
4. **Wolken & Regen** - Windy clouds overlay map (sailingArea coords, marker), model label via Windy source
5. **Temperatur** - Windy forecast meteogram (city coords, marker), always ECMWF 9km for consistent embed/link accuracy

Progressive rendering phases:
- Phase 1 (location SSE): Header + Section 1 (Windy ECMWF) shown immediately
- Phase 2 (weatherEurope SSE): Sections 2-5 (KNMI chart + Windy iframes) shown
- Phase 3 (weatherOutput SSE): Bullet text fills in for all 5 sections

Backend generates weatherOutput via weather-output.ts (5 separate LLM calls per section)

## Photo/Video Upload
- Camera button in chat input
- Accepts images (JPEG, PNG, WebP, HEIC) and videos (MP4, QuickTime, WebM), max 20MB
- Photos: server-side EXIF extraction (exif-parser) for GPS location and timestamp
- Videos: server-side thumbnail extraction via ffmpeg (1s frame), metadata via ffprobe (GPS/date from MP4 atoms: ISO6709, creation_time)
- If GPS found: auto-geocodes and updates maps
- OpenAI GPT-4.1 Vision analyzes meteorological relevance of photos
- Gemini 2.5 Flash for video analysis (native @google/generative-ai SDK)
- Analysis sections: 📷 Aufnahme, ☁️ Wolkentyp, 🌧️ Regen, 🌊 Wellen, 🌫️ Bedeckungsgrad, 🌤️ Typische Wetterentwicklung
- Last photo/video analysis stored in `lastPhotoAnalysis` for follow-up chat questions
- SSE streaming response: `{ videoMeta: { thumbnailBase64, time, locationName, countryCode } }` for videos, `{ exifMeta }` for photos
- Video: shows still frame thumbnail with "▶ Video" overlay, recording location + date below, "ja" location hint button (same as photo)

## API
- `POST /api/chat` - Body: `{ message, history, currentLocation }` - Streams SSE: `{ location }`, `{ weatherEurope }`, `{ weatherOutput }`, `{ content }`, `{ done: true }`
- `POST /api/upload` - Multipart form: `photo` (file) + optional `currentLocation` (JSON string) - Streams SSE
- `POST /api/geocode` - Body: `{ location }` - Returns geocoded result with regional model
- `GET /api/knmi-chart` - Proxies the latest KNMI weather analysis chart (image/gif)

## Message Classification (AI-based)
GPT-4.1-mini classifies each user message:
- **ANALYSE <location>**: Location-specific weather query → full 6-section analysis
- **CHAT**: General meteorology/sailing question or follow-up → direct conversational answer (with weather context if location active). Includes full last analysis context: meta info (location, model, coordinates), 5 section texts, and preprocessed weather data (up to 6000 chars) for follow-up questions.
- **UNCLEAR**: Ambiguous query → asks user to specify location

## Weather Data Sources

### Europe-wide
- `fetchMeteonews()`: Scrapes meteonews.at European overview (general weather situation)
- Wetterzentrale: 850hPa temperature charts (current + forecast) with local timestamps
- KNMI: Fronts analysis charts (current + forecast) with local timestamps

### Country-specific (fully integrated APIs)
- **AT** (GeoSphere Austria): JSON APIs — forecast, warnings, Neusiedler See wind warnings. No HTML scraping needed.
- **HR** (DHMZ): XML APIs — Adria sailing forecast, regional maritime warnings, city meteograms (temperature)
- **GR** (HNMS/EMY + OpenSkiron): Gale warnings via EMY (area-specific via emy_name from sailingareas.json). OpenSkiron GRIB data via Python subprocess — wind, wave (Douglas scale), cloud cover, temperature, CAPE. Cached in `cache/openskiron/`.

### Other countries (20 total in sailingareas.json)
- No local weather data integrated yet. Analysis uses Europe-wide data + Windy maps only.
- LLM preprocessing pipeline available: scrape → validate (gpt-4.1-mini checks for actual weather content) → extract meteorological text → feed to section LLM calls.

## Regional Model Selection (JSON-based, no LLM)
Windy wind model is selected via static JSON lookup — no LLM call needed:
- **sailingareas.json**: Each of 133 sailing areas has `windyModel` key (highest priority)
- **windymodels.json**: Windy model definitions (model key + label) — referenced by countries.json and sailingareas.json
- **countries.json**: Country-level `windyModel` key for all 20 countries (fallback when no sailing area detected)
- **getRegionalModelFallback()**: Coordinate-based fallback for unknown countries (aromeHd/czeAladin/ukv/iconEu/gfs)
Models: aromeHd (1.3km), czeAladin (2.3km), ukv (2km), iconEu (7km), gfs (22km)

## Custom Domain
- Domain: aiwindy.schorr.wien
- Redirect from *.replit.app/*.replit.dev to custom domain in production
