---
name: Universal local forecasts
description: Source-precedence and transparency rules for local sailing forecasts across countries.
---

Use Open-Meteo as the reliable six-day local baseline for wind, cloud, rain, thunderstorm risk and temperature. Treat marine wave data as optional: it may appear only when the provider returned real usable wave values. National adapters do not replace the baseline; their concrete local values take priority for the intervals they actually cover, while their warnings and synopses remain separate.

**Why:** National feeds differ substantially in coverage and availability. Replacing local coverage wholesale with a short or failed national bulletin creates dangerous forecast gaps and can falsely imply a warning all-clear.

**How to apply:** Keep section 6 limited to sources that supplied usable data. Show an explicit warning-center capability state separately: connected, temporarily unavailable, or not connected. An unavailable warning source must never be rendered as “no warning.”

In the sources view, a connected provider must be named as the concrete forecast or warning product it supplied (for example, a marine forecast including storm warnings), not as a generic live “connected” status. Capability status is reserved for unavailable or unsupported warning centers.

**Why:** A source list should explain the provenance of the displayed information. A bare connection status is redundant and can be mistaken for a weather observation or warning.

**How to apply:** Keep each connected national source once, with a descriptive label. Continue showing neutral warning-center text only when that source is unavailable or not integrated.