# Segelwetter - AI Weather Advisor

## Overview
A sailing weather advisor app with AI-powered meteorological analysis. Features a single-column chat interface with inline weather maps. Smart message classification distinguishes between general meteorology questions, location-specific sailing weather analyses, and ambiguous queries.

## Architecture
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui components
- **Backend**: Express.js API with AI message classification, geocoding, KNMI chart proxy, regional weather scraping, and OpenAI streaming chat
- **AI**: Anthropic Claude Sonnet 4.6 for fronts analysis (Vision with KNMI chart), OpenAI GPT-4.1 for chat/photos, GPT-4.1-mini for section analysis/message classification/regional model selection, Gemini 2.5 Flash for video analysis
- **No database required** - stateless app

## Key Files
- `client/src/pages/home.tsx` - Single-column chat UI with SectionCard event-driven inline maps
- `server/routes.ts` - All API endpoints (chat, geocode, KNMI proxy, upload)
- `shared/schema.ts` - Zod schemas and TypeScript types

## How It Works
1. User sends a message in the chat
2. Backend classifies message via GPT-4.1-mini into:
   - **CHAT**: General meteorology question or follow-up → direct GPT-4.1 answer (with weather context if location active)
   - **ANALYSE**: Location detected → 6-section Segelwetteranalyse with per-section SSE events + inline maps
   - **UNCLEAR**: Ambiguous message → asks user to specify a location
3. For ANALYSE mode:
   - Geocodes via Nominatim, selects regional model via AI
   - Scrapes meteonews.at for European weather overview
   - Scrapes ONE regional weather page per country (forecast page, which typically includes warnings)
   - For AT: uses GeoSphere JSON APIs for both forecast and warnings (clean data, no preprocessing needed)
   - LLM-preprocesses scraped text to extract only meteorological content (removes navigation HTML, menus, boilerplate)
   - Fetches KNMI fronts chart as base64 for Vision analysis
   - Emits per-section SSE events `{ section: { id, title, mapType, mapConfig, sourceLabel, sourceUrl } }` when each section starts in the AI stream
   - Runs 5 separate LLM calls (one per section, section 5 has no LLM call) with focused prompts and only relevant context
   - Streams 6-section analysis text with inline maps driven by section events

## Chat Layout
- Single column: full width on mobile, max-w-2xl centered on desktop
- User messages: right-aligned bubbles with primary color
- AI responses: left-aligned, no bubble/border (more space for content)
- No status messages during processing, only bounce cursor during streaming

## 6-Section Segelwetteranalyse (per-section SSE events + inline maps)
1. **Luftmassen** - Windy 850hPa ECMWF map (Greenwich center), meteonews.at source
2. **Fronten** - KNMI fronts analysis chart (proxied image), KNMI source with UTC time
3. **Wind & Welle** - Windy regional wind model map, regional weather service link
4. **Wolken & Regen** - Windy clouds overlay map
5. **Prognose** - Windy meteogram (forecast type embed)
6. **Wetterwarnung** - Warning text from preprocessed regional report, warning service link

Each section runs as a separate LLM call with focused context:
- Section 1 (Claude Sonnet 4.6 Vision): KNMI fronts chart image + meteonews text, no location — European overview
- Section 2 (Claude Sonnet 4.6 Vision): KNMI fronts chart image + location (no meteonews text)
- Section 3 (gpt-4.1-mini): preprocessed regional weather report + model info + location
- Section 4 (gpt-4.1-mini): preprocessed regional weather report + location
- Section 5: No LLM call (chart only)
- Section 6 (gpt-4.1-mini): preprocessed regional weather report (incl. warnings) + location

## Photo/Video Upload
- Camera button in chat input
- Accepts images (JPEG, PNG, WebP, HEIC) and videos (MP4, QuickTime, WebM), max 20MB
- Photos: server-side EXIF extraction (exif-parser) for GPS location and timestamp
- Videos: server-side thumbnail extraction via ffmpeg (1s frame), metadata via ffprobe (GPS/date from MP4 atoms: ISO6709, creation_time)
- If GPS found: auto-geocodes and updates maps
- OpenAI GPT-4.1 Vision analyzes meteorological relevance of photos
- Gemini 2.5 Flash for video analysis (native @google/generative-ai SDK)
- SSE streaming response: `{ videoMeta: { thumbnailBase64, time, locationName, countryCode } }` for videos, `{ exifMeta }` for photos
- Video: shows still frame thumbnail with "▶ Video" overlay, recording location + date below, "ja" location hint button (same as photo)

## API
- `POST /api/chat` - Body: `{ message, history, currentLocation }` - Streams SSE: `{ location }`, `{ section }` (per-section), `{ content }`, `{ done: true }`
- `POST /api/upload` - Multipart form: `photo` (file) + optional `currentLocation` (JSON string) - Streams SSE
- `POST /api/geocode` - Body: `{ location }` - Returns geocoded result with regional model
- `GET /api/knmi-chart` - Proxies the latest KNMI weather analysis chart (image/gif)

## Message Classification (AI-based)
GPT-4.1-mini classifies each user message:
- **ANALYSE <location>**: Location-specific weather query → full 6-section analysis
- **CHAT**: General meteorology/sailing question or follow-up → direct conversational answer (with weather context if location active)
- **UNCLEAR**: Ambiguous query → asks user to specify location

## Regional Weather Scraping
- `fetchMeteonews()`: Scrapes meteonews.at/de/Allgemeine_Lage/K33/Europa for European overview
- `fetchRegionalWeatherReport(countryCode, lat, lon)`: Scrapes national weather service for local forecast
- Supported countries: HR (DHMZ), DE (DWD), AT (GeoSphere), IT (MeteoAM), FR (Météo-France), GR (EMY), SI (ARSO), ME (ZHMS), GB (Met Office), NL (KNMI), ES (AEMET), PT (IPMA), TR (MGM), DK (DMI), SE (SMHI), NO (Yr.no), PL (IMGW), CH (MeteoSchweiz)
- HTML stripped via regex, fallback message if scraping fails
- Only ONE scrape per region — forecast page is used for both forecast data AND warnings (sections 3-6)
- Austria (AT): Uses GeoSphere JSON APIs instead of scraping — `geosphere.at/data/textforecasts` for regional text forecasts (matched to nearest Bundesland by coordinates), `warnungen.zamg.at/wsapp/api/getWarningsForCoords` for coordinate-based warnings
- LLM-based content validation: after scraping, gpt-4.1-mini checks if text contains actual weather data (not just navigation HTML from SPAs). Invalid content is marked unavailable.
- LLM preprocessing: after validation, gpt-4.1-mini extracts only meteorological content from raw scraped text (removes navigation, menus, boilerplate). Clean text is used by all downstream section LLM calls.

## Regional Model Selection (AI-based)
GPT-4.1-mini selects the best Windy.com wind model based on 300km domain-edge rule:
- aromeHd (1.3km): France, Belgium, Luxembourg, W-Germany, Switzerland, N-Spain, Corsica
- czeAladin (2.3km): Austria, Czechia, Slovakia, Hungary, Croatia, Slovenia, Serbia, Bosnia, C-Poland, W-Romania, Bavaria, Saxony, NE-Italy
- ukv (2km): England (mid+north), Wales, S-Scotland, E-Ireland
- iconEu (7km): Europe fallback (Scandinavia, Baltics, Greece, Iberia, Netherlands, Berlin, N-Italy-West, etc.)
- gfs (22km): Outside Europe

## Custom Domain
- Domain: aiwindy.schorr.wien
- Redirect from *.replit.app/*.replit.dev to custom domain in production
