#!/usr/bin/env bash
# seed.sh — bangkitkan seed event lewat skrip web (satu logika pindai) lalu salin ke client/public (git-ignored).
set -euo pipefail; cd "$(dirname "$0")/.."
(cd ../web && npm run seed) && cp ../web/public/events-seed.json client/public/events-seed.json && echo "seed disalin"
