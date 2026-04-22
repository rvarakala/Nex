"""Session-wide pytest config.

Injects env vars that individual tests need at import time (before any fixture
runs). Specifically:

* `backend/.env` — provides MONGO_URL, DB_NAME, JWT_SECRET, etc. for tests that
  spin up a direct motor client (e.g. Phase 1 numbering + state machine tests).
* `frontend/.env` — provides REACT_APP_BACKEND_URL for HTTP-level tests.

Both files are loaded with `override=False` so a value already set in the shell
(e.g. CI) wins.
"""
from __future__ import annotations

import os
from pathlib import Path


def _load_env_file(path: Path) -> None:
    if not path.is_file():
        return
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = val


# Resolve repo root from this file (conftest.py lives at /app/backend/tests/)
_REPO = Path(__file__).resolve().parent.parent.parent  # -> /app
_load_env_file(_REPO / "backend" / ".env")
_load_env_file(_REPO / "frontend" / ".env")
