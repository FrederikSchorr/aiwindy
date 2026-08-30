---
name: npm deployment lockfiles
description: Rules for keeping the npm dependency graph unambiguous and compatible with Cloud Run publishing
---

Use npm as the single authoritative root package manager for publishing. Keep only `package-lock.json` at the project root, and preserve npm 10.8.2's generated nested `inBundle` entries for optional bundled packages.

**Why:** Publishing runs npm, while a later project change introduced both a regenerated npm lockfile and a pnpm lockfile. Every subsequent Cloud Run install failed inside npm Arborist with `ERR_INVALID_ARG_TYPE` and a missing `from` path, while the last build before the mixed lockfiles succeeded. npm normalization also found missing Tailwind Oxide bundle nodes, but restoring those alone did not resolve the Cloud failure.

**How to apply:** Do not commit a root pnpm or Yarn lockfile unless publishing is deliberately migrated away from npm. After changing the npm lockfile, normalize it with the same npm major/minor used by publishing and verify a clean install from an empty directory. Do not remove generated `inBundle` nodes just because they target an optional non-host platform.