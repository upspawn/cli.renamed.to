---
"@renamed-to/cli": patch
---

Fixed lint issues across the codebase

- Removed unused imports in watch.ts, logger.test.ts, e2e-test.ts
- Fixed unused variables in index.ts, rename.test.ts, e2e-test.ts
- Prefixed unused parameters with underscore in extract.ts
- Added coverage/** to eslint ignores (generated files)
