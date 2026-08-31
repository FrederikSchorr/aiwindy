---
name: Section 3 chart-first interpretation
description: The wind and wave LLM section should interpret the visible wind chart instead of transcribing every time slot.
---

# Section 3 chart-first interpretation

Section 3 should preserve the fixed order of warning, today, tomorrow, day after tomorrow, and the three-day outlook. The wind chart is the detailed timeline, so prose should focus on meaningful changes, named local wind systems, strong or stormy phases, and an optional supported synoptic pattern. Explicit wave data remains useful because the chart does not show wave state.

**Why:** Repeating every wind value and direction made the interpretation redundant with the visual forecast and obscured the important changes.

**How to apply:** Keep local wind and warning data authoritative. Mention only salient strengthening, weakening, shifts, lulls, peaks, or hazards; use broad synoptic context only when it clearly supports the local evolution.

Generated wind text must not use `SSW`; normalize that southwest sector to `SW`. Official warning text remains verbatim even if the warning centre itself uses finer direction wording.

**Why:** The requested user-facing granularity stops at `SW`, while official warnings must never be rewritten.

**How to apply:** Exclude `SSW` from generation prompts and normalize generated forecast text before the authoritative warning is restored.

Show gusts in prose only as a compact daily range such as `Böen 12–25 kt`. Do not repeat the maximum as “stärkste Böe um …” with an exact time or day period.

**Why:** The exact gust timeline is already visible in the chart; repeating its maximum and timestamp makes section 3 unnecessarily detailed.

**How to apply:** Keep the maximum row among chart/context samples so the range stays accurate, but remove peak-time prose before display and prohibit “Böen bis …” wording.

User-facing wind text uses only the eight compass points N, NO, O, SO, S, SW, W, NW; finer 16-point source directions are reduced to their nearest 8-point direction.

**Why:** The forecast is intended to be quickly readable and must not leak source labels such as NNW or WNW.

**How to apply:** Keep numeric degrees for chart arrows and timestamp resolution, but normalize textual directions in provider summaries, prompts, and final generated output.