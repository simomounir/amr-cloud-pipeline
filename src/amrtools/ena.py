"""Build samplesheets from ENA accessions (runs, samples or studies)."""

import csv
import http.client
import io
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlencode

from amrtools.errors import InputFormatError

FILEREPORT = "https://www.ebi.ac.uk/ena/portal/api/filereport"
ENA_FIELDS = (
    "run_accession", "sample_accession", "study_accession", "instrument_platform",
    "library_layout", "fastq_ftp", "collection_date", "country", "isolation_source", "host",
)  # fmt: skip
METADATA_COLUMNS = [
    "run_accession", "sample_accession", "study_accession",
    "collection_date", "country", "isolation_source", "host",
]  # fmt: skip
SAMPLESHEET_COLUMNS = ["sample", "fastq_1", "fastq_2", "sample_type", "organism"] + METADATA_COLUMNS


class EnaError(InputFormatError):
    """ENA could not be reached, rejected the request, or returned nothing usable."""


def filereport_url(accession: str) -> str:
    query = {"accession": accession, "result": "read_run", "fields": ",".join(ENA_FIELDS),
             "format": "tsv"}  # fmt: skip
    return f"{FILEREPORT}?{urlencode(query)}"


def http_get(url, *, opener=urllib.request.urlopen, sleep=time.sleep, attempts=5) -> str:
    error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            with opener(url, timeout=60) as response:
                return response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            # 4xx means a bad request (e.g. malformed accession), except 429 rate limiting.
            if exc.code < 500 and exc.code != 429:
                raise EnaError(f"ENA rejected request ({exc.code}): {url}") from exc
            error = exc
        except (OSError, http.client.HTTPException) as exc:
            # URLError, timeouts, resets and truncated responses are all worth a retry.
            error = exc
        if attempt < attempts:
            sleep(2**attempt)
    raise EnaError(f"ENA unavailable after {attempts} attempts: {url} ({error})")


def fetch_runs(accession: str, get=http_get) -> list[dict[str, str]]:
    runs = list(csv.DictReader(io.StringIO(get(filereport_url(accession))), delimiter="\t"))
    if not runs:
        raise EnaError(f"ENA returned no runs for accession {accession}")
    return runs


def _mates(run: dict[str, str]) -> tuple[list[str], list[str]]:
    files = [f for f in run.get("fastq_ftp", "").split(";") if f]
    mate1 = [f for f in files if f.endswith("_1.fastq.gz")]
    mate2 = [f for f in files if f.endswith("_2.fastq.gz")]
    return mate1, mate2


def _skip_reason(run: dict[str, str]) -> str | None:
    if run["instrument_platform"] != "ILLUMINA":
        return f"platform {run['instrument_platform']}"
    if run["library_layout"] != "PAIRED":
        return f"layout {run['library_layout']}"
    mate1, mate2 = _mates(run)
    if len(mate1) != 1 or len(mate2) != 1:
        return f"expected one _1 and one _2 FASTQ, found {len(mate1)} and {len(mate2)}"
    return None


def fetch_samples(accessions: list[str], organism: str, get=http_get):
    rows: list[dict] = []
    skipped: list[dict] = []
    seen: set[str] = set()
    for accession in accessions:
        for run in fetch_runs(accession, get):
            run_id = run["run_accession"]
            if run_id in seen:
                continue
            seen.add(run_id)
            reason = _skip_reason(run)
            if reason:
                skipped.append({"run_accession": run_id, "reason": reason})
                continue
            (mate1,), (mate2,) = _mates(run)
            rows.append(
                {
                    "sample": run_id,
                    "fastq_1": f"https://{mate1}",
                    "fastq_2": f"https://{mate2}",
                    "sample_type": "isolate",
                    "organism": organism,
                }
                | {column: run.get(column, "") for column in METADATA_COLUMNS}
            )
    return rows, skipped


def write_csv(rows: list[dict], columns: list[str], path: Path) -> None:
    with open(path, "w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
