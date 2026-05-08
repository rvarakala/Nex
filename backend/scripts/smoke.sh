#!/usr/bin/env bash
# AUDINEXA smoke test — fast (<30s) sanity check.
#
# Usage:
#   bash backend/scripts/smoke.sh
#
# Selects every test marked @pytest.mark.smoke. Stops on the first failure.
# Run from anywhere — script resolves its own location.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$HERE/.." && pwd)"

cd "$BACKEND_DIR"
echo "▶ Running smoke suite from $BACKEND_DIR"
exec python -m pytest -m smoke -x --no-header -q "$@"
