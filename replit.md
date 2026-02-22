# Segelwetter - Windy Weather Maps

## Overview
A sailing weather advisor app with AI-powered meteorological analysis and live weather maps. Features a chat-style interface with a Gemini AI meteorologist on the left and three weather map panels on the right.

## Architecture
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui components
- **Backend**: Express.js API with geocoding, KNMI chart proxy, weather data fetching (Open-Meteo), and Gemini AI streaming chat
- **AI**: Google Gemini (via Replit AI Integrations) for meteorological analysis
- **No database required** - stateless app

## Key Files
- `client/src/pages/home.tsx` - Main split-panel UI: chat left, maps right
- `server/routes.ts` - All API endpoints (geocode, KNMI proxy, weather chat)
- `shared/schema.ts` - Zod schemas and TypeScript types

## How It Works
1. User types a location name in the chat
2. Backend geocodes via Nominatim, determines best regional weather model
3. Frontend displays three weather maps:
   - Temperature 850hPa (ECMWF) - European synoptic overview
   - KNMI fronts analysis chart (proxied from cdn.knmi.nl)
   - Local wind with regional high-res model (ICON-D2, ALADIN, AROME-HD, UKV, or ICON-EU)
4. Backend fetches weather data from Open-Meteo (including marine data) and streams a Gemini AI meteorological analysis focused on sailing conditions

## API
- `POST /api/geocode` - Body: `{ location }` - Returns: `{ lat, lon, displayName, regionalModel, regionalModelLabel, regionalModelZoom }`
- `GET /api/knmi-chart` - Proxies the latest KNMI weather analysis chart (image/gif)
- `POST /api/weather-chat` - Body: `{ lat, lon, displayName, message, history }` - Streams SSE weather analysis from Gemini

## Regional Model Selection
Based on coordinates:
- Germany/Central Europe: ICON-D2 (2.2km)
- Czech/Eastern Europe/Adriatic: ALADIN
- France: AROME-HD (1.25km)
- UK/Ireland: UKV
- Default Europe: ICON-EU (7km)
