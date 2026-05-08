"""One-shot migration script: rewrite legacy `admin@acs.in`/`admin123`
hardcodes in the pytest suite to import the shared `_helpers` constants.

Idempotent — re-running is a no-op once a file is migrated. Skips
`conftest.py` and `_helpers.py` themselves.

Run from anywhere::

    python backend/scripts/migrate_test_admin_creds.py [--dry-run]

After migration, you can override the test identity at runtime::

    TEST_ADMIN_EMAIL=founder@audinexa.com \
    TEST_ADMIN_PASSWORD=founder123 \
    pytest

(The default still resolves to `admin@acs.in`/`admin123`, which the
conftest bootstrap re-seeds, so legacy behaviour is preserved.)
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent.parent / "tests"
SKIP = {"conftest.py", "_helpers.py", "__init__.py"}

# Token replacements (literal Python source). Order matters — strings are
# replaced first, then we ensure the `_helpers` import is in place.
LITERAL_REPLACEMENTS = [
    # super_admin / generic admin
    ('"admin@acs.in"', "ADMIN_EMAIL"),
    ("'admin@acs.in'", "ADMIN_EMAIL"),
    ('"admin123"', "ADMIN_PASSWORD"),
    ("'admin123'", "ADMIN_PASSWORD"),
    # front_desk
    ('"frontdesk@acs.in"', "FRONTDESK_EMAIL"),
    ("'frontdesk@acs.in'", "FRONTDESK_EMAIL"),
    ('"frontdesk123"', "FRONTDESK_PASSWORD"),
    ("'frontdesk123'", "FRONTDESK_PASSWORD"),
    # audiologist
    ('"audiologist@acs.in"', "AUDIO_EMAIL"),
    ("'audiologist@acs.in'", "AUDIO_EMAIL"),
    ('"audio123"', "AUDIO_PASSWORD"),
    ("'audio123'", "AUDIO_PASSWORD"),
    # accounts
    ('"accounts@acs.in"', "ACCOUNTS_EMAIL"),
    ("'accounts@acs.in'", "ACCOUNTS_EMAIL"),
    ('"accounts123"', "ACCOUNTS_PASSWORD"),
    ("'accounts123'", "ACCOUNTS_PASSWORD"),
]

IMPORT_LINE = (
    "from _helpers import (  # legacy creds (env-overridable)\n"
    "    ADMIN_EMAIL, ADMIN_PASSWORD,\n"
    "    FRONTDESK_EMAIL, FRONTDESK_PASSWORD,\n"
    "    AUDIO_EMAIL, AUDIO_PASSWORD,\n"
    "    ACCOUNTS_EMAIL, ACCOUNTS_PASSWORD,\n"
    ")"
)


def needs_migration(src: str) -> bool:
    return any(lit in src for lit, _ in LITERAL_REPLACEMENTS)


_OLD_IMPORT_PATTERNS = [
    re.compile(r"^from _helpers import ADMIN_EMAIL, ADMIN_PASSWORD\s*#[^\n]*$", re.MULTILINE),
    re.compile(r"^from _helpers import ADMIN_EMAIL, ADMIN_PASSWORD\s*$", re.MULTILINE),
]


def _strip_legacy_import(src: str) -> str:
    """Remove our previous (single-line) `_helpers` import so we can re-emit
    the comprehensive multi-line version."""
    for pat in _OLD_IMPORT_PATTERNS:
        src = pat.sub("", src)
    return src


def _has_new_import(src: str) -> bool:
    """True if the file already has the multi-line comprehensive import."""
    return (
        "from _helpers import (" in src
        and "ADMIN_EMAIL" in src
        and "FRONTDESK_EMAIL" in src
    )


def rewrite_one(src: str) -> str:
    out = src
    for lit, sub in LITERAL_REPLACEMENTS:
        out = out.replace(lit, sub)

    # If the comprehensive import is already present, leave imports alone.
    if _has_new_import(out):
        return out

    # Strip any legacy single-line import we previously inserted, so the
    # multi-line version isn't duplicated.
    out = _strip_legacy_import(out)

    lines = out.splitlines(keepends=True)
    insert_at = 0
    in_docstring = False
    docstring_quote = None
    for i, line in enumerate(lines):
        stripped = line.strip()
        if i == 0 and (stripped.startswith('"""') or stripped.startswith("'''")):
            docstring_quote = stripped[:3]
            if stripped.count(docstring_quote) >= 2:
                insert_at = i + 1
                continue
            in_docstring = True
            insert_at = i + 1
            continue
        if in_docstring:
            insert_at = i + 1
            if docstring_quote and docstring_quote in stripped:
                in_docstring = False
            continue
        if stripped.startswith("import ") or stripped.startswith("from "):
            insert_at = i + 1
            continue
        if stripped == "" or stripped.startswith("#"):
            insert_at = i + 1
            continue
        break

    lines.insert(insert_at, IMPORT_LINE + "\n")
    return "".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    changed: list[str] = []
    skipped_already_clean: list[str] = []
    for path in sorted(TESTS_DIR.glob("test_*.py")):
        if path.name in SKIP:
            continue
        original = path.read_text(encoding="utf-8")
        if not needs_migration(original):
            skipped_already_clean.append(path.name)
            continue

        rewritten = rewrite_one(original)
        if rewritten == original:
            skipped_already_clean.append(path.name)
            continue

        if args.dry_run:
            changed.append(path.name)
            continue

        path.write_text(rewritten, encoding="utf-8")
        changed.append(path.name)

    print(f"✓ migrated {len(changed)} files")
    for n in changed:
        print(f"   - {n}")
    print(f"  ({len(skipped_already_clean)} files already clean / had no legacy literals)")
    if args.dry_run:
        print("(dry-run — no files were modified)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
