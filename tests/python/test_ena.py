import csv
import http.client
import io
import urllib.error
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest

from amrtools.cli import main
from amrtools.ena import (
    SAMPLESHEET_COLUMNS,
    EnaError,
    fetch_samples,
    filereport_url,
    http_get,
    write_csv,
)

FIXTURES = Path(__file__).parent / "fixtures" / "ena"
KP = "Klebsiella_pneumoniae"


def fixture_get(url):
    accession = parse_qs(urlparse(url).query)["accession"][0]
    return (FIXTURES / f"{accession}.tsv").read_text()


def test_url_requests_tsv_read_runs_with_metadata_fields():
    query = parse_qs(urlparse(filereport_url("SRR5386028")).query)
    assert query["accession"] == ["SRR5386028"]
    assert query["result"] == ["read_run"]
    assert "collection_date" in query["fields"][0].split(",")


def test_single_run_becomes_samplesheet_row():
    rows, skipped = fetch_samples(["SRR5386028"], KP, get=fixture_get)
    assert skipped == []
    (row,) = rows
    assert list(row) == SAMPLESHEET_COLUMNS
    assert row["sample"] == "SRR5386028"
    assert row["fastq_1"].startswith("https://ftp.sra.ebi.ac.uk/")
    assert row["fastq_1"].endswith("_1.fastq.gz")
    assert row["fastq_2"].endswith("_2.fastq.gz")
    assert row["organism"] == KP
    assert row["country"] == "USA: Houston"
    assert row["collection_date"] == "2014-09-28"
    # ENA's MD5s, in mate order, so each download can be checked.
    assert row["md5_1"] == "6c0a2255502389c224b6b50d3156d5ee"
    assert row["md5_2"] == "4c2d226a8c644d027c1b0059cc454a7b"


def test_md5_is_empty_when_ena_has_none():
    rows, _ = fetch_samples(["PRJNA1001661"], KP, get=fixture_get)
    assert {r["md5_1"] for r in rows} == {""} and {r["md5_2"] for r in rows} == {""}


def test_study_expands_to_all_its_runs():
    rows, _ = fetch_samples(["PRJNA1001661"], KP, get=fixture_get)
    assert [r["sample"] for r in rows] == ["SRR25501257", "SRR25501259", "SRR25501262"]


def test_non_illumina_and_single_end_runs_are_skipped_with_reason():
    rows, skipped = fetch_samples(["ERR10317397", "ERR10176148"], KP, get=fixture_get)
    assert rows == []
    assert skipped == [
        {"run_accession": "ERR10317397", "reason": "platform OXFORD_NANOPORE"},
        {"run_accession": "ERR10176148", "reason": "layout SINGLE"},
    ]


def test_run_requested_twice_appears_once():
    rows, _ = fetch_samples(["SRR5386028", "SRR5386028"], KP, get=fixture_get)
    assert len(rows) == 1


def test_accession_without_runs_is_an_error():
    with pytest.raises(EnaError, match="no runs for accession SRR99999999"):
        fetch_samples(["SRR99999999"], KP, get=fixture_get)


def test_values_with_commas_round_trip(tmp_path):
    header, data = (FIXTURES / "SRR5386028.tsv").read_text().splitlines()
    data = data.replace("urine", "blood, peripheral")
    rows, _ = fetch_samples(["X"], KP, get=lambda url: f"{header}\n{data}\n")
    out = tmp_path / "samplesheet.csv"
    write_csv(rows, SAMPLESHEET_COLUMNS, out)
    with open(out, newline="") as handle:
        (parsed,) = list(csv.DictReader(handle))
    assert parsed["isolation_source"] == "blood, peripheral"


class FakeResponse:
    def __init__(self, text):
        self._text = text

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self):
        return self._text.encode()


def http_error(code):
    return urllib.error.HTTPError("https://x", code, "error", None, io.BytesIO())


def test_http_get_retries_server_errors_then_succeeds():
    calls, sleeps = [], []

    def opener(url, timeout):
        calls.append(url)
        if len(calls) == 1:
            raise http_error(503)
        return FakeResponse("ok")

    assert http_get("https://x", opener=opener, sleep=sleeps.append) == "ok"
    assert sleeps == [2]


def test_http_get_fails_fast_on_client_error():
    calls = []

    def opener(url, timeout):
        calls.append(url)
        raise http_error(400)

    with pytest.raises(EnaError, match="ENA rejected request \\(400\\)"):
        http_get("https://x?accession=BAD", opener=opener, sleep=lambda s: None)
    assert len(calls) == 1


def test_http_get_gives_up_after_five_attempts():
    sleeps = []

    def opener(url, timeout):
        raise urllib.error.URLError("connection reset")

    with pytest.raises(EnaError, match="unavailable after 5 attempts"):
        http_get("https://x", opener=opener, sleep=sleeps.append)
    assert sleeps == [2, 4, 8, 16]


def test_cli_writes_samplesheet_and_skipped(tmp_path, monkeypatch):
    monkeypatch.setattr("amrtools.cli.http_get", fixture_get)
    ids = tmp_path / "ids.txt"
    ids.write_text("SRR5386028\n\nERR10317397\n")
    out = tmp_path / "samplesheet.csv"
    assert main(["fetch-samples", "ERR14097885", "--accession-file", str(ids),
                 "--organism", KP, "--out", str(out)]) == 0  # fmt: skip
    with open(out, newline="") as handle:
        assert [r["sample"] for r in csv.DictReader(handle)] == ["ERR14097885", "SRR5386028"]
    skipped = (tmp_path / "samplesheet.skipped.csv").read_text().splitlines()
    assert skipped == ["run_accession,reason", "ERR10317397,platform OXFORD_NANOPORE"]


def test_test_samplesheet_metadata_matches_ena():
    sheet = Path(__file__).resolve().parents[2] / "tests" / "data" / "samplesheet_test.csv"
    with open(sheet, newline="") as handle:
        expected = {row["sample"]: row for row in csv.DictReader(handle)}
    rows, _ = fetch_samples(list(expected), KP, get=fixture_get)
    for row in rows:
        for column in ("sample_accession", "study_accession", "collection_date", "country",
                       "isolation_source", "host"):  # fmt: skip
            assert row[column] == expected[row["sample"]][column]


@pytest.mark.parametrize(
    "failure",
    [http.client.RemoteDisconnected("closed"), ConnectionResetError("reset"),
     http.client.IncompleteRead(b"", 10), TimeoutError("slow")],
)  # fmt: skip
def test_http_get_retries_dropped_connections(failure):
    calls, sleeps = [], []

    def opener(url, timeout):
        calls.append(url)
        if len(calls) == 1:
            raise failure
        return FakeResponse("ok")

    assert http_get("https://x", opener=opener, sleep=sleeps.append) == "ok"
    assert sleeps == [2]


def test_http_get_retries_rate_limiting():
    calls = []

    def opener(url, timeout):
        calls.append(url)
        if len(calls) == 1:
            raise http_error(429)
        return FakeResponse("ok")

    assert http_get("https://x", opener=opener, sleep=lambda s: None) == "ok"
