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

For section 3, show the current national or regional storm-warning result as the first bullet whenever that country has an integrated warning source. A confirmed all-clear is plain text without an alert icon; an unreachable integrated source receives an explicit alert status. Unsupported centers stay only in section 6.

**Why:** Sailors need a visible confirmation that the relevant warning source was checked, while an unavailable service must be unmistakable and never be mistaken for an all-clear.

**How to apply:** Insert this bullet deterministically ahead of the wind forecast after output generation. Use a checked flag to distinguish confirmed warnings/all-clears from an unreachable source; do not create it for unsupported countries.

Restore an integrated warning centre's complete authoritative text after model generation; never accept a model echo as the final warning. Identify warning candidates by warning-specific wording or the authoritative first line, not by the severity icon alone.

**Why:** The model can preserve only the first line while altering later warning lines, and the same severity icon is also valid on ordinary high-wind forecast bullets.

**How to apply:** Remove only the generated warning candidate and its continuation, prepend the authoritative text unchanged, and preserve separate severe-wind forecast bullets even when they use the warning icon.