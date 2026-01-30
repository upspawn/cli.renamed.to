---
"@renamed-to/cli": minor
---

Added `--poll` and `--poll-interval` options to the `watch` command for environments where native filesystem events don't work (Docker bind mounts, NFS, CIFS)
