---
name: Weather output LLM format
description: Why we use section markers instead of JSON for generateWeatherOutput in weather-output.ts
---

# Weather Output Format: Section Markers

The `generateWeatherOutput()` function in `server/weather-output.ts` uses a section-marker format instead of JSON for Claude responses.

## The Rule
Prompt Claude to produce:
```
===airPressureMasses===
- 🌀 ...content...
===weatherFront===
- 🔵 ...
...
===END===
```
Parse with `parseSectionMarkers()` (not JSON.parse).

## Why
Claude (claude-sonnet-4-6) uses ASCII double quotes `"` inside its text output — e.g. German quotation phrases like `„Quella"` where the closing quote is U+0022 (ASCII double quote). This prematurely terminates JSON string values, causing `JSON.parse` to fail at whichever position the unescaped quote appears.

A two-stage JSON fix (`fixJsonNewlines`) handled unescaped newlines but NOT unescaped quotes, which are ambiguous to repair.

## Why Section Markers Beat JSON
- No delimiter ambiguity: `===KEY===` cannot appear in normal weather text
- Handles multi-line content naturally
- No escaping required for any characters
- Fallback-safe: partial responses still yield whatever sections were parsed

**Why:** JSON parsing of LLM output is inherently fragile; the fix was discovered because real weather text contained German-style quotes that broke parsing at position 45.

## Fallback principle

Deterministic post-processing should fill only missing contractual bullets. When Claude already supplied a forecast bullet, preserve its qualitative meteorological interpretation and only normalize required syntax such as dates, icons, or wind/gust pairing.

**Why:** A completeness fallback that rewrote existing content into numeric summaries removed valuable references to regional wind systems and weather patterns.
