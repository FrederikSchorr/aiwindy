# Segelwetter - Windy Weather Maps

## Overview
A sailing weather advisor app with AI-powered meteorological analysis and live weather maps. Features a chat-style interface with an OpenAI-powered meteorologist on the left and four weather map panels on the right.

## Architecture
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui components
- **Backend**: Express.js API with AI location extraction, geocoding, KNMI chart proxy, weather data fetching (Open-Meteo), and OpenAI streaming chat
- **AI**: OpenAI GPT-4.1 (via Replit AI Integrations) for meteorological analysis, GPT-4.1-mini for location extraction and regional model selection
- **No database required** - stateless app

## Key Files
- `client/src/pages/home.tsx` - Main split-panel UI: chat left, maps right
- `server/routes.ts` - All API endpoints (chat, geocode, KNMI proxy, forecast)
- `shared/schema.ts` - Zod schemas and TypeScript types

## How It Works
1. User sends any message in the chat (e.g. "Wie ist das Wetter in Punat?" or just "Rovinj")
2. Backend uses GPT-4.1-mini to extract location from message (if any)
3. If location found: geocodes via Nominatim, selects best regional model via AI, updates maps, streams full 4-chapter weather analysis
4. If no location found but previous location active: answers follow-up question concisely using existing weather context
5. Frontend displays four weather panels:
   - Temperature 850hPa (ECMWF) - European synoptic overview (3:2 ratio)
   - KNMI fronts analysis chart (proxied from cdn.knmi.nl)
   - Local wind with AI-selected regional model (3:2 ratio)
   - Windy native forecast embed
6. Country-specific weather warning links for 19+ European countries

## Photo/Video Upload
- Camera button in chat input (both desktop and mobile)
- Accepts images (JPEG, PNG, WebP, HEIC) and videos (MP4, QuickTime, WebM), max 20MB
- Server-side EXIF extraction (exif-parser) for GPS location and timestamp
- If GPS found: auto-geocodes and updates maps
- OpenAI GPT-4.1 Vision analyzes meteorological relevance: cloud types, weather patterns, precursors
- SSE streaming response compatible with existing chat flow

## API
- `POST /api/chat` - Body: `{ message, history, currentLocation }` - Streams SSE: `{ location }`, `{ status }`, `{ content }`, `{ done: true }`
- `POST /api/upload` - Multipart form: `photo` (file) + optional `currentLocation` (JSON string) - Streams SSE same format as /api/chat
- `POST /api/geocode` - Body: `{ location }` - Returns: `{ lat, lon, displayName, regionalModel, regionalModelLabel, regionalModelZoom, countryCode, warningUrl, warningLabel }`
- `GET /api/knmi-chart` - Proxies the latest KNMI weather analysis chart (image/gif)
- `POST /api/forecast` - Body: `{ lat, lon }` - Returns hourly forecast data

## Regional Model Selection (AI-based)
GPT-4.1-mini selects the best Windy.com wind model:
- Lakes/inland waters: Meteoblue (mblue)
- Adriatic coast: ALADIN (czeAladin)
- France: AROME-HD (aromeHd, 1.25km)
- Germany/Austria/Switzerland: ICON-D2 (iconD2, 2.2km)
- UK/Ireland: UKV
- Default Europe: ICON-EU (iconEu, 7km)

## Weather Analysis Structure (4 chapters, German)
1. Großwetterlage - Synoptic situation with 850hPa map references
2. Fronten - Front analysis with KNMI chart references
3. Lokale Windsysteme - Regional wind phenomena (Bora, Mistral, Meltemi, etc.)
4. Wetterwarnungen - Active warnings with country-specific links
