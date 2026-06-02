"""CSV streaming helpers for "Export this view" exports.

Why streaming: a clinic with 50k invoices shouldn't load all rows into
memory before the first byte hits the wire. We yield in chunks of
`PAGE_CHUNK` rows. Memory stays bounded; the user's browser starts
downloading immediately.

Auth: every export endpoint accepts the **same query params** as its
matching list endpoint (search / status / from_date / to_date) so the
exported file is "exactly what the user is currently looking at". Cookie
auth carries through automatically when the browser opens the URL.
"""
from __future__ import annotations

import csv
import io
from datetime import datetime
from typing import AsyncIterator

from fastapi.responses import StreamingResponse

PAGE_CHUNK = 200  # rows per Mongo round-trip


def _row_to_csv(writer: csv.writer, buf: io.StringIO, row: list) -> bytes:
    writer.writerow(row)
    out = buf.getvalue().encode("utf-8")
    buf.seek(0)
    buf.truncate(0)
    return out


def _utf8_bom() -> bytes:
    """Excel-friendly BOM so unicode patient names (Devanagari, Tamil,
    etc.) render correctly when the file is opened by double-clicking."""
    return b"\xef\xbb\xbf"


async def stream_csv(
    *,
    filename_prefix: str,
    headers: list[str],
    rows_iter: AsyncIterator[list],
) -> StreamingResponse:
    """Generic CSV streamer. `rows_iter` is an async generator yielding
    one list-of-cells per row (in the same order as `headers`)."""
    buf = io.StringIO()
    writer = csv.writer(buf, quoting=csv.QUOTE_MINIMAL)

    async def gen():
        yield _utf8_bom()
        yield _row_to_csv(writer, buf, headers)
        async for row in rows_iter:
            yield _row_to_csv(writer, buf, row)

    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    fname = f"{filename_prefix}-{ts}.csv"
    return StreamingResponse(
        gen(),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{fname}"',
            # Prevent CDN caching of a per-user-scoped export
            "Cache-Control": "no-store",
        },
    )
