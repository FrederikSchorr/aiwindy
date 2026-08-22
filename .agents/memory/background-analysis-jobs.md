---
name: Background analysis jobs
description: Durable rules for disconnect-safe weather-analysis execution and resume access.
---

# Background Analysis Jobs

Weather analyses must continue independently of the initiating SSE request. A reconnect must attach to the existing job and replay its event history rather than submit the location again.

**Why:** Mobile browsers can pause or close streaming connections while a tab is in the background. Re-running an analysis would duplicate expensive pipeline work and can create duplicate chat output.

**How to apply:** Treat the per-job UUID capability token as the sole authorization for status, event replay, and cancellation. Keep events idempotently numbered, retain terminal jobs briefly for reconnection, and make every timeout or cancellation publish one terminal event before cleanup. Keep a bounded background-job count separate from short-lived request counters.