---
name: Weather output semantic validation
description: Durable validation rules for target-specific bullets and semantic weather icons
---

# Weather Output Semantic Validation

Generated target-specific bullets must be checked against the current analysis location. If the model names a stale or unrelated target, bind the sentence subject to the actual location instead of trusting prompt compliance alone.

**Why:** Repeated fresh analyses showed that an otherwise correctly structured local-front bullet could name a location from another analysis even when the prompt explicitly required the current sailing area.

**How to apply:** For any location-specific generated section, validate the target reference after generation. Keep large-scale and local statements in their assigned bullet positions.

Weather icons must be selected from positive weather evidence after removing negated phrases such as “kein nennenswerter Niederschlag”.

**Why:** Keyword-only icon selection classified negated precipitation statements as rain.

**How to apply:** Strip or recognize negated phenomena before semantic icon classification, and cover adjective-bearing negations in regression tests.

Section completeness must be validated again after deterministic normalization and sanitization, not only on the raw model response.

**Why:** A formally complete three-line weather section can become empty when every clause is removed by output constraints, leaving the UI to show a meteogram and sources without forecast text.

**How to apply:** Treat post-normalization emptiness as an incomplete model attempt, retry through the existing correction loop, and never persist or render that result as a completed analysis.