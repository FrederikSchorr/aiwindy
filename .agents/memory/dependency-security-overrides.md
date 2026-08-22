---
name: Dependency security overrides
description: Security remediation policy for vulnerable transitive Node dependencies.
---

For vulnerable transitive dependencies whose parent ranges already allow a patched release but retain an older locked version, use a narrow root-level npm override rather than adding an unnecessary direct dependency or making a major parent upgrade.

**Why:** Updating a direct parent may preserve a vulnerable transitive lockfile resolution even when its semver range permits a fixed package. Narrow overrides retain the existing parent API while deterministically resolving the audited patch.

**How to apply:** After any dependency security update, regenerate the lockfile through the package manager, inspect the resolved tree, and require `npm audit` to report zero findings for both full and production dependency sets. Revisit or remove overrides when the owning parent package adopts a safe version directly.