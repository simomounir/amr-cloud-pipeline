"""Download one read file over HTTP(S) with retries, checking its size and MD5.

Runs inside each sample's first pipeline task, so a download that keeps failing fails that
sample only (and is retried and recorded like any other per-sample failure).
"""

import hashlib
import http.client
import time
import urllib.error
import urllib.request
from pathlib import Path

from amrtools.errors import InputFormatError

CHUNK = 1 << 20
SCHEMES = ("http://", "https://", "ftp://")


class FetchError(InputFormatError):
    """A read file could not be downloaded intact."""


class _Incomplete(Exception):
    pass


def _download_once(url: str, part: Path, md5: str | None, opener) -> None:
    digest = hashlib.md5()
    received = 0
    with opener(url, timeout=120) as response, open(part, "wb") as handle:
        expected = response.headers.get("Content-Length")
        while chunk := response.read(CHUNK):
            handle.write(chunk)
            digest.update(chunk)
            received += len(chunk)
    if expected is not None and received != int(expected):
        raise _Incomplete(f"received {received} of {expected} bytes")
    if md5 and digest.hexdigest() != md5.lower():
        raise _Incomplete(f"MD5 {digest.hexdigest()} does not match expected {md5}")


def fetch(
    url: str,
    out: Path,
    *,
    md5: str | None = None,
    attempts: int = 5,
    opener=urllib.request.urlopen,
    sleep=time.sleep,
) -> None:
    """Download `url` to `out`. Writes to a `.part` file and renames it only when complete."""
    if not url.lower().startswith(SCHEMES):
        raise FetchError(f"{url}: unsupported URL scheme (http, https or ftp only)")
    out = Path(out)
    part = out.with_name(out.name + ".part")
    error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            _download_once(url, part, md5, opener)
            part.rename(out)
            return
        except urllib.error.HTTPError as exc:
            part.unlink(missing_ok=True)
            # 4xx: the file is not there (or the request is wrong); retrying will not help.
            if exc.code < 500 and exc.code != 429:
                raise FetchError(f"{url}: HTTP {exc.code}") from exc
            error = exc
        except (OSError, http.client.HTTPException, _Incomplete) as exc:
            # Resets, timeouts, truncated transfers and corrupt files are all worth a retry.
            part.unlink(missing_ok=True)
            error = exc
        if attempt < attempts:
            sleep(min(2**attempt, 60))
    raise FetchError(f"{url}: failed after {attempts} attempts ({error})")
