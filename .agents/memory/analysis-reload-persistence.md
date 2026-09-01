---
name: Analysis reload persistence
description: Durable rule for restoring the latest completed weather analysis after browser reloads.
---

Persist only a fully completed analysis, and write browser persistence paths independently so a failure in one API cannot skip the other.

**Why:** Mobile browser contexts may reject a large history-state write while local storage still works. Combining both writes in one error boundary caused completed analyses to disappear after reload.

**How to apply:** When changing analysis state or browser persistence, keep each storage operation isolated, never persist partial/failed analyses, and verify restoration on both desktop and a narrow mobile viewport.