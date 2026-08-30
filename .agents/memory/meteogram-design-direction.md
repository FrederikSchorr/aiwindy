---
name: Meteogram design direction
description: The authoritative visual baseline and product constraints for the city weather forecast.
---

Use the supplied Windy meteogram screenshot as the visual baseline for the city forecast. Build a compact, light weather timeline from that reference rather than from the previous atmospheric-map implementation. During visual exploration, work only in the mockup sandbox and Canvas; defer production integration until the user explicitly approves the design. The current Canvas direction omits the three cloud bands and uses one pressure/rain area instead.

**Why:** The user explicitly rejected the prior atmospheric-map direction because it treated the existing implementation as the baseline instead of the supplied reference. The user also clarified that this stage is design exploration only; changing production before approval creates unwanted coupling. The cloud rendering was too heavy for the Canvas preview, so the current exploration should use the lighter pressure/rain replacement.

**How to apply:** Match the reference's row rhythm, neutral surface, temperature fill, compact weather icons, rain treatment, and fixed-label/scrolling-timeline structure. In the current Canvas prototype, replace cloud bands with one lightweight pressure/rain chart and keep the cloud-base row only if it remains part of the reference composition. Do not add wind or gust rows, and do not edit the production component until the user approves the Canvas design.

Temperature and dew-point curves share the same projection, whose visible domain is derived only from temperature. Clip the plotted curves to that temperature viewport, but keep all dew-point numbers fully visible in a compact foreground row inside the lower portion of the temperature fill. Never distribute the labels vertically or compress the dew curve onto an artificial lower edge. Do not draw an explicit lower contour line on the temperature fill. Do not use horizontal row separators or horizontal chart grid lines; retain only meaningful vertical boundaries such as day changes.