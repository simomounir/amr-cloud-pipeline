"""amrtools fetch-reads: download one FASTQ with retries, checking its size and MD5."""

import hashlib
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from amrtools.cli import main
from amrtools.fetch import FetchError, fetch

BODY = b"@r1\nACGT\n+\nIIII\n" * 1000
MD5 = hashlib.md5(BODY).hexdigest()


class Handler(BaseHTTPRequestHandler):
    """Serves BODY; the path picks a behaviour, and `failures` counts down transient errors."""

    failures = 0
    requests = 0

    def do_GET(self):  # noqa: N802 (http.server naming)
        type(self).requests += 1
        if self.path == "/missing":
            self.send_error(404)
            return
        if self.path == "/flaky" and type(self).failures > 0:
            type(self).failures -= 1
            self.send_error(503)
            return
        self.send_response(200)
        self.send_header("Content-Length", str(len(BODY)))
        self.end_headers()
        # /truncated promises the full length, sends a fragment and hangs up (as ENA did).
        self.wfile.write(BODY[:1000] if self.path == "/truncated" else BODY)

    def log_message(self, *args):
        pass


@pytest.fixture
def server():
    Handler.failures, Handler.requests = 0, 0
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{httpd.server_port}"
    httpd.shutdown()


def no_sleep(_seconds):
    pass


def test_downloads_and_checks_md5(server, tmp_path):
    out = tmp_path / "r_1.fastq.gz"
    fetch(f"{server}/ok", out, md5=MD5, sleep=no_sleep)
    assert out.read_bytes() == BODY


def test_transient_errors_are_retried(server, tmp_path):
    Handler.failures = 2
    fetch(f"{server}/flaky", tmp_path / "r.fastq.gz", sleep=no_sleep)
    assert Handler.requests == 3


def test_truncated_download_is_retried_then_fails_without_leaving_a_file(server, tmp_path):
    out = tmp_path / "r.fastq.gz"
    with pytest.raises(FetchError, match="after 3 attempts"):
        fetch(f"{server}/truncated", out, attempts=3, sleep=no_sleep)
    assert Handler.requests == 3
    assert not out.exists() and list(tmp_path.iterdir()) == []


def test_wrong_md5_fails(server, tmp_path):
    with pytest.raises(FetchError, match="MD5"):
        fetch(f"{server}/ok", tmp_path / "r.fastq.gz", md5="0" * 32, attempts=2, sleep=no_sleep)


def test_not_found_is_not_retried(server, tmp_path):
    with pytest.raises(FetchError, match="404"):
        fetch(f"{server}/missing", tmp_path / "r.fastq.gz", sleep=no_sleep)
    assert Handler.requests == 1


def test_cli(server, tmp_path):
    out = tmp_path / "r.fastq.gz"
    assert main(["fetch-reads", f"{server}/ok", "--out", str(out), "--md5", MD5]) == 0
    assert out.read_bytes() == BODY
