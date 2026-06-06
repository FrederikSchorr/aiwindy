# Threat Model

## Project Overview

Segelwetter is a public sailing-weather advisor deployed on Replit as a single Express application with a React/Vite frontend. The production backend exposes public endpoints for geocoding, AI chat, weather analysis generation, analysis export, and photo/video upload. It integrates with external weather sources, OpenAI, Anthropic, Gemini, local ffmpeg/ffprobe processing, PostgreSQL-backed caching, and filesystem analysis exports.

This scan assumes Replit-managed TLS in production, `NODE_ENV=production`, and a public deployment at `https://aiwindy.schorr.wien`. Mockup/dev-only tooling is out of scope unless explicitly mounted in production.

## Assets

- **User-submitted content and metadata** — chat prompts, uploaded photos/videos, derived EXIF GPS coordinates, timestamps, and inferred locations. Exposure can reveal travel plans, whereabouts, or private user context.
- **Generated analyses and conversation context** — weather analyses, AI-generated summaries, preprocessed raw weather data, and follow-up context. These outputs may reveal what another user asked about or uploaded.
- **Application secrets and paid API access** — OpenAI, Anthropic, Gemini, and database credentials. Abuse of public endpoints can indirectly consume these resources even without direct key disclosure.
- **Service availability and quota** — public AI analysis and upload routes trigger expensive LLM calls, external fetches, and local media processing. Abuse can cause bill shock, quota exhaustion, or outages.
- **Persistent stores** — PostgreSQL `cache_store`, PostgreSQL `analyses`, and the `analyses/` filesystem directory. These persist derived user activity and weather outputs beyond a single request.

## Trust Boundaries

- **Browser to Express API** — all `/api/*` requests come from untrusted clients. The server must validate input, isolate per-user state, and limit abuse.
- **Express API to AI providers** — user-controlled prompts and media are forwarded to OpenAI/Anthropic/Gemini using server-held credentials.
- **Express API to external weather/geocoding services** — server-side fetches to Nominatim, KNMI, Meteonews, Wetterzentrale, DHMZ, GeoSphere, EMY, and others consume untrusted remote content.
- **Express API to local process/filesystem tools** — uploads cross into ffmpeg/ffprobe processing and temporary-file storage under `/tmp/uploads`.
- **Express API to PostgreSQL/filesystem persistence** — analyses and caches are persisted server-side and must not become globally readable across users.
- **Production vs dev-only boundary** — `server/vite.ts`, `tests/`, and build/tooling config are dev-only under the current architecture. Unmounted `server/replit_integrations/*` scaffolding should be ignored unless later wired into `registerRoutes`.

## Scan Anchors

- Production entry points: `server/index.ts`, `server/routes.ts`, `server/static.ts`.
- Highest-risk areas: `POST /api/chat`, `POST /api/upload`, `GET /api/analysis-json`, `server/analysis-store.ts`, `server/cache-db.ts`, `server/location.ts`, `server/weather-*.ts`.
- Public surfaces: the main app routes in `server/routes.ts` are unauthenticated and internet-reachable on the public deployment.
- Shared state/persistence anchors: `lastAnalysisContext`, `lastAnalysisFilePath`, `lastPhotoAnalysis`, `analyses/`, PostgreSQL `analyses` table.
- Usually ignore unless mounted: `server/replit_integrations/*`, `server/vite.ts`, `tests/`, build config.

## Threat Categories

### Spoofing

There is no authenticated user model on the main production routes, so the primary spoofing risk is request origin ambiguity rather than account takeover. The system must not treat process-global state as if it belongs to the current requester. Any follow-up context used by `/api/chat`, `/api/upload`, or `/api/analysis-json` must be scoped to the same user/session that created it.

### Tampering

Untrusted clients control chat text, upload payloads, and location inputs. The server must validate request shapes, file types, and derived metadata before using them in downstream AI or weather-processing pipelines. Persisted analysis artifacts must not be overwritten or repointed in a way that lets one requester affect another requester’s exported result.

### Information Disclosure

This project handles potentially sensitive location-derived data even without formal accounts. Uploaded-media metadata, inferred locations, recent analyses, and saved outputs must not be exposed to unrelated users through public endpoints, shared in-memory globals, or downloadable artifacts. Error handling and logging must avoid leaking secrets or private user content.

### Denial of Service

The public API triggers expensive work: multiple third-party fetches, LLM calls, ffmpeg/ffprobe, and database/filesystem writes. The system must enforce meaningful abuse controls on `/api/chat` and `/api/upload`, bound request sizes and durations, and ensure temporary artifacts are cleaned up. Public users must not be able to exhaust AI quota, CPU, disk, or outbound request budgets with repeated requests.

### Elevation of Privilege

There is no admin role in the main app, so the relevant privilege risk is unauthorized access to server-held capabilities and other users’ persisted outputs. Public callers must only access data created within their own session/context, and public routes must not grant implicit access to premium backends (AI provider credentials, filesystem exports, or historical analyses) beyond the intended single-request operation.
