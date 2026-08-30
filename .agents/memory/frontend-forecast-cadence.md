---
name: Frontend forecast cadence
description: Prevents frontend forecast components from reducing an already compacted three-hour analysis export a second time.
---

Frontend consumers of analysis exports must not assume that Open-Meteo forecast arrays are still hourly. Detect the timestamp cadence before sampling, and enforce the product's expected final point count.

**Why:** The analysis export can compact hourly source data to three-hour values before it reaches the UI. Blindly taking every third exported value turns a six-day, 48-column forecast into only 16 columns.

**How to apply:** When building a chart from exported weather data, inspect consecutive timestamp gaps first. Preserve an existing three-hour series; sample only genuinely hourly input. Treat incomplete final series as unavailable unless the product explicitly defines gap filling.