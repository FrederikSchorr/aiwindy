---
name: Meteogram design direction
description: The authoritative visual baseline and product constraints for the city weather forecast.
---

Use the supplied Windy meteogram screenshot as the visual baseline for the city forecast. Build a compact, light weather timeline from that reference rather than from the previous atmospheric-map implementation. During visual exploration, work only in the mockup sandbox and Canvas; defer production integration until the user explicitly approves the design. The current Canvas direction omits the three cloud bands and uses one pressure/rain area instead.

**Why:** The user explicitly rejected the prior atmospheric-map direction because it treated the existing implementation as the baseline instead of the supplied reference. The user also clarified that this stage is design exploration only; changing production before approval creates unwanted coupling. The cloud rendering was too heavy for the Canvas preview, so the current exploration should use the lighter pressure/rain replacement.

**How to apply:** Match the reference's row rhythm, neutral surface, temperature fill, compact weather icons, rain treatment, and fixed-label/scrolling-timeline structure. The user approved this direction for production on 2026-08-30: production uses the lightweight pressure/rain chart, no visible cloud bands or cloud-base row, and no wind or gust rows.

Temperature and dew-point curves share the same projection, whose visible domain is derived only from temperature with asymmetric padding: minimum temperature minus 4 and maximum temperature plus 1. Clip the plotted curves to that temperature viewport, but keep all dew-point numbers fully visible in a compact foreground row inside the lower portion of the temperature fill. Never distribute the labels vertically or compress the dew curve onto an artificial lower edge. Do not draw an explicit lower contour line on the temperature fill. Do not use horizontal row separators or horizontal chart grid lines; retain only meaningful vertical boundaries such as day changes.

Weather icons follow Windy's compact visual language and render above the temperature fill. Distinguish clear, few/broken/overcast clouds, light/heavy rain, and thunderstorms; use sun only by day and moon/night treatment after dark. Keep each state in its own SVG viewBox rather than cropping a multi-icon sprite, because generated sprite artwork can cross cell boundaries and reveal neighboring fragments. For thunderstorms, emphasize the safety-orange lightning bolt while keeping the cloud at the normal icon scale.

Do not reveal section 4, its Windy link, or a meteogram placeholder when the earlier Europe-map event arrives. Publish the first chart-ready analysis payload immediately after the local Open-Meteo/raw weather fetch, before LLM preprocessing and interpretation; then reveal section 4 with the finished meteogram. While interpretation is pending, show one three-dot loader under each of the four interpretation sections plus the changing icon-and-text status loader at the very bottom; remove all loaders when the complete output arrives. Do not add a second loader inside the meteogram.

The Windy link below the city meteogram must use the recognized city coordinates, not the sailing-area coordinates used by the regional wind map.

**Why:** The meteogram represents the local city forecast; using the sailing-area center can point Windy at a different location than the displayed city data.

**How to apply:** Build the section-4 URL from cityLat/cityLon with the location coordinates only as a fallback. Keep the section-3 wind URL on sailing-area coordinates.

The production meteogram container uses subtle Windy-style rounded corners and the app's global Open Sans hierarchy; chart labels should remain readable at normal body-text scale rather than using miniature map-overlay typography.

Keep the main timeline in three-hour columns, but render precipitation inside each column as up to three narrow hourly bars. The daily rain badge shows the sum of all hourly amounts; never represent a three-hour rain block as one wide aggregated bar.
Label the hourly-bar cluster with its highest individual hourly amount; reserve the daily total exclusively for the day badge.

**Why:** The user wants the Windy-style distinction between individual hourly rain pulses while retaining the compact three-hour weather timeline.

**How to apply:** Preserve the three hourly precipitation amounts alongside each compacted forecast point, use them for the narrow bars, and use their sum for the daily total and interpretation context.

Section-4 interpretation temperatures use whole degrees only. Do not narrate small adjacent-hour temperature changes; describe meaningful temperature evolution with broad day phases instead. Preserve qualitative Cumulus references, and never use “Keine markante Wetterentwicklung erkennbar” as a standalone fallback—summarize the stable dry/cloud/thermal character. For the four-day outlook, highlight a supported synoptic trend such as stable Mediterranean high pressure, but never reduce the bullet to that headline; retain 1–2 complementary details about sunshine, heat, dryness, or persistence.

Section 4 must use user-facing weather descriptions rather than technical WMO code labels or numeric weather codes; for example, say “Nebelfelder möglich” instead of exposing WMO code 45.

**Why:** The user confirmed that Cumulus wording and concise Mediterranean high-pressure trends are useful, while decimal temperatures, hour-to-hour 2°C changes, and generic no-change text add noise rather than interpretation.

**How to apply:** Enforce these constraints in both the generation prompt and deterministic output cleanup so model variation cannot reintroduce the rejected phrasing.