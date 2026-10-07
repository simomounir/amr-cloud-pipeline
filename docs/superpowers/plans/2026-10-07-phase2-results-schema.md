# Phase 2 Results Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Versioned Parquet results with cleaned ENA metadata: `fetch-samples` → pipeline `AMRTOOLS_EXPORT` → `build-dataset`, all validated against one schema.

**Architecture:** `amrtools/schema.py` defines three Arrow schemas (v1.0.0). New pure modules clean metadata, talk to ENA, build/validate tables and merge runs. The pipeline gains one final process that writes per-run Parquet; `build-dataset` combines runs into `dataset/` with a manifest.

**Tech Stack:** Python 3.12, pyarrow ≥ 25, pycountry ≥ 26, pandas (existing), urllib (stdlib), Nextflow 26.04.6, nf-test 0.9.5.

**Spec:** `docs/superpowers/specs/2026-10-07-phase2-results-schema-design.md`

## Global Constraints

- Schema version string `1.0.0`; Parquet key-value metadata key `schema_version`; compression `zstd`.
- amrtools/pipeline version bumps to `0.2.0` (image tags are immutable): `ghcr.io/simomounir/amrtools:0.2.0`.
- No network access in any test. ENA responses come from `tests/python/fixtures/ena/<ACCESSION>.tsv` (recorded from the real API).
- ENA endpoint: `https://www.ebi.ac.uk/ena/portal/api/filereport`, `result=read_run`, `format=tsv`, fields `run_accession,sample_accession,study_accession,instrument_platform,library_layout,fastq_ftp,collection_date,country,isolation_source,host`.
- HTTP retry: 5 attempts, sleep `2**attempt` seconds between attempts, retry on network errors and HTTP ≥ 500, fail immediately on 4xx.
- `source_category` values: `blood, urine, respiratory, screening, wound, other_clinical, environmental, unknown`. `collection_date_precision`: `day, month, year, missing`. `qc_status`: `pass, warn`.
- Country output: pycountry `common_name` if present, else `name` (e.g. `United States`, `Vietnam`, `South Korea`).
- `build-dataset` file size limit: 95 MB per file.
- CLI error contract (unchanged): exit 1 and `amrtools: error: <message>` on stderr.
- All commits on branch `phase2-schema`; no pushes without the user's explicit OK; no `Co-Authored-By` trailers.

## Review Focus

1. **`build-dataset --out` pointing at an existing folder that is not a dataset** (e.g. a typo'd home or results folder): expected refusal without deleting anything. Pinned in Task 6 (`test_refuses_to_replace_non_dataset_folder`).
2. **ENA metadata containing commas** (`blood, peripheral`; `Korea, Republic of`): the written samplesheet must quote them so the CSV still parses. Pinned in Task 3 (`test_values_with_commas_round_trip`).
3. **A rerun that covers only some samples:** samples absent from the newer run keep their older rows; nothing is lost or duplicated. Pinned in Task 6 (`test_partial_rerun_keeps_older_samples`).
4. **Messy capitalisation and whitespace** (` germany `, `BLOOD`, `USA:houston `): cleaned like their tidy forms. Pinned in Task 2 (parametrised cases).
5. **Impossible calendar dates** (`2019-02-30`, `2019-13`): precision `missing`, never a crash or wrong month. Pinned in Task 2.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/amrtools/schema.py` | Arrow schemas, version, allowed values, JSON export |
| `src/amrtools/tables.py` | build an Arrow table from records; write Parquet with version metadata |
| `src/amrtools/metadata.py` | clean dates, countries, sources, hosts |
| `src/amrtools/ena.py` | ENA HTTP with retry, filereport parsing, `fetch_samples` |
| `src/amrtools/validate.py` | `DatasetError`, `validate_dir` |
| `src/amrtools/export.py` | samplesheet + merged TSVs → three Parquet files + samples.tsv |
| `src/amrtools/dataset.py` | `build_dataset` (dedup, manifest, atomic replace) |
| `src/amrtools/cli.py` | new subcommands `schema`, `fetch-samples`, `export`, `validate`, `build-dataset` |
| `schemas/v1.0.0/*.json` | generated schema docs (committed) |
| `modules/local/amrtools/export/main.nf` | `AMRTOOLS_EXPORT` process |
| `tests/python/test_{schema,metadata,ena,validate,export,dataset}.py` | unit tests |

---

### Task 1: Schema module, version bump and JSON export

**Files:**
- Create: `src/amrtools/schema.py`, `src/amrtools/tables.py`, `tests/python/test_schema.py`, `schemas/v1.0.0/{samples,amr_genes,run_summary}.json` (generated)
- Modify: `pyproject.toml` (version 0.2.0, deps), `nextflow.config` (version + container 0.2.0), `.github/workflows/ci.yml` (`AMRTOOLS_IMAGE`), `tests/python/test_package.py`, `src/amrtools/cli.py` (add `schema` subcommand)

**Interfaces:**
- Produces:
  - `SCHEMA_VERSION = "1.0.0"`, `SCHEMA_MAJOR = 1`, `SAMPLES`, `AMR_GENES`, `RUN_SUMMARY` (`pa.Schema`), `TABLES: dict[str, pa.Schema]` (keys `samples, amr_genes, run_summary`), `ALLOWED_VALUES: dict[str, dict[str, tuple[str, ...]]]`, `SOURCE_CATEGORIES`, `DATE_PRECISIONS`, `QC_STATUSES`, `export_json(outdir: Path) -> list[Path]`
  - `tables.build_table(records: list[dict], schema: pa.Schema) -> pa.Table`, `tables.write_table(table: pa.Table, path: Path) -> None`
  - CLI `amrtools schema --export DIR`

- [ ] **Step 1: Bump version and dependencies**

`pyproject.toml`: `version = "0.2.0"` and
```toml
dependencies = ["pandas>=2.2", "pyarrow>=25", "pycountry>=26"]
```
`nextflow.config`: manifest `version = '0.2.0'`, `amrtools_container = 'ghcr.io/simomounir/amrtools:0.2.0'`.
`.github/workflows/ci.yml`: `AMRTOOLS_IMAGE: ghcr.io/simomounir/amrtools:0.2.0`.
`tests/python/test_package.py`: expect `"0.2.0"`.

Run: `.venv/bin/pip install -q -e ".[dev,pipeline]" && .venv/bin/pytest -q`
Expected: all pass (47).

- [ ] **Step 2: Write the failing tests** `tests/python/test_schema.py`

```python
import json
from datetime import UTC, datetime
from pathlib import Path

import pyarrow.parquet as pq

from amrtools.columns import GENE_COLUMNS, SUMMARY_COLUMNS
from amrtools.schema import AMR_GENES, RUN_SUMMARY, SAMPLES, SCHEMA_VERSION, TABLES, export_json
from amrtools.tables import build_table, write_table

REPO = Path(__file__).resolve().parents[2]
RUN = ["run_id", "run_started_at"]


def test_gene_and_summary_tables_extend_phase1_columns():
    assert AMR_GENES.names == GENE_COLUMNS + RUN
    assert RUN_SUMMARY.names == SUMMARY_COLUMNS + RUN


def test_samples_table_columns():
    assert SAMPLES.names == [
        "sample", "sample_type", "organism", "run_accession", "sample_accession",
        "study_accession", "collection_date_raw", "collection_year", "collection_month",
        "collection_date_precision", "country", "region", "country_raw",
        "isolation_source_raw", "source_category", "host", "run_id", "run_started_at",
    ]  # fmt: skip


def test_every_field_has_a_description():
    for schema in TABLES.values():
        for field in schema:
            assert field.metadata and field.metadata[b"description"]


def test_committed_json_matches_schema(tmp_path):
    for generated in export_json(tmp_path):
        committed = REPO / "schemas" / generated.relative_to(tmp_path)
        assert json.loads(committed.read_text()) == json.loads(generated.read_text())


def test_write_table_records_version_and_types(tmp_path):
    record = {name: None for name in SAMPLES.names} | {
        "sample": "S1", "sample_type": "isolate", "organism": "Klebsiella_pneumoniae",
        "collection_year": 2014, "collection_month": 9, "collection_date_precision": "day",
        "source_category": "urine", "run_id": "r1",
        "run_started_at": datetime(2026, 10, 7, tzinfo=UTC),
    }  # fmt: skip
    path = tmp_path / "samples.parquet"
    write_table(build_table([record], SAMPLES), path)
    table = pq.read_table(path)
    assert table.schema.metadata[b"schema_version"] == SCHEMA_VERSION.encode()
    assert table.schema.equals(SAMPLES, check_metadata=False)
    assert table.column("collection_year").to_pylist() == [2014]
```

- [ ] **Step 3: Run to verify failure**

Run: `.venv/bin/pytest tests/python/test_schema.py -q`
Expected: ERROR `No module named 'amrtools.schema'`

- [ ] **Step 4: Implement** `src/amrtools/schema.py`

```python
"""Results schema v1: one definition for export, validation, build-dataset and the JSON docs."""

import json
from pathlib import Path

import pyarrow as pa

SCHEMA_VERSION = "1.0.0"
SCHEMA_MAJOR = 1

SOURCE_CATEGORIES = (
    "blood", "urine", "respiratory", "screening", "wound",
    "other_clinical", "environmental", "unknown",
)  # fmt: skip
DATE_PRECISIONS = ("day", "month", "year", "missing")
QC_STATUSES = ("pass", "warn")

TIMESTAMP = pa.timestamp("us", tz="UTC")


def _field(name: str, type_: pa.DataType, nullable: bool, description: str) -> pa.Field:
    return pa.field(name, type_, nullable=nullable, metadata={"description": description})


def _identity() -> list[pa.Field]:
    return [
        _field("sample", pa.string(), False, "Sample name from the samplesheet"),
        _field("sample_type", pa.string(), False, "isolate (metagenome in a later phase)"),
        _field(
            "organism", pa.string(), False, "AMRFinderPlus organism, e.g. Klebsiella_pneumoniae"
        ),
    ]


def _run() -> list[pa.Field]:
    return [
        _field("run_id", pa.string(), False, "Nextflow session id of the producing run"),
        _field("run_started_at", TIMESTAMP, False, "Start time of the producing run (UTC)"),
    ]


SAMPLES = pa.schema(
    _identity()
    + [
        _field("run_accession", pa.string(), True, "ENA/SRA run accession"),
        _field("sample_accession", pa.string(), True, "ENA/BioSample accession"),
        _field("study_accession", pa.string(), True, "ENA/BioProject accession"),
        _field("collection_date_raw", pa.string(), True, "Collection date as submitted"),
        _field("collection_year", pa.int16(), True, "Collection year"),
        _field("collection_month", pa.int8(), True, "Collection month 1-12"),
        _field("collection_date_precision", pa.string(), False, "day, month, year or missing"),
        _field("country", pa.string(), True, "Country (ISO 3166 common name)"),
        _field("region", pa.string(), True, "Text after the colon in the submitted country"),
        _field("country_raw", pa.string(), True, "Country as submitted"),
        _field("isolation_source_raw", pa.string(), True, "Isolation source as submitted"),
        _field("source_category", pa.string(), False, "Cleaned isolation source category"),
        _field("host", pa.string(), True, "Host organism"),
    ]
    + _run()
)

_GENE_TEXT = {
    "gene_symbol": "AMRFinderPlus element symbol",
    "element_name": "AMRFinderPlus element name",
    "element_type": "AMR, STRESS or VIRULENCE",
    "element_subtype": "AMR, POINT, STRESS, VIRULENCE, ...",
}

AMR_GENES = pa.schema(
    _identity()
    + [_field(name, pa.string(), False, text) for name, text in _GENE_TEXT.items()]
    + [
        _field("drug_class", pa.string(), True, "Drug class"),
        _field("drug_subclass", pa.string(), True, "Drug subclass"),
        _field("method", pa.string(), False, "AMRFinderPlus detection method"),
        _field("pct_identity", pa.float64(), False, "Percent identity to reference"),
        _field("pct_coverage", pa.float64(), False, "Percent coverage of reference"),
        _field("contig_id", pa.string(), True, "Contig carrying the element"),
        _field("amrfinder_version", pa.string(), False, "AMRFinderPlus software version"),
        _field("amrfinder_db_version", pa.string(), False, "AMRFinderPlus database version"),
    ]
    + _run()
)

RUN_SUMMARY = pa.schema(
    _identity()
    + [
        _field("kleborate_species", pa.string(), True, "Species called by Kleborate"),
        _field("st", pa.string(), True, "MLST sequence type, e.g. ST147"),
        _field("resistance_score", pa.int8(), True, "Kleborate resistance score"),
        _field("virulence_score", pa.int8(), True, "Kleborate virulence score"),
        _field("reads_after_qc", pa.int64(), False, "Reads kept by fastp"),
        _field("q30_rate", pa.float64(), False, "Fraction of bases >= Q30 after fastp"),
        _field("assembly_length", pa.int64(), False, "Total assembly length (bp)"),
        _field("n_contigs", pa.int32(), False, "Number of contigs"),
        _field("n50", pa.int64(), False, "Assembly N50 (bp)"),
        _field("n_amr_genes", pa.int32(), False, "AMR elements (genes and point mutations)"),
        _field("qc_status", pa.string(), False, "pass or warn"),
        _field("qc_reasons", pa.string(), False, "Failed QC checks joined by ';', empty if none"),
    ]
    + _run()
)

TABLES = {"samples": SAMPLES, "amr_genes": AMR_GENES, "run_summary": RUN_SUMMARY}

ALLOWED_VALUES = {
    "samples": {
        "source_category": SOURCE_CATEGORIES,
        "collection_date_precision": DATE_PRECISIONS,
    },
    "run_summary": {"qc_status": QC_STATUSES},
}


def _columns_json(schema: pa.Schema) -> list[dict]:
    return [
        {
            "name": field.name,
            "type": str(field.type),
            "nullable": field.nullable,
            "description": field.metadata[b"description"].decode(),
        }
        for field in schema
    ]


def export_json(outdir: Path) -> list[Path]:
    target = Path(outdir) / f"v{SCHEMA_VERSION}"
    target.mkdir(parents=True, exist_ok=True)
    paths = []
    for name, schema in TABLES.items():
        path = target / f"{name}.json"
        document = {
            "table": name,
            "schema_version": SCHEMA_VERSION,
            "columns": _columns_json(schema),
        }
        path.write_text(json.dumps(document, indent=2) + "\n")
        paths.append(path)
    return paths
```

`src/amrtools/tables.py`:
```python
"""Build Arrow tables from records and write them as versioned Parquet."""

from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from amrtools.schema import SCHEMA_VERSION


def build_table(records: list[dict], schema: pa.Schema) -> pa.Table:
    return pa.Table.from_pylist(records, schema=schema)


def write_table(table: pa.Table, path: Path) -> None:
    versioned = table.replace_schema_metadata({"schema_version": SCHEMA_VERSION})
    pq.write_table(versioned, path, compression="zstd")
```

- [ ] **Step 5: Add `schema` subcommand to `src/amrtools/cli.py`**

In `_parser()` before `return parser`:
```python
    schema = commands.add_parser("schema", help="export the results schema as JSON")
    schema.add_argument("--export", type=Path, required=True, dest="schema_dir")
```
Add runner and register it:
```python
def _run_schema(args: argparse.Namespace) -> None:
    for path in export_json(args.schema_dir):
        print(path)
```
Change the top of `main()` so only commands with `--outdir` create it, and register the new command:
```python
    args = _parser().parse_args(argv)
    if getattr(args, "outdir", None) is not None:
        args.outdir.mkdir(parents=True, exist_ok=True)
    commands = {
        "sample": _run_sample,
        "stub": _run_stub,
        "merge": _run_merge,
        "schema": _run_schema,
    }
```
Import: `from amrtools.schema import export_json`.

- [ ] **Step 6: Generate the committed JSON and run tests**

Run: `.venv/bin/amrtools schema --export schemas && .venv/bin/pytest -q`
Expected: three paths under `schemas/v1.0.0/` printed; all tests pass (52).

- [ ] **Step 7: Commit**

```bash
git add pyproject.toml nextflow.config .github/workflows/ci.yml src/amrtools tests/python schemas
git commit -m "feat(amrtools): results schema v1.0.0 and version 0.2.0"
```

---

### Task 2: Metadata cleaning

**Files:**
- Create: `src/amrtools/metadata.py`, `tests/python/test_metadata.py`

**Interfaces:**
- Produces: `is_missing(raw: str | None) -> bool`; `clean_date(raw) -> tuple[int | None, int | None, str]` (year, month, precision); `clean_country(raw) -> tuple[str | None, str | None]` (country, region); `categorize_source(raw) -> str`; `clean_host(raw) -> str | None`; `clean_text(raw) -> str | None` (trim; None if empty/None — raw values are NOT missing-token filtered)

- [ ] **Step 1: Write the failing tests** `tests/python/test_metadata.py`

```python
import pytest

from amrtools.metadata import (
    categorize_source,
    clean_country,
    clean_date,
    clean_host,
    clean_text,
    is_missing,
)


@pytest.mark.parametrize(
    "raw",
    ["", "  ", None, "not provided", "Not Collected", "missing", "unknown", "NA", "n/a",
     "not applicable", "none", "restricted access"],
)  # fmt: skip
def test_missing_tokens(raw):
    assert is_missing(raw)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("2014-09-28", (2014, 9, "day")),
        ("2019-03", (2019, 3, "month")),
        ("2018", (2018, None, "year")),
        (" 2018 ", (2018, None, "year")),
        ("2020-05-04T10:00:00Z", (2020, 5, "day")),
        ("not provided", (None, None, "missing")),
        ("", (None, None, "missing")),
        ("2017/2018", (None, None, "missing")),
        ("2019-02-30", (None, None, "missing")),
        ("2019-13", (None, None, "missing")),
        ("1850", (None, None, "missing")),
        ("March 2019", (None, None, "missing")),
    ],
)
def test_clean_date(raw, expected):
    assert clean_date(raw) == expected


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("USA: Houston", ("United States", "Houston")),
        ("USA:houston ", ("United States", "houston")),
        ("Germany:Bavaria", ("Germany", "Bavaria")),
        ("India", ("India", None)),
        (" germany ", ("Germany", None)),
        ("UK", ("United Kingdom", None)),
        ("Viet Nam", ("Vietnam", None)),
        ("South Korea", ("South Korea", None)),
        ("Czech Republic", ("Czechia", None)),
        ("Netherlands", ("Netherlands", None)),
        ("DEU", ("Germany", None)),
        ("Lisbon", (None, None)),
        ("Atlantis: North", (None, "North")),
        ("USA: missing", ("United States", None)),
        ("not provided", (None, None)),
        (None, (None, None)),
    ],
)
def test_clean_country(raw, expected):
    assert clean_country(raw) == expected


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("blood", "blood"),
        ("BLOOD culture", "blood"),
        ("urine", "urine"),
        ("Urinary tract", "urine"),
        ("sputum", "respiratory"),
        ("pneumonia", "respiratory"),
        ("bronchoalveolar lavage", "respiratory"),
        ("BAL fluid", "respiratory"),
        ("rectal swab", "screening"),
        ("stool", "screening"),
        ("Pus", "wound"),
        ("skin swab", "wound"),
        ("hospital sink drain", "environmental"),
        ("wastewater", "environmental"),
        ("clinical material", "other_clinical"),
        ("clinical", "other_clinical"),
        ("human", "other_clinical"),
        ("lisbon", "unknown"),
        ("Klebsiella pneumoniae microbiological culture", "unknown"),
        ("not provided", "unknown"),
        ("", "unknown"),
        (None, "unknown"),
    ],
)
def test_categorize_source(raw, expected):
    assert categorize_source(raw) == expected


def test_clean_host_and_text():
    assert clean_host(" Homo sapiens ") == "Homo sapiens"
    assert clean_host("not provided") is None
    assert clean_text(" not provided ") == "not provided"
    assert clean_text("  ") is None
    assert clean_text(None) is None
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest tests/python/test_metadata.py -q`
Expected: ERROR `No module named 'amrtools.metadata'`

- [ ] **Step 3: Implement** `src/amrtools/metadata.py`

```python
"""Clean messy public sample metadata (dates, countries, isolation sources, hosts)."""

import re
from datetime import date

import pycountry

MISSING_TOKENS = frozenset(
    {"", "not provided", "not collected", "missing", "unknown", "not applicable",
     "na", "n/a", "none", "restricted access"}
)  # fmt: skip

_DATE = re.compile(r"^(\d{4})(?:-(\d{2})(?:-(\d{2})(?:[T ].*)?)?)?$")

# Names pycountry does not resolve, mapped to ISO alpha-2 codes.
_COUNTRY_ALIASES = {
    "usa": "US", "u.s.a.": "US", "uk": "GB", "england": "GB", "scotland": "GB",
    "wales": "GB", "russia": "RU", "turkey": "TR", "democratic republic of the congo": "CD",
    "drc": "CD", "republic of the congo": "CG", "ivory coast": "CI", "laos": "LA",
    "syria": "SY", "bolivia": "BO", "venezuela": "VE", "taiwan": "TW", "hong kong": "HK",
    "macedonia": "MK", "swaziland": "SZ", "burma": "MM", "the netherlands": "NL",
    "south korea": "KR", "north korea": "KP", "iran": "IR", "czech republic": "CZ",
    "vietnam": "VN", "viet nam": "VN", "tanzania": "TZ", "moldova": "MD",
}  # fmt: skip

# First matching rule wins. Words match whole words; "bronch" is a prefix.
_SOURCE_RULES = [
    ("blood", ["blood", "bacteremia", "bacteraemia", "sepsis", "septicemia"]),
    ("urine", ["urine", "urinary", "uti"]),
    ("respiratory", ["sputum", r"bronch\w*", "bal", "tracheal", "respiratory", "pneumonia",
                     "lung", "throat", "nasal"]),
    ("screening", ["rectal", "stool", "feces", "faeces", "fecal", "faecal", "perianal",
                   "perirectal", "gut", "colonization", "colonisation", "screening"]),
    ("wound", ["wound", "pus", "abscess", "skin", "tissue", "ulcer"]),
    ("environmental", ["water", "wastewater", "sewage", "soil", "environment", "sink",
                       "drain", "surface"]),
    ("other_clinical", ["clinical", "hospital", "patient", "catheter", "cerebrospinal", "csf",
                        "swab", "aspirate", "fluid", "human"]),
]  # fmt: skip
_SOURCE_PATTERNS = [
    (category, re.compile(r"\b(?:" + "|".join(words) + r")\b")) for category, words in _SOURCE_RULES
]


def clean_text(raw: str | None) -> str | None:
    if raw is None:
        return None
    text = raw.strip()
    return text or None


def is_missing(raw: str | None) -> bool:
    return raw is None or raw.strip().lower() in MISSING_TOKENS


def clean_date(raw: str | None) -> tuple[int | None, int | None, str]:
    missing = (None, None, "missing")
    if is_missing(raw):
        return missing
    match = _DATE.match(raw.strip())
    if not match:
        return missing
    year = int(match[1])
    month = int(match[2]) if match[2] else None
    day = int(match[3]) if match[3] else None
    if not 1900 <= year <= 2100 or (month is not None and not 1 <= month <= 12):
        return missing
    if day is not None:
        try:
            date(year, month, day)
        except ValueError:
            return missing
        return year, month, "day"
    if month is not None:
        return year, month, "month"
    return year, None, "year"


def clean_country(raw: str | None) -> tuple[str | None, str | None]:
    if is_missing(raw):
        return None, None
    name, _, region_text = raw.partition(":")
    name = name.strip()
    region = None if is_missing(region_text) else region_text.strip()
    try:
        alias = _COUNTRY_ALIASES.get(name.lower())
        found = (
            pycountry.countries.get(alpha_2=alias) if alias else pycountry.countries.lookup(name)
        )
    except LookupError:
        return None, region
    return getattr(found, "common_name", None) or found.name, region


def categorize_source(raw: str | None) -> str:
    if is_missing(raw):
        return "unknown"
    text = raw.lower()
    for category, pattern in _SOURCE_PATTERNS:
        if pattern.search(text):
            return category
    return "unknown"


def clean_host(raw: str | None) -> str | None:
    return None if is_missing(raw) else raw.strip()
```

- [ ] **Step 4: Run to verify pass**

Run: `.venv/bin/pytest tests/python/test_metadata.py -q`
Expected: all pass (≈70 parametrised cases). If a pycountry name differs from the expected string, check `pycountry.countries.get(alpha_2=...)` and fix the alias, not the test.

- [ ] **Step 5: Commit**

```bash
git add src/amrtools/metadata.py tests/python/test_metadata.py
git commit -m "feat(amrtools): clean dates, countries, isolation sources and hosts"
```

---

### Task 3: ENA client and `fetch-samples`

**Files:**
- Create: `src/amrtools/ena.py`, `tests/python/test_ena.py`
- Fixtures (already recorded on this branch): `tests/python/fixtures/ena/{SRR5386028,ERR14097885,SRR33580217,PRJNA1001661,ERR10317397,ERR10176148,SRR99999999}.tsv`
- Modify: `src/amrtools/cli.py`

**Interfaces:**
- Consumes: `InputFormatError`
- Produces:
  - `EnaError(InputFormatError)`; `ENA_FIELDS: tuple[str, ...]`; `SAMPLESHEET_COLUMNS: list[str]` = `sample, fastq_1, fastq_2, sample_type, organism, run_accession, sample_accession, study_accession, collection_date, country, isolation_source, host`
  - `filereport_url(accession: str) -> str`
  - `http_get(url: str, *, opener=urllib.request.urlopen, sleep=time.sleep, attempts: int = 5) -> str`
  - `fetch_runs(accession: str, get=http_get) -> list[dict[str, str]]`
  - `fetch_samples(accessions: list[str], organism: str, get=http_get) -> tuple[list[dict], list[dict]]` (rows, skipped; skipped rows have `run_accession, reason`)
  - `write_csv(rows: list[dict], columns: list[str], path: Path) -> None`
  - CLI `amrtools fetch-samples [ACCESSION ...] [--accession-file FILE] --organism NAME --out CSV` (writes CSV and `<out stem>.skipped.csv`)

- [ ] **Step 1: Write the failing tests** `tests/python/test_ena.py`

```python
import csv
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
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest tests/python/test_ena.py -q`
Expected: ERROR `No module named 'amrtools.ena'`

- [ ] **Step 3: Implement** `src/amrtools/ena.py`

```python
"""Build samplesheets from ENA accessions (runs, samples or studies)."""

import csv
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
            if exc.code < 500:
                raise EnaError(f"ENA rejected request ({exc.code}): {url}") from exc
            error = exc
        except (urllib.error.URLError, TimeoutError) as exc:
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
    return [f for f in files if f.endswith("_1.fastq.gz")], [
        f for f in files if f.endswith("_2.fastq.gz")
    ]


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
```

- [ ] **Step 4: Add `fetch-samples` to `src/amrtools/cli.py`**

Imports: `from amrtools.ena import SAMPLESHEET_COLUMNS, fetch_samples, http_get, write_csv`.
Parser:
```python
    fetch = commands.add_parser("fetch-samples", help="build a samplesheet from ENA accessions")
    fetch.add_argument("accessions", nargs="*")
    fetch.add_argument("--accession-file", type=Path)
    fetch.add_argument("--organism", required=True)
    fetch.add_argument("--out", type=Path, required=True)
```
Runner (register as `"fetch-samples": _run_fetch_samples`):
```python
def _run_fetch_samples(args: argparse.Namespace) -> None:
    accessions = list(args.accessions)
    if args.accession_file:
        accessions += [line.strip() for line in args.accession_file.read_text().splitlines()
                       if line.strip()]  # fmt: skip
    if not accessions:
        raise InputFormatError("fetch-samples: give accessions or --accession-file")
    rows, skipped = fetch_samples(accessions, args.organism, get=http_get)
    write_csv(rows, SAMPLESHEET_COLUMNS, args.out)
    write_csv(skipped, ["run_accession", "reason"], args.out.with_suffix(".skipped.csv"))
    print(f"{len(rows)} runs written to {args.out}; {len(skipped)} skipped", file=sys.stderr)
```
(`fetch_samples(..., get=http_get)` looks `http_get` up at call time from the `cli` module, which is what the test monkeypatches.)

- [ ] **Step 5: Run to verify pass**

Run: `.venv/bin/pytest -q`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/amrtools/ena.py src/amrtools/cli.py tests/python/test_ena.py tests/python/fixtures/ena
git commit -m "feat(amrtools): fetch-samples builds samplesheets from ENA accessions"
```

---

### Task 4: Dataset validation

**Files:**
- Create: `src/amrtools/validate.py`, `tests/python/test_validate.py`, `tests/python/dataset_helpers.py`
- Modify: `src/amrtools/cli.py`

**Interfaces:**
- Consumes: `TABLES`, `ALLOWED_VALUES`, `SCHEMA_MAJOR`, `build_table`, `write_table`
- Produces:
  - `DatasetError(InputFormatError)`
  - `validate_dir(directory: Path) -> dict[str, pa.Table]`
  - `sha256(path: Path) -> str`
  - test helpers `dataset_helpers.sample_record(sample, run_id="r1", started=T1, **overrides)`, `summary_record(...)`, `gene_record(...)`, `write_run(directory, samples, genes, summaries) -> Path`, constants `T1`, `T2`
  - CLI `amrtools validate DIR`

- [ ] **Step 1: Write the test helpers** `tests/python/dataset_helpers.py`

```python
"""Small valid records for building Parquet test datasets."""

from datetime import UTC, datetime
from pathlib import Path

from amrtools.schema import AMR_GENES, RUN_SUMMARY, SAMPLES
from amrtools.tables import build_table, write_table

T1 = datetime(2026, 10, 1, tzinfo=UTC)
T2 = datetime(2026, 10, 7, tzinfo=UTC)
KP = "Klebsiella_pneumoniae"


def _base(sample, run_id, started):
    return {"sample": sample, "sample_type": "isolate", "organism": KP,
            "run_id": run_id, "run_started_at": started}  # fmt: skip


def sample_record(sample, run_id="r1", started=T1, **overrides):
    record = dict.fromkeys(SAMPLES.names) | _base(sample, run_id, started)
    record |= {"collection_date_precision": "missing", "source_category": "unknown"}
    return record | overrides


def summary_record(sample, run_id="r1", started=T1, **overrides):
    record = dict.fromkeys(RUN_SUMMARY.names) | _base(sample, run_id, started)
    record |= {"kleborate_species": "Klebsiella pneumoniae", "st": "ST147",
               "resistance_score": 2, "virulence_score": 1, "reads_after_qc": 1000,
               "q30_rate": 0.9, "assembly_length": 5_500_000, "n_contigs": 100,
               "n50": 100_000, "n_amr_genes": 1, "qc_status": "pass", "qc_reasons": ""}  # fmt: skip
    return record | overrides


def gene_record(sample, run_id="r1", started=T1, **overrides):
    record = dict.fromkeys(AMR_GENES.names) | _base(sample, run_id, started)
    record |= {"gene_symbol": "blaKPC-2", "element_name": "KPC-2", "element_type": "AMR",
               "element_subtype": "AMR", "drug_class": "BETA-LACTAM",
               "drug_subclass": "CARBAPENEM", "method": "ALLELEX", "pct_identity": 100.0,
               "pct_coverage": 100.0, "contig_id": "contig_1", "amrfinder_version": "4.2.7",
               "amrfinder_db_version": "2026-09-30.1"}  # fmt: skip
    return record | overrides


def write_run(directory: Path, samples, genes, summaries) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    for name, schema, records in (
        ("samples", SAMPLES, samples),
        ("amr_genes", AMR_GENES, genes),
        ("run_summary", RUN_SUMMARY, summaries),
    ):
        write_table(build_table(records, schema), directory / f"{name}.parquet")
    return directory
```

- [ ] **Step 2: Write the failing tests** `tests/python/test_validate.py`

```python
import json

import pyarrow as pa
import pyarrow.parquet as pq
import pytest
from dataset_helpers import gene_record, sample_record, summary_record, write_run

from amrtools.cli import main
from amrtools.schema import RUN_SUMMARY, SAMPLES
from amrtools.validate import DatasetError, sha256, validate_dir


def good_run(tmp_path):
    return write_run(tmp_path / "run", [sample_record("S1"), sample_record("S2")],
                     [gene_record("S1")], [summary_record("S1"), summary_record("S2")])  # fmt: skip


def test_valid_run_passes(tmp_path):
    tables = validate_dir(good_run(tmp_path))
    assert tables["samples"].num_rows == 2


def test_missing_file(tmp_path):
    run = good_run(tmp_path)
    (run / "amr_genes.parquet").unlink()
    with pytest.raises(DatasetError, match="amr_genes.parquet: missing table file"):
        validate_dir(run)


def test_wrong_type(tmp_path):
    run = good_run(tmp_path)
    table = pq.read_table(run / "run_summary.parquet")
    index = table.schema.get_field_index("n_contigs")
    table = table.set_column(index, pa.field("n_contigs", pa.int64(), nullable=False),
                             table.column("n_contigs").cast(pa.int64()))  # fmt: skip
    pq.write_table(table, run / "run_summary.parquet")
    with pytest.raises(DatasetError, match="column 'n_contigs' has type int64, expected int32"):
        validate_dir(run)


def test_missing_column(tmp_path):
    run = good_run(tmp_path)
    table = pq.read_table(run / "samples.parquet").drop_columns(["host"])
    pq.write_table(table, run / "samples.parquet")
    with pytest.raises(DatasetError, match="missing: \\['host'\\]"):
        validate_dir(run)


def test_null_in_required_column(tmp_path):
    run = write_run(tmp_path / "run", [sample_record("S1", source_category=None)], [],
                    [summary_record("S1")])  # fmt: skip
    with pytest.raises(DatasetError, match="column 'source_category' has 1 null values"):
        validate_dir(run)


def test_missing_version_metadata(tmp_path):
    run = good_run(tmp_path)
    table = pq.read_table(run / "samples.parquet").replace_schema_metadata(None)
    pq.write_table(table, run / "samples.parquet")
    with pytest.raises(DatasetError, match="missing schema_version"):
        validate_dir(run)


def test_other_major_version_refused(tmp_path):
    run = good_run(tmp_path)
    table = pq.read_table(run / "samples.parquet").replace_schema_metadata(
        {"schema_version": "2.0.0"}
    )
    pq.write_table(table, run / "samples.parquet")
    with pytest.raises(DatasetError, match="schema major version 2, expected 1"):
        validate_dir(run)


def test_duplicate_sample(tmp_path):
    run = write_run(tmp_path / "run", [sample_record("S1"), sample_record("S1")], [],
                    [summary_record("S1")])  # fmt: skip
    with pytest.raises(DatasetError, match="samples.parquet: duplicate sample 'S1'"):
        validate_dir(run)


def test_orphan_gene_row(tmp_path):
    run = write_run(tmp_path / "run", [sample_record("S1")], [gene_record("S9")],
                    [summary_record("S1")])  # fmt: skip
    with pytest.raises(DatasetError, match="amr_genes.parquet: sample 'S9' not in samples"):
        validate_dir(run)


def test_bad_category(tmp_path):
    run = write_run(tmp_path / "run", [sample_record("S1", source_category="tears")], [],
                    [summary_record("S1")])  # fmt: skip
    with pytest.raises(DatasetError, match="column 'source_category' has unexpected value 'tears'"):
        validate_dir(run)


def test_manifest_checksum_mismatch(tmp_path):
    run = good_run(tmp_path)
    tables = {name: {"file": f"{name}.parquet", "rows": 0, "sha256": "0" * 64}
              for name in ("samples", "amr_genes", "run_summary")}  # fmt: skip
    (run / "manifest.json").write_text(json.dumps({"tables": tables}))
    with pytest.raises(DatasetError, match="checksum does not match manifest"):
        validate_dir(run)


def test_manifest_matching_passes(tmp_path):
    run = good_run(tmp_path)
    tables = {}
    for name in ("samples", "amr_genes", "run_summary"):
        path = run / f"{name}.parquet"
        tables[name] = {"file": path.name, "rows": pq.read_table(path).num_rows,
                        "sha256": sha256(path)}  # fmt: skip
    (run / "manifest.json").write_text(json.dumps({"tables": tables}))
    validate_dir(run)


def test_cli_validate(tmp_path, capsys):
    run = good_run(tmp_path)
    assert main(["validate", str(run)]) == 0
    (run / "samples.parquet").unlink()
    assert main(["validate", str(run)]) == 1
    assert "missing table file" in capsys.readouterr().err


def test_schemas_used_by_helpers_are_current():
    assert SAMPLES.names[0] == RUN_SUMMARY.names[0] == "sample"
```

- [ ] **Step 3: Run to verify failure**

Run: `.venv/bin/pytest tests/python/test_validate.py -q`
Expected: ERROR `No module named 'amrtools.validate'`

- [ ] **Step 4: Implement** `src/amrtools/validate.py`

```python
"""Check Parquet result folders against the results schema."""

import hashlib
import json
from collections import Counter
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from amrtools.errors import InputFormatError
from amrtools.schema import ALLOWED_VALUES, SCHEMA_MAJOR, TABLES


class DatasetError(InputFormatError):
    """A results table or dataset does not match the schema."""


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def _check_schema(path: Path, name: str, table: pa.Table, schema: pa.Schema) -> None:
    version = (table.schema.metadata or {}).get(b"schema_version")
    if version is None:
        raise DatasetError(f"{path}: missing schema_version metadata")
    major = int(version.decode().split(".")[0])
    if major != SCHEMA_MAJOR:
        raise DatasetError(f"{path}: schema major version {major}, expected {SCHEMA_MAJOR}")
    if table.schema.names != schema.names:
        missing = [c for c in schema.names if c not in table.schema.names]
        extra = [c for c in table.schema.names if c not in schema.names]
        raise DatasetError(
            f"{path}: columns differ from schema (missing: {missing}, unexpected: {extra})"
        )
    for field in schema:
        column = table.column(field.name)
        if column.type != field.type:
            raise DatasetError(
                f"{path}: column '{field.name}' has type {column.type}, expected {field.type}"
            )
        if not field.nullable and column.null_count:
            raise DatasetError(f"{path}: column '{field.name}' has {column.null_count} null values")
    for column_name, allowed in ALLOWED_VALUES.get(name, {}).items():
        unexpected = sorted(set(table.column(column_name).to_pylist()) - set(allowed) - {None})
        if unexpected:
            raise DatasetError(
                f"{path}: column '{column_name}' has unexpected value '{unexpected[0]}'"
            )


def _check_keys(directory: Path, tables: dict[str, pa.Table]) -> None:
    for name in ("samples", "run_summary"):
        counts = Counter(tables[name].column("sample").to_pylist())
        duplicate = next((s for s, n in counts.items() if n > 1), None)
        if duplicate is not None:
            raise DatasetError(f"{directory / f'{name}.parquet'}: duplicate sample '{duplicate}'")
    known = set(tables["samples"].column("sample").to_pylist())
    for name in ("amr_genes", "run_summary"):
        orphan = next(
            (s for s in tables[name].column("sample").to_pylist() if s not in known), None
        )
        if orphan is not None:
            raise DatasetError(f"{directory / f'{name}.parquet'}: sample '{orphan}' not in samples")


def _check_manifest(directory: Path, tables: dict[str, pa.Table]) -> None:
    manifest = json.loads((directory / "manifest.json").read_text())
    for name, entry in manifest["tables"].items():
        path = directory / entry["file"]
        if sha256(path) != entry["sha256"]:
            raise DatasetError(f"{path}: checksum does not match manifest")
        if tables[name].num_rows != entry["rows"]:
            raise DatasetError(
                f"{path}: {tables[name].num_rows} rows, manifest says {entry['rows']}"
            )


def validate_dir(directory: Path) -> dict[str, pa.Table]:
    directory = Path(directory)
    tables = {}
    for name, schema in TABLES.items():
        path = directory / f"{name}.parquet"
        if not path.exists():
            raise DatasetError(f"{path}: missing table file")
        tables[name] = pq.read_table(path)
        _check_schema(path, name, tables[name], schema)
    _check_keys(directory, tables)
    if (directory / "manifest.json").exists():
        _check_manifest(directory, tables)
    return tables
```

- [ ] **Step 5: Add `validate` to `src/amrtools/cli.py`**

```python
    validate = commands.add_parser("validate", help="check Parquet results against the schema")
    validate.add_argument("directory", type=Path)
```
```python
def _run_validate(args: argparse.Namespace) -> None:
    tables = validate_dir(args.directory)
    counts = ", ".join(f"{name} {table.num_rows}" for name, table in tables.items())
    print(f"{args.directory}: valid ({counts})", file=sys.stderr)
```
Register `"validate": _run_validate`; import `from amrtools.validate import validate_dir`.

- [ ] **Step 6: Run to verify pass**

Run: `.venv/bin/pytest -q`
Expected: all pass. If `test_wrong_type`'s `set_column` call shape fails on this pyarrow version, build the replacement with `table.drop_columns(["n_contigs"]).append_column(...)` and then reorder with `table.select(RUN_SUMMARY.names)`; the assertion must stay the same.

- [ ] **Step 7: Commit**

```bash
git add src/amrtools/validate.py src/amrtools/cli.py tests/python/test_validate.py tests/python/dataset_helpers.py
git commit -m "feat(amrtools): validate Parquet results against the schema"
```

---

### Task 5: Export (samplesheet + TSVs → Parquet)

**Files:**
- Create: `src/amrtools/export.py`, `tests/python/test_export.py`
- Modify: `src/amrtools/cli.py` (`export` subcommand; `stub` placeholder values)

**Interfaces:**
- Consumes: metadata cleaners (Task 2), `TABLES`, `build_table`, `write_table`, `validate_dir`, `write_csv` (Task 3)
- Produces:
  - `parse_started_at(text: str) -> datetime` (UTC; error if no timezone)
  - `export_run(*, samplesheet: Path, genes_tsv: Path, summary_tsv: Path, run_id: str, run_started_at: str, outdir: Path, samples_tsv: Path | None = None) -> dict[str, pa.Table]`
  - CLI `amrtools export --samplesheet CSV --genes TSV --summary TSV --run-id ID --run-started-at ISO --outdir DIR [--samples-tsv PATH]`
  - `amrtools stub` now writes typed placeholders: numeric QC columns `0`, `qc_status` `warn`, `qc_reasons` `stub`, Kleborate columns `NA`

- [ ] **Step 1: Write the failing tests** `tests/python/test_export.py`

```python
import csv
from datetime import UTC, datetime
from pathlib import Path

import pytest

from amrtools.cli import main
from amrtools.errors import InputFormatError
from amrtools.export import export_run, parse_started_at

STARTED = "2026-10-07T08:15:30.123Z"
REPO = Path(__file__).resolve().parents[2]


def write_tsv(path, header, rows):
    path.write_text("\n".join("\t".join(r) for r in [header, *rows]) + "\n")
    return path


def merged_tables(tmp_path, samples):
    from amrtools.columns import GENE_COLUMNS, SUMMARY_COLUMNS

    genes = write_tsv(tmp_path / "amr_genes.tsv", GENE_COLUMNS, [
        [samples[0], "isolate", "Klebsiella_pneumoniae", "blaKPC-2", "KPC-2", "AMR", "AMR",
         "BETA-LACTAM", "CARBAPENEM", "ALLELEX", "100.0", "100.0", "contig_1", "4.2.7",
         "2026-09-30.1"],
        [samples[0], "isolate", "Klebsiella_pneumoniae", "iutA", "iutA", "VIRULENCE",
         "VIRULENCE", "NA", "NA", "BLASTX", "99.1", "100.0", "contig_2", "4.2.7",
         "2026-09-30.1"],
    ])  # fmt: skip
    summaries = [
        [s, "isolate", "Klebsiella_pneumoniae", "Klebsiella pneumoniae", "ST13", "3", "2",
         "1174982", "0.875", "5725147", "541", "94215", "24", "warn", "n_contigs"]
        for s in samples
    ]  # fmt: skip
    summary = write_tsv(tmp_path / "run_summary.tsv", SUMMARY_COLUMNS, summaries)
    return genes, summary


def run_export(tmp_path, samplesheet, samples):
    genes, summary = merged_tables(tmp_path, samples)
    return export_run(samplesheet=samplesheet, genes_tsv=genes, summary_tsv=summary,
                      run_id="session-1", run_started_at=STARTED, outdir=tmp_path / "parquet",
                      samples_tsv=tmp_path / "samples.tsv")  # fmt: skip


def test_metadata_is_cleaned_into_samples_table(tmp_path):
    sheet = tmp_path / "sheet.csv"
    sheet.write_text(
        "sample,fastq_1,fastq_2,sample_type,organism,run_accession,sample_accession,"
        "study_accession,collection_date,country,isolation_source,host\n"
        "SRR5386028,a_1.fastq.gz,a_2.fastq.gz,isolate,Klebsiella_pneumoniae,SRR5386028,"
        "SAMN06438663,PRJNA376414,2014-09-28,USA: Houston,urine,Homo sapiens\n"
    )
    tables = run_export(tmp_path, sheet, ["SRR5386028"])
    (row,) = tables["samples"].to_pylist()
    assert row["country"] == "United States"
    assert row["region"] == "Houston"
    assert row["collection_year"] == 2014
    assert row["collection_month"] == 9
    assert row["source_category"] == "urine"
    assert row["country_raw"] == "USA: Houston"
    assert row["run_started_at"] == datetime(2026, 10, 7, 8, 15, 30, 123000, tzinfo=UTC)
    assert (tmp_path / "parquet" / "samples.parquet").exists()


def test_samplesheet_without_metadata_columns(tmp_path):
    sheet = tmp_path / "sheet.csv"
    sheet.write_text("sample,fastq_1,fastq_2,sample_type,organism\n"
                     "S1,a_1.fastq.gz,a_2.fastq.gz,isolate,Klebsiella_pneumoniae\n")  # fmt: skip
    (row,) = run_export(tmp_path, sheet, ["S1"])["samples"].to_pylist()
    assert row["collection_date_precision"] == "missing"
    assert row["source_category"] == "unknown"
    assert row["country"] is None


def test_typed_gene_and_summary_tables(tmp_path):
    sheet = tmp_path / "sheet.csv"
    sheet.write_text("sample,fastq_1,fastq_2,sample_type,organism\n"
                     "S1,a_1.fastq.gz,a_2.fastq.gz,isolate,Klebsiella_pneumoniae\n")  # fmt: skip
    tables = run_export(tmp_path, sheet, ["S1"])
    genes = tables["amr_genes"].to_pylist()
    assert genes[0]["pct_identity"] == 100.0
    assert genes[1]["drug_class"] is None  # "NA" becomes null
    (summary,) = tables["run_summary"].to_pylist()
    assert summary["n_contigs"] == 541
    assert summary["resistance_score"] == 3
    assert summary["qc_reasons"] == "n_contigs"


def test_samples_tsv_is_written(tmp_path):
    sheet = tmp_path / "sheet.csv"
    sheet.write_text("sample,fastq_1,fastq_2,sample_type,organism\n"
                     "S1,a_1.fastq.gz,a_2.fastq.gz,isolate,Klebsiella_pneumoniae\n")  # fmt: skip
    run_export(tmp_path, sheet, ["S1"])
    with open(tmp_path / "samples.tsv", newline="") as handle:
        (row,) = list(csv.DictReader(handle, delimiter="\t"))
    assert row["sample"] == "S1"
    assert row["country"] == ""


def test_stub_tables_export_cleanly(tmp_path):
    out = tmp_path / "stub"
    assert main(["stub", "--sample", "S1", "--sample-type", "isolate",
                 "--organism", "Klebsiella_pneumoniae", "--outdir", str(out)]) == 0  # fmt: skip
    sheet = tmp_path / "sheet.csv"
    sheet.write_text("sample,fastq_1,fastq_2,sample_type,organism\n"
                     "S1,a_1.fastq.gz,a_2.fastq.gz,isolate,Klebsiella_pneumoniae\n")  # fmt: skip
    tables = export_run(samplesheet=sheet, genes_tsv=out / "S1.amr_genes.tsv",
                        summary_tsv=out / "S1.run_summary.tsv", run_id="stub",
                        run_started_at=STARTED, outdir=tmp_path / "parquet")  # fmt: skip
    (summary,) = tables["run_summary"].to_pylist()
    assert summary["kleborate_species"] is None
    assert summary["qc_status"] == "warn"


def test_timestamp_without_timezone_is_rejected():
    with pytest.raises(InputFormatError, match="needs a timezone"):
        parse_started_at("2026-10-07T08:15:30")
    assert parse_started_at("2026-10-07T10:15:30+02:00") == datetime(
        2026, 10, 7, 8, 15, 30, tzinfo=UTC
    )


def test_cli_export(tmp_path):
    sheet = tmp_path / "sheet.csv"
    sheet.write_text("sample,fastq_1,fastq_2,sample_type,organism\n"
                     "S1,a_1.fastq.gz,a_2.fastq.gz,isolate,Klebsiella_pneumoniae\n")  # fmt: skip
    genes, summary = merged_tables(tmp_path, ["S1"])
    assert main(["export", "--samplesheet", str(sheet), "--genes", str(genes),
                 "--summary", str(summary), "--run-id", "r1", "--run-started-at", STARTED,
                 "--outdir", str(tmp_path / "pq"), "--samples-tsv",
                 str(tmp_path / "s.tsv")]) == 0  # fmt: skip
    assert sorted(p.name for p in (tmp_path / "pq").iterdir()) == [
        "amr_genes.parquet", "run_summary.parquet", "samples.parquet"]  # fmt: skip
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest tests/python/test_export.py -q`
Expected: ERROR `No module named 'amrtools.export'`

- [ ] **Step 3: Implement** `src/amrtools/export.py`

```python
"""Turn one pipeline run (samplesheet + merged TSVs) into versioned Parquet tables."""

import csv
from datetime import UTC, datetime
from pathlib import Path

import pyarrow as pa

from amrtools.errors import InputFormatError
from amrtools.metadata import categorize_source, clean_country, clean_date, clean_host, clean_text
from amrtools.schema import AMR_GENES, RUN_SUMMARY, SAMPLES
from amrtools.tables import build_table, write_table
from amrtools.validate import validate_dir

_NA = ("", "NA")
_GENE_NULLABLE = ("drug_class", "drug_subclass", "contig_id")
_SUMMARY_INTS = ("reads_after_qc", "assembly_length", "n_contigs", "n50", "n_amr_genes")


def parse_started_at(text: str) -> datetime:
    started = datetime.fromisoformat(text)
    if started.tzinfo is None:
        raise InputFormatError(f"run start time '{text}' needs a timezone")
    return started.astimezone(UTC)


def _read(path: Path, delimiter: str) -> list[dict[str, str]]:
    with open(path, newline="") as handle:
        return list(csv.DictReader(handle, delimiter=delimiter))


def _null(value: str) -> str | None:
    return None if value in _NA else value


def _int_or_null(value: str) -> int | None:
    return None if value in _NA else int(value)


def _sample_records(rows, run) -> list[dict]:
    records = []
    for row in rows:
        year, month, precision = clean_date(row.get("collection_date"))
        country, region = clean_country(row.get("country"))
        records.append(
            {
                "sample": row["sample"],
                "sample_type": row["sample_type"],
                "organism": row["organism"],
                "run_accession": clean_text(row.get("run_accession")),
                "sample_accession": clean_text(row.get("sample_accession")),
                "study_accession": clean_text(row.get("study_accession")),
                "collection_date_raw": clean_text(row.get("collection_date")),
                "collection_year": year,
                "collection_month": month,
                "collection_date_precision": precision,
                "country": country,
                "region": region,
                "country_raw": clean_text(row.get("country")),
                "isolation_source_raw": clean_text(row.get("isolation_source")),
                "source_category": categorize_source(row.get("isolation_source")),
                "host": clean_host(row.get("host")),
            }
            | run
        )
    return records


def _gene_records(rows, run) -> list[dict]:
    records = []
    for row in rows:
        record = dict(row) | run
        record["pct_identity"] = float(row["pct_identity"])
        record["pct_coverage"] = float(row["pct_coverage"])
        for name in _GENE_NULLABLE:
            record[name] = _null(row[name])
        records.append(record)
    return records


def _summary_records(rows, run) -> list[dict]:
    records = []
    for row in rows:
        record = dict(row) | run
        record["kleborate_species"] = _null(row["kleborate_species"])
        record["st"] = _null(row["st"])
        record["resistance_score"] = _int_or_null(row["resistance_score"])
        record["virulence_score"] = _int_or_null(row["virulence_score"])
        record["q30_rate"] = float(row["q30_rate"])
        for name in _SUMMARY_INTS:
            record[name] = int(row[name])
        records.append(record)
    return records


def export_run(
    *,
    samplesheet: Path,
    genes_tsv: Path,
    summary_tsv: Path,
    run_id: str,
    run_started_at: str,
    outdir: Path,
    samples_tsv: Path | None = None,
) -> dict[str, pa.Table]:
    run = {"run_id": run_id, "run_started_at": parse_started_at(run_started_at)}
    try:
        tables = {
            "samples": build_table(_sample_records(_read(samplesheet, ","), run), SAMPLES),
            "amr_genes": build_table(_gene_records(_read(genes_tsv, "\t"), run), AMR_GENES),
            "run_summary": build_table(
                _summary_records(_read(summary_tsv, "\t"), run), RUN_SUMMARY
            ),
        }
    except (KeyError, ValueError) as exc:
        raise InputFormatError(f"cannot convert run tables to Parquet: {exc}") from exc
    outdir = Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    for name, table in tables.items():
        write_table(table, outdir / f"{name}.parquet")
    validate_dir(outdir)
    if samples_tsv is not None:
        _write_samples_tsv(tables["samples"], samples_tsv)
    return tables


def _write_samples_tsv(table: pa.Table, path: Path) -> None:
    with open(path, "w", newline="") as handle:
        writer = csv.writer(handle, delimiter="\t", lineterminator="\n")
        writer.writerow(table.schema.names)
        for row in table.to_pylist():
            writer.writerow("" if v is None else v for v in row.values())
```

Note: `pa.Table.from_pylist` raises `pa.ArrowInvalid`/`ArrowTypeError` (subclasses of `ValueError`/`TypeError`) on bad values; `TypeError` is not caught on purpose — it signals a programming error, not bad input.

- [ ] **Step 4: Update `amrtools stub` and add `export` in `src/amrtools/cli.py`**

Replace `_run_stub`'s `row` with typed placeholders:
```python
    row = dict.fromkeys(SUMMARY_COLUMNS, "NA") | {
        "sample": args.sample,
        "sample_type": args.sample_type,
        "organism": args.organism,
        "reads_after_qc": 0,
        "q30_rate": 0.0,
        "assembly_length": 0,
        "n_contigs": 0,
        "n50": 0,
        "n_amr_genes": 0,
        "qc_status": "warn",
        "qc_reasons": "stub",
    }
```
Parser:
```python
    export = commands.add_parser("export", help="write a run's results as Parquet")
    export.add_argument("--samplesheet", type=Path, required=True)
    export.add_argument("--genes", type=Path, required=True)
    export.add_argument("--summary", type=Path, required=True)
    export.add_argument("--run-id", required=True)
    export.add_argument("--run-started-at", required=True)
    export.add_argument("--outdir", type=Path, required=True)
    export.add_argument("--samples-tsv", type=Path)
```
Runner (register `"export": _run_export`; import `export_run`):
```python
def _run_export(args: argparse.Namespace) -> None:
    export_run(
        samplesheet=args.samplesheet,
        genes_tsv=args.genes,
        summary_tsv=args.summary,
        run_id=args.run_id,
        run_started_at=args.run_started_at,
        outdir=args.outdir,
        samples_tsv=args.samples_tsv,
    )
```

- [ ] **Step 5: Run to verify pass**

Run: `.venv/bin/pytest -q`
Expected: all pass, including the Phase 1 `test_stub_writes_placeholder_tables` (its first four summary fields are unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/amrtools/export.py src/amrtools/cli.py tests/python/test_export.py
git commit -m "feat(amrtools): export a run's results as validated Parquet"
```

---

### Task 6: `build-dataset`

**Files:**
- Create: `src/amrtools/dataset.py`, `tests/python/test_dataset.py`
- Modify: `src/amrtools/cli.py`

**Interfaces:**
- Consumes: `validate_dir`, `DatasetError`, `sha256`, `write_table`, `TABLES`, `SCHEMA_VERSION`, test helpers from Task 4
- Produces: `MAX_FILE_BYTES = 95 * 1024 * 1024`; `build_dataset(inputs: list[Path], out: Path) -> dict` (returns the manifest); CLI `amrtools build-dataset INPUT... --out DIR`

- [ ] **Step 1: Write the failing tests** `tests/python/test_dataset.py`

```python
import json

import pyarrow.parquet as pq
import pytest
from dataset_helpers import T1, T2, gene_record, sample_record, summary_record, write_run

import amrtools.dataset
from amrtools.cli import main
from amrtools.dataset import build_dataset
from amrtools.validate import DatasetError, validate_dir


def run1(tmp_path):
    return write_run(
        tmp_path / "run1",
        [sample_record("S1"), sample_record("S2")],
        [gene_record("S1"), gene_record("S2", gene_symbol="blaNDM-5")],
        [summary_record("S1"), summary_record("S2")],
    )


def run2(tmp_path):
    # Reruns S2 only, with a different result.
    return write_run(
        tmp_path / "run2",
        [sample_record("S2", run_id="r2", started=T2, host="Homo sapiens")],
        [gene_record("S2", run_id="r2", started=T2, gene_symbol="blaOXA-48")],
        [summary_record("S2", run_id="r2", started=T2, st="ST11")],
    )


def test_single_run_dataset_has_manifest_and_validates(tmp_path):
    manifest = build_dataset([run1(tmp_path)], tmp_path / "dataset")
    assert manifest["schema_version"] == "1.0.0"
    assert manifest["tables"]["samples"]["rows"] == 2
    assert manifest["runs"] == [{"run_id": "r1", "run_started_at": T1.isoformat(), "samples": 2}]
    validate_dir(tmp_path / "dataset")


def test_partial_rerun_keeps_older_samples(tmp_path):
    out = tmp_path / "dataset"
    build_dataset([run1(tmp_path), run2(tmp_path)], out)
    summary = {r["sample"]: r for r in pq.read_table(out / "run_summary.parquet").to_pylist()}
    assert summary["S1"]["run_id"] == "r1"
    assert summary["S2"]["run_id"] == "r2"
    assert summary["S2"]["st"] == "ST11"
    genes = pq.read_table(out / "amr_genes.parquet").to_pylist()
    assert sorted((g["sample"], g["gene_symbol"]) for g in genes) == [
        ("S1", "blaKPC-2"), ("S2", "blaOXA-48")]  # fmt: skip


def test_input_order_does_not_matter(tmp_path):
    out = tmp_path / "dataset"
    build_dataset([run2(tmp_path), run1(tmp_path)], out)
    summary = {r["sample"]: r for r in pq.read_table(out / "run_summary.parquet").to_pylist()}
    assert summary["S2"]["run_id"] == "r2"


def test_rebuild_replaces_previous_dataset(tmp_path):
    out = tmp_path / "dataset"
    build_dataset([run1(tmp_path)], out)
    build_dataset([run1(tmp_path), run2(tmp_path)], out)
    assert len(json.loads((out / "manifest.json").read_text())["runs"]) == 2
    assert not list(tmp_path.glob(".dataset.*"))


def test_invalid_input_leaves_previous_dataset_intact(tmp_path):
    out = tmp_path / "dataset"
    build_dataset([run1(tmp_path)], out)
    before = (out / "manifest.json").read_text()
    broken = run2(tmp_path)
    (broken / "samples.parquet").unlink()
    with pytest.raises(DatasetError):
        build_dataset([run1(tmp_path), broken], out)
    assert (out / "manifest.json").read_text() == before
    assert not list(tmp_path.glob(".dataset.*"))


def test_refuses_to_replace_non_dataset_folder(tmp_path):
    out = tmp_path / "important"
    out.mkdir()
    (out / "notes.txt").write_text("keep me")
    with pytest.raises(DatasetError, match="not a dataset"):
        build_dataset([run1(tmp_path)], out)
    assert (out / "notes.txt").read_text() == "keep me"


def test_file_size_limit(tmp_path, monkeypatch):
    monkeypatch.setattr(amrtools.dataset, "MAX_FILE_BYTES", 10)
    with pytest.raises(DatasetError, match="GitHub's limit is 100 MB"):
        build_dataset([run1(tmp_path)], tmp_path / "dataset")
    assert not (tmp_path / "dataset").exists()


def test_cli_build_dataset(tmp_path):
    out = tmp_path / "dataset"
    assert main(["build-dataset", str(run1(tmp_path)), str(run2(tmp_path)), "--out", str(out)]) == 0
    assert (out / "manifest.json").exists()
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest tests/python/test_dataset.py -q`
Expected: ERROR `No module named 'amrtools.dataset'`

- [ ] **Step 3: Implement** `src/amrtools/dataset.py`

```python
"""Combine per-run Parquet folders into one validated dataset with a manifest."""

import json
import shutil
import tempfile
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

import pyarrow as pa
import pyarrow.compute as pc

from amrtools.schema import SCHEMA_VERSION, TABLES
from amrtools.tables import write_table
from amrtools.validate import DatasetError, sha256, validate_dir

MAX_FILE_BYTES = 95 * 1024 * 1024


def _newest_run_per_sample(samples: pa.Table) -> dict[str, str]:
    newest: dict[str, tuple] = {}
    for row in samples.select(["sample", "run_id", "run_started_at"]).to_pylist():
        current = newest.get(row["sample"])
        if current is None or row["run_started_at"] > current[1]:
            newest[row["sample"]] = (row["run_id"], row["run_started_at"])
    return {sample: run_id for sample, (run_id, _) in newest.items()}


def _keep_winners(table: pa.Table, winners: dict[str, str]) -> pa.Table:
    mask = [winners.get(s) == r for s, r in zip(
        table.column("sample").to_pylist(), table.column("run_id").to_pylist(), strict=True)]  # fmt: skip
    kept = table.filter(pa.array(mask, type=pa.bool_()))
    return kept.take(pc.sort_indices(kept, sort_keys=[("sample", "ascending")]))


def _manifest(directory: Path, tables: dict[str, pa.Table]) -> dict:
    samples = tables["samples"]
    started = dict(zip(samples.column("run_id").to_pylist(),
                       samples.column("run_started_at").to_pylist(), strict=True))  # fmt: skip
    counts = Counter(samples.column("run_id").to_pylist())
    runs = sorted(
        ({"run_id": run_id, "run_started_at": started[run_id].isoformat(), "samples": n}
         for run_id, n in counts.items()),
        key=lambda run: run["run_started_at"],
    )  # fmt: skip
    return {
        "schema_version": SCHEMA_VERSION,
        "created_at": datetime.now(UTC).isoformat(),
        "runs": runs,
        "tables": {
            name: {"file": f"{name}.parquet", "rows": table.num_rows,
                   "sha256": sha256(directory / f"{name}.parquet")}
            for name, table in tables.items()
        },
    }  # fmt: skip


def build_dataset(inputs: list[Path], out: Path) -> dict:
    out = Path(out)
    if out.exists() and not (out / "manifest.json").exists():
        raise DatasetError(
            f"{out}: exists and is not a dataset (no manifest.json); not replacing it"
        )
    runs = [validate_dir(Path(directory)) for directory in inputs]
    combined = {name: pa.concat_tables([run[name] for run in runs]) for name in TABLES}
    winners = _newest_run_per_sample(combined["samples"])
    tables = {name: _keep_winners(table, winners) for name, table in combined.items()}

    out.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".{out.name}.", dir=out.parent))
    try:
        for name, table in tables.items():
            path = staging / f"{name}.parquet"
            write_table(table, path)
            if path.stat().st_size > MAX_FILE_BYTES:
                size = path.stat().st_size / 1024 / 1024
                raise DatasetError(f"{name}.parquet is {size:.1f} MB; GitHub's limit is 100 MB")
        manifest = _manifest(staging, tables)
        (staging / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
        validate_dir(staging)
        if out.exists():
            backup = out.with_name(f".{out.name}.previous")
            out.rename(backup)
            staging.rename(out)
            shutil.rmtree(backup)
        else:
            staging.rename(out)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    return manifest
```

Note: the `.{out.name}.previous` backup also starts with `.{out.name}.`; `test_rebuild_replaces_previous_dataset` asserts it is gone afterwards.

- [ ] **Step 4: Add `build-dataset` to `src/amrtools/cli.py`**

```python
    build = commands.add_parser("build-dataset", help="combine run folders into one dataset")
    build.add_argument("inputs", type=Path, nargs="+")
    build.add_argument("--out", type=Path, required=True)
```
```python
def _run_build_dataset(args: argparse.Namespace) -> None:
    manifest = build_dataset(args.inputs, args.out)
    rows = ", ".join(f"{name} {entry['rows']}" for name, entry in manifest["tables"].items())
    print(f"{args.out}: {len(manifest['runs'])} runs ({rows})", file=sys.stderr)
```
Register `"build-dataset": _run_build_dataset`; import `from amrtools.dataset import build_dataset`.

- [ ] **Step 5: Run to verify pass, lint, commit**

Run: `.venv/bin/pytest -q && .venv/bin/pre-commit run --all-files`
Expected: all pass.

```bash
git add src/amrtools/dataset.py src/amrtools/cli.py tests/python/test_dataset.py
git commit -m "feat(amrtools): build-dataset merges runs into a validated dataset"
```

---

### Task 7: Pipeline export step and test data metadata

**Files:**
- Create: `modules/local/amrtools/export/main.nf`
- Modify: `assets/schema_input.json`, `main.nf`, `workflows/isolate.nf`, `conf/modules.config`, `tests/data/samplesheet_test.csv`, `tests/nf-test/pipeline.nf.test`, `tests/python/test_ena.py` (fixture ↔ test samplesheet check)

**Interfaces:**
- Consumes: `amrtools export` CLI (Task 5), image `ghcr.io/simomounir/amrtools:0.2.0`
- Produces: `${outdir}/parquet/{samples,amr_genes,run_summary}.parquet`, `${outdir}/summary/samples.tsv`

- [ ] **Step 1: Write the failing tests**

Append to `tests/python/test_ena.py`:
```python
def test_test_samplesheet_metadata_matches_ena():
    sheet = Path(__file__).resolve().parents[2] / "tests" / "data" / "samplesheet_test.csv"
    with open(sheet, newline="") as handle:
        expected = {row["sample"]: row for row in csv.DictReader(handle)}
    rows, _ = fetch_samples(list(expected), KP, get=fixture_get)
    for row in rows:
        for column in ("sample_accession", "study_accession", "collection_date", "country",
                       "isolation_source", "host"):  # fmt: skip
            assert row[column] == expected[row["sample"]][column]
```

In `tests/nf-test/pipeline.nf.test`, stub test `then` block, add:
```groovy
            ['samples', 'amr_genes', 'run_summary'].each { table ->
                assert path("$outputDir/parquet/${table}.parquet").exists()
            }
            assert path("$outputDir/summary/samples.tsv").readLines().size() == 4
```
Full test `then` block, add after the `summary`/`genes` assertions:
```groovy
            def samples = readTsv(path("$outputDir/summary/samples.tsv")).collectEntries { [it.sample, it] }
            assert samples.SRR5386028.country == 'United States'
            assert samples.SRR5386028.region == 'Houston'
            assert samples.SRR5386028.collection_year == '2014'
            assert samples.SRR5386028.source_category == 'urine'
            assert samples.ERR14097885.source_category == 'wound'
            assert samples.SRR33580217.region == 'Bavaria'
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest tests/python/test_ena.py -q -k samplesheet_metadata`
Expected: FAIL with `KeyError: 'sample_accession'` (test samplesheet has no metadata yet).

- [ ] **Step 3: Add metadata columns to `tests/data/samplesheet_test.csv`**

```csv
sample,fastq_1,fastq_2,sample_type,organism,run_accession,sample_accession,study_accession,collection_date,country,isolation_source,host
SRR5386028,https://github.com/simomounir/amr-cloud-pipeline/releases/download/test-data-v2/SRR5386028_R1.fastq.gz,https://github.com/simomounir/amr-cloud-pipeline/releases/download/test-data-v2/SRR5386028_R2.fastq.gz,isolate,Klebsiella_pneumoniae,SRR5386028,SAMN06438663,PRJNA376414,2014-09-28,USA: Houston,urine,Homo sapiens
ERR14097885,https://github.com/simomounir/amr-cloud-pipeline/releases/download/test-data-v2/ERR14097885_R1.fastq.gz,https://github.com/simomounir/amr-cloud-pipeline/releases/download/test-data-v2/ERR14097885_R2.fastq.gz,isolate,Klebsiella_pneumoniae,ERR14097885,SAMEA117560408,PRJEB50614,2022,India,Pus,Homo sapiens
SRR33580217,https://github.com/simomounir/amr-cloud-pipeline/releases/download/test-data-v2/SRR33580217_R1.fastq.gz,https://github.com/simomounir/amr-cloud-pipeline/releases/download/test-data-v2/SRR33580217_R2.fastq.gz,isolate,Klebsiella_pneumoniae,SRR33580217,SAMN48516987,PRJNA1001661,2023,Germany:Bavaria,clinical,Homo sapiens
```
Run: `.venv/bin/pytest -q` → all pass.

- [ ] **Step 4: Optional samplesheet columns** in `assets/schema_input.json` `items.properties`, after `organism`:

```json
            "run_accession": {"type": "string"},
            "sample_accession": {"type": "string"},
            "study_accession": {"type": "string"},
            "collection_date": {"type": "string"},
            "country": {"type": "string"},
            "isolation_source": {"type": "string"},
            "host": {"type": "string"}
```
(`required` is unchanged.)

- [ ] **Step 5: `main.nf`** — samplesheetToList now returns the optional columns after `fastq_2`, so index rows instead of destructuring three values, and pass the samplesheet to the workflow. Replace the two `rows.collect { meta, fastq_1, fastq_2 -> ... }` closures and the `ISOLATE(...)` call:

```groovy
    def clashes = rows.collect { row -> row[0].id }
        .groupBy { id -> id.toLowerCase() }
        .findAll { key, ids -> ids.size() > 1 }
        .values()
```
```groovy
    def samples = rows.collect { row ->
        [row[0] + [single_end: false], [resolveFastq(row[1], samplesheetDir), resolveFastq(row[2], samplesheetDir)]]
    }

    ISOLATE(channel.fromList(samples), channel.value(file(params.input)))
```

- [ ] **Step 6: `modules/local/amrtools/export/main.nf`**

```groovy
process AMRTOOLS_EXPORT {
    label 'process_single'
    container "${params.amrtools_container}"

    input:
    path samplesheet
    path genes
    path summary

    output:
    path 'parquet/*.parquet', emit: parquet
    path 'samples.tsv', emit: samples_tsv

    script:
    """
    amrtools export \\
        --samplesheet ${samplesheet} \\
        --genes ${genes} \\
        --summary ${summary} \\
        --run-id '${workflow.sessionId}' \\
        --run-started-at '${workflow.start.toInstant()}' \\
        --outdir parquet \\
        --samples-tsv samples.tsv
    """
}
```
No stub block: stub runs export the stub tables for real.

- [ ] **Step 7: `workflows/isolate.nf`**

Add include: `include { AMRTOOLS_EXPORT } from '../modules/local/amrtools/export/main'`.
`take:` gets a second input:
```groovy
    take:
    ch_samples     // [meta, [fastq_1, fastq_2]]
    ch_samplesheet // value channel: the samplesheet file
```
After `AMRTOOLS_MERGE(...)`:
```groovy
    AMRTOOLS_EXPORT(ch_samplesheet, AMRTOOLS_MERGE.out.genes, AMRTOOLS_MERGE.out.summary)
```
`emit:` add `parquet = AMRTOOLS_EXPORT.out.parquet`.

- [ ] **Step 8: Publishing in `conf/modules.config`**

```groovy
    withName: 'AMRTOOLS_EXPORT' {
        publishDir = [
            [path: { "${params.outdir}/parquet" }, mode: 'copy', pattern: 'parquet/*.parquet', saveAs: { name -> name.tokenize('/').last() }],
            [path: { "${params.outdir}/summary" }, mode: 'copy', pattern: 'samples.tsv'],
        ]
    }
```

- [ ] **Step 9: Rebuild the image and run the pipeline tests**

```bash
export PATH="$HOME/.local/bin:$PATH" NXF_VER=26.04.6
docker build --platform linux/amd64 -f containers/amrtools/Dockerfile -t ghcr.io/simomounir/amrtools:0.2.0 .
nf-test test tests/ --tag stub,validation --profile test,docker
```
Expected: `SUCCESS: Executed 5 tests`.

Then the full test (long on the M1; run in background):
```bash
nf-test test tests/ --tag full --profile test,docker
```
Expected: `1 passed`.

- [ ] **Step 10: Commit**

```bash
git add assets/schema_input.json main.nf workflows/isolate.nf modules/local/amrtools/export conf/modules.config tests/data/samplesheet_test.csv tests/nf-test/pipeline.nf.test tests/python/test_ena.py
git commit -m "feat: export per-run Parquet results with cleaned sample metadata"
```

---

### Task 8: CI dataset artifact and README

**Files:**
- Modify: `.github/workflows/ci.yml`, `README.md`

**Interfaces:**
- Consumes: everything above

- [ ] **Step 1: CI full job** — after the `Full test on tiny dataset` step, add:

```yaml
      - name: Build dataset from the run
        run: |
          docker run --rm -v "$PWD:/work" -w /work "$AMRTOOLS_IMAGE" \
            amrtools build-dataset $(ls -d .nf-test/tests/*/output/parquet) --out dataset
```
Change the upload step's `path` to:
```yaml
          path: |
            .nf-test/tests/*/output/summary/
            dataset/
```

- [ ] **Step 2: README** — replace the "## Run it" section's first code block and add a results section:

````markdown
## Run it

Requirements: Docker, Java 17+, Nextflow ≥ 25.04, Python 3.12 (for `amrtools`).

```bash
pip install .                                   # provides the amrtools command
amrtools fetch-samples PRJNA376414 --organism Klebsiella_pneumoniae --out samples.csv
nextflow run . -profile docker --input samples.csv --outdir results
amrtools build-dataset results/parquet --out dataset
```

`fetch-samples` accepts run, sample or study accessions, keeps Illumina paired-end
runs and lists skipped runs in `samples.skipped.csv`. `nextflow run . -profile test,docker`
runs the tiny test dataset.
````

Add after the "What it does" table:
````markdown
## Results format

Each run writes versioned Parquet tables to `results/parquet/`; `build-dataset`
combines runs (newest run wins per sample) into `dataset/` with a `manifest.json`.

| Table | One row per | Highlights |
|---|---|---|
| `samples` | sample | ENA accessions, collection year/month, country, region, isolation source category, host (raw values kept) |
| `run_summary` | sample | species, ST, scores, QC |
| `amr_genes` | detected element | gene, drug class, identity, coverage |

Schema v1.0.0 is documented in [schemas/v1.0.0](schemas/v1.0.0). Check any folder with
`amrtools validate <dir>`.
````

- [ ] **Step 3: Lint and commit**

```bash
.venv/bin/pre-commit run --all-files
git add .github/workflows/ci.yml README.md
git commit -m "ci: build and upload the dataset artifact; document Phase 2"
```

- [ ] **Step 4: Ask the user before pushing**

Ask to push `phase2-schema`, open a PR to `main`, and run CI there. After CI is green and the user approves, merge; `publish-image` then publishes `amrtools:0.2.0`.
