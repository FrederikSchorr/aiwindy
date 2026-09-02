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

Every section's completeness must be validated again after deterministic normalization and sanitization, not only on the raw model response.

**Why:** A formally complete weather section can become empty when clauses are removed by output constraints. Wind and warning cleanup can also delete a forecast tail that existed in the raw response.

**How to apply:** Validate required line counts and forbidden cross-section content on final normalized text inside the correction loop. Retry failures and never persist or render them as completed analyses.