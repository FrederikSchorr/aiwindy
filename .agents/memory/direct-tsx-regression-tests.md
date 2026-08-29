---
name: Direct TSX regression tests
description: Runtime requirement for rendering React TSX directly from the repository's tsx test runner
---

When a regression test imports a React component directly and renders it with `react-dom/server`, the component needs an explicit React runtime import because the repository's TypeScript JSX setting preserves JSX for the Vite transform.

**Why:** The browser build supplies the JSX runtime during Vite compilation, but direct `tsx` execution of a `.tsx` module otherwise fails with `React is not defined`.

**How to apply:** Keep component-level server-rendering tests using `createElement` in plain `.ts` test files, and ensure directly imported TSX components have the runtime import required by the test runner.