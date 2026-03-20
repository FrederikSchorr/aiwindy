# Segelwetter - AI Weather Advisor

## Overview
A sailing weather advisor app with AI-powered meteorological analysis. Features a single-column chat interface with inline weather maps. Smart message classification distinguishes between general meteorology questions, location-specific sailing weather analyses, and ambiguous queries.

## Architecture
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui components
- **Backend**: Express.js API with AI message classification, geocoding, KNMI chart proxy, weather data fetching (Open-Meteo), regional weather scraping, and OpenAI streaming chat
- **AI**: OpenAI GPT-4.1 for meteorological analysis/chat/photos, GPT-4.1-mini for message classification and regional model selection, Gemini 2.5 Flash for video analysis
- **No database required** - stateless app

## Key Files
- `client/src/pages/home.tsx` - Single-column chat UI with SectionCard event-driven inline maps
- `server/routes.ts` - All API endpoints (chat, geocode, KNMI proxy, forecast, upload)
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
   - Scrapes regional weather service (DHMZ, DWD, GeoSphere, etc.) for local forecast
   - Scrapes regional warnings from national weather service
   - Fetches Open-Meteo data (current + hourly + marine)
   - Emits per-section SSE events `{ section: { id, title, mapType, mapConfig, sourceLabel, sourceUrl } }` when each section starts in the AI stream
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
6. **Wetterwarnung** - Scraped warning text from regional service, warning service link

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
- `POST /api/forecast` - Body: `{ lat, lon }` - Returns hourly forecast data

## Message Classification (AI-based)
GPT-4.1-mini classifies each user message:
- **ANALYSE <location>**: Location-specific weather query → full 6-section analysis
- **CHAT**: General meteorology/sailing question or follow-up → direct conversational answer (with weather context if location active)
- **UNCLEAR**: Ambiguous query → asks user to specify location

## Regional Weather Scraping
- `fetchMeteonews()`: Scrapes meteonews.at/de/Allgemeine_Lage/K33/Europa for European overview
- `fetchRegionalWeatherReport(countryCode, lat, lon)`: Scrapes national weather service for local forecast
- `fetchRegionalWarnings(countryCode)`: Scrapes national weather service warnings page
- Supported countries: HR (DHMZ), DE (DWD), AT (GeoSphere), IT (MeteoAM), FR (Météo-France), GR (EMY), SI (ARSO), ME (ZHMS), GB (Met Office), NL (KNMI), ES (AEMET), PT (IPMA), TR (MGM), DK (DMI), SE (SMHI), NO (Yr.no), PL (IMGW), CH (MeteoSchweiz)
- HTML stripped via regex, fallback to Open-Meteo data if scraping fails
- LLM-based content validation: after scraping, gpt-4.1-mini checks if text contains actual weather data (not just navigation HTML from SPAs). Invalid content is marked unavailable.

## Regional Model Selection (AI-based)
GPT-4.1-mini selects the best Windy.com wind model:
- Lakes/inland waters: Meteoblue (mblue)
- Adriatic coast: ALADIN (czeAladin)
- France: AROME-HD (aromeHd, 1.25km)
- Germany/Switzerland: ICON-D2 (iconD2, 2.2km)
- UK/Ireland: UKV
- Default Europe: ICON-EU (iconEu, 7km)

## Custom Domain
- Domain: aiwindy.schorr.wien
- Redirect from *.replit.app/*.replit.dev to custom domain in production
