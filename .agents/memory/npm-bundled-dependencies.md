---
name: npm deployment lockfiles
description: Rules for keeping the npm dependency graph unambiguous and compatible with Cloud Run publishing
---

Use npm as the single authoritative root package manager for publishing. Keep only `package-lock.json` at the project root, and ensure the installed dependency tree is npm-generated rather than inherited from pnpm.

**Why:** Publishing runs npm, while a later project change introduced both a regenerated npm lockfile and a pnpm lockfile. Every subsequent Cloud Run install failed inside npm Arborist with `ERR_INVALID_ARG_TYPE` and a missing `from` path. Removing only the pnpm lockfile and restoring omitted bundle nodes did not resolve it. Locally, npm then exposed `workspace:*` errors when operating over the pnpm-generated dependency tree; removing that generated tree allowed npm 10.8.2 to install cleanly and regenerate a complete lockfile through Replit's registry.

**How to apply:** Do not commit a root pnpm or Yarn lockfile unless publishing is deliberately migrated away from npm. If package managers were mixed, remove the generated dependency tree before running npm; changing lockfiles alone is insufficient. Regenerate with the same npm major/minor used by publishing, retain its complete output, and verify a clean install from an empty directory.