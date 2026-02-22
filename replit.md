# Windy Weather Maps

## Overview
A chat-style web app that lets users enter a location and displays Windy.com weather maps (temperature and wind) for that location.

## Architecture
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui components
- **Backend**: Express.js API with geocoding via OpenStreetMap Nominatim
- **No database required** - stateless app

## Key Files
- `client/src/pages/home.tsx` - Main chat interface with Windy embed iframes
- `server/routes.ts` - POST /api/geocode endpoint
- `shared/schema.ts` - Zod schemas and TypeScript types

## How It Works
1. User types a location name in the chat input
2. Backend geocodes the location via Nominatim API
3. Frontend displays two Windy.com embedded maps (temperature + wind) using the coordinates

## API
- `POST /api/geocode` - Body: `{ location: string }` - Returns: `{ lat, lon, displayName }`
