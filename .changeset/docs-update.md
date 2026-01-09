---
"@renamed-to/cli": patch
---

Fixed documentation to accurately reflect CLI commands and options

- Fixed `extract` command docs (was incorrectly documenting non-existent schema types)
- Added missing options for `rename` command (--prompt, --strategy, --template, --language)
- Added missing options for `auth login` and `auth token` commands
- Added documentation for `watch`, `config`, and `doctor` commands
- Added complete configuration file schema documentation
- Removed unused `watch.directories` from config schema
- Fixed incorrect command names (`auth device` → `auth login`)
