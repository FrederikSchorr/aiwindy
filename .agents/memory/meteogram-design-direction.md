---
name: Meteogram design direction
description: The authoritative visual baseline and product constraints for the city weather forecast.
---

Use the supplied Windy meteogram screenshot as the visual baseline for the city forecast. Build a compact, light weather timeline from that reference rather than from the previous atmospheric-map implementation.

**Why:** The user explicitly rejected the prior atmospheric-map direction because it treated the existing implementation as the baseline instead of the supplied reference. The city chart should also exclude wind and gust rows, while its three cloud bands may remain visually simple.

**How to apply:** Match the reference's row rhythm, neutral surface, temperature fill, compact weather icons, rain treatment, and fixed-label/scrolling-timeline structure. Keep exactly three aggregate cloud bands and do not add wind or gust rows.