# Phase 1 Isolate AMR Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Nextflow pipeline that turns Illumina reads from *K. pneumoniae* isolates into AMR gene calls, typing and QC tables, tested locally and in GitHub Actions.

**Architecture:** nf-core modules (fastp, Shovill, AMRFinderPlus) plus a local Kleborate v3 module run per sample; a Python package `amrtools` (own container) turns each sample's tool outputs into two tidy rows/tables, and a merge step writes run-level `amr_genes.tsv` and `run_summary.tsv`. CI runs pytest and a stub pipeline on every push, and a real tiny-dataset run on main.

**Tech Stack:** Nextflow 26.04.6 (DSL2), nf-schema 2.8.0, nf-core tools 4.1.0, nf-test 0.9.5, Docker, Python 3.12, pandas, pytest, ruff, pre-commit, gitleaks, GitHub Actions, GHCR.

**Spec:** `docs/superpowers/specs/2026-10-06-phase1-isolate-pipeline-design.md`

## Global Constraints

- Repo root is `/Users/simomounir/Claudelab/AMR`; GitHub repo `simomounir/amr-cloud-pipeline` (public).
- Container target platform: `linux/amd64` everywhere (Docker profile forces `--platform linux/amd64`).
- amrtools image name: `ghcr.io/simomounir/amrtools:0.1.0`.
- Pinned versions: Nextflow 26.04.6 (manifest floor `>=25.04.0`), nf-schema 2.8.0, nf-test 0.9.5, nf-core tools 4.1.0, Kleborate `quay.io/biocontainers/kleborate:3.2.4--pyhdfd78af_1`, AMRFinderPlus 4.2.7 (from nf-core module), seqtk `quay.io/biocontainers/seqtk:1.5--h577a1d6_1`, Python 3.12.
- Samplesheet columns exactly: `sample,fastq_1,fastq_2,sample_type,organism`; `organism` uses AMRFinderPlus names (`Klebsiella_pneumoniae`); `sample_type` is `isolate`.
- `amr_genes.tsv` columns exactly: `sample, sample_type, organism, gene_symbol, element_name, element_type, element_subtype, drug_class, drug_subclass, method, pct_identity, pct_coverage, contig_id, amrfinder_version, amrfinder_db_version`.
- `run_summary.tsv` columns exactly: `sample, sample_type, organism, kleborate_species, st, resistance_score, virulence_score, reads_after_qc, q30_rate, assembly_length, n_contigs, n50, n_amr_genes, qc_status, qc_reasons`.
- QC defaults: assembly length 5,000,000–6,500,000 inclusive; contigs < 500; Q30 > 0.80; species must equal organism with `_` → space. Failing samples get `qc_status=warn`, never dropped; reasons joined with `;`.
- Retry only on exit status 137/140, max 2 retries, memory scaled by attempt; anything else terminates.
- Never commit reads, AWS keys or `.env`. Test reads live only in GitHub Release `test-data-v1`.
- Do not create the GitHub repo, push, or publish a Release without the user's go-ahead in that session (outward-facing).

## Review Focus

1. **A sample that isn't *K. pneumoniae*** (mislabelled or contaminated): Kleborate writes no KpSC file. Expected: run completes, species/ST `NA`, `qc_status=warn` with `species_mismatch`. Pinned in Task 4 (`test_read_kleborate_empty_file_means_no_result`) and Task 6 (`test_kleborate_without_result_flags_species_mismatch`).
2. **A sample with zero AMR hits** (AMRFinderPlus writes header only): expected zero gene rows and `n_amr_genes = 0`, not an error. Pinned in Task 5 and Task 6.
3. **AMRFinderPlus header changes between versions** (v3 `Gene symbol` vs v4 `Element symbol`): identical output either way; an unknown layout fails naming file and column. Pinned in Task 5.
4. **Samplesheet with unsafe sample names or duplicates** (spaces, `;`, repeated IDs end up in shell commands and file names): expected rejection before any process runs. Pinned in Task 8 (`assets/schema_input.json` pattern + `uniqueEntries`, and the `bad samplesheet` nf-test).
5. **Samplesheet with relative FASTQ paths, run from another folder**: expected paths to resolve against the samplesheet's folder, not the launch folder. Pinned in Task 8 (stub test runs from nf-test's own launch dir with a relative-path samplesheet).

---

## File Structure

| File | Responsibility |
|---|---|
| `pyproject.toml` | amrtools package, dev deps, pytest and ruff config |
| `src/amrtools/__init__.py` | package version |
| `src/amrtools/errors.py` | `InputFormatError` |
| `src/amrtools/columns.py` | output column lists (future schema v0.1) |
| `src/amrtools/parsers/assembly.py` | contigs FASTA → length, count, N50 |
| `src/amrtools/parsers/fastp.py` | fastp JSON → reads after QC, Q30 |
| `src/amrtools/parsers/kleborate.py` | Kleborate v3 TSV → species, ST, scores |
| `src/amrtools/parsers/amrfinder.py` | AMRFinderPlus TSV (v3/v4) → our gene columns |
| `src/amrtools/qc.py` | thresholds and QC reasons |
| `src/amrtools/sample.py` | builds one sample's gene + summary tables |
| `src/amrtools/merge.py` | concatenates per-sample tables |
| `src/amrtools/cli.py` | `amrtools sample / merge / stub` |
| `containers/amrtools/Dockerfile` | amrtools image |
| `main.nf` | entry: validate params, read samplesheet |
| `workflows/isolate.nf` | wires the stages |
| `modules/local/kleborate/main.nf` | Kleborate v3 process |
| `modules/local/amrtools/{sample,merge}/main.nf` | amrtools processes |
| `modules/nf-core/...` | installed by nf-core tools, never edited |
| `nextflow.config`, `conf/*.config` | params, profiles, resources, publishing |
| `nextflow_schema.json`, `assets/schema_input.json` | param and samplesheet validation |
| `tests/python/` | pytest + `helpers.py` + `fixtures/` |
| `tests/nf-test/pipeline.nf.test` | stub, bad-input and full pipeline tests |
| `tests/data/` | samplesheets, stub FASTQs, `make_test_data.sh`, README |
| `.github/workflows/ci.yml` | lint, unit, stub, full, publish-image |

---

### Task 1: Repo scaffold and dev tooling

**Files:**
- Create: `.gitignore`, `.dockerignore`, `.pre-commit-config.yaml`, `pyproject.toml`, `README.md`, `src/amrtools/__init__.py`, `src/amrtools/parsers/__init__.py`, `schemas/README.md`, `infra/README.md`, `dashboard/README.md`, `tests/python/test_package.py`

**Interfaces:**
- Produces: importable package `amrtools` with `amrtools.__version__ == "0.1.0"`; `.venv` with dev deps; `pytest` discovers `tests/python`, and `tests/python` is on `sys.path` (so tests can `import helpers`).

- [ ] **Step 1: Install local tools**

```bash
cd /Users/simomounir/Claudelab/AMR
mkdir -p ~/.local/bin
curl -fsSL https://get.nextflow.io | bash && mv nextflow ~/.local/bin/
curl -fsSL https://get.nf-test.com | bash -s 0.9.5 && mv nf-test ~/.local/bin/
export PATH="$HOME/.local/bin:$PATH"; export NXF_VER=26.04.6
nextflow -version | grep -q 26.04.6 && nf-test version
```
Expected: Nextflow 26.04.6 banner and `nf-test 0.9.5`. If `~/.local/bin` is not on PATH in the user's shell profile, tell the user to add `export PATH="$HOME/.local/bin:$PATH"` and `export NXF_VER=26.04.6` to `~/.bash_profile` (do not edit it yourself).

Also ask the user to (a) update Docker Desktop and set its memory to at least 8 GB, (b) `brew install gh && gh auth login` before Task 9.

- [ ] **Step 2: Write `.gitignore`**

```gitignore
# Nextflow
work/
results/
.nextflow/
.nextflow.log*
.nf-test/
.nf-test.log

# Python
.venv/
__pycache__/
*.egg-info/
.pytest_cache/
.ruff_cache/

# Data (test reads live in the GitHub Release, not in git)
*.fastq.gz
*.fq.gz
!tests/data/stub/*.fastq.gz
test-data/
amrfinderdb/
amrfinderdb.tar.gz

# Secrets
.env
.env.*
*.pem
.aws/
credentials
```

- [ ] **Step 3: Write `.dockerignore`**

```
.git
.venv
.nf-test
.nextflow*
work
results
test-data
tests
```

- [ ] **Step 4: Write `pyproject.toml`**

```toml
[build-system]
requires = ["hatchling>=1.25"]
build-backend = "hatchling.build"

[project]
name = "amrtools"
version = "0.1.0"
description = "Parsers and summary tables for the AMR cloud pipeline"
readme = "README.md"
requires-python = ">=3.12"
dependencies = ["pandas>=2.2"]

[project.optional-dependencies]
dev = ["pytest>=8", "ruff>=0.16", "pre-commit>=4"]
pipeline = ["nf-core==4.1.0"]

[project.scripts]
amrtools = "amrtools.cli:main"

[tool.hatch.build.targets.wheel]
packages = ["src/amrtools"]

[tool.pytest.ini_options]
testpaths = ["tests/python"]
pythonpath = ["tests/python"]

[tool.ruff]
line-length = 100
target-version = "py312"

[tool.ruff.lint]
select = ["E", "F", "I", "B", "UP"]
```

- [ ] **Step 5: Write package stubs and placeholder READMEs**

`src/amrtools/__init__.py`:
```python
"""Parsers and summary tables for the AMR cloud pipeline."""

from importlib.metadata import version

__version__ = version("amrtools")
```

`src/amrtools/parsers/__init__.py`:
```python
"""One module per tool output format."""
```

`README.md`:
```markdown
# AMR Cloud Pipeline

Antimicrobial-resistance detection for bacterial isolates, built as a Nextflow
pipeline that runs locally and on AWS Batch. Work in progress (Phase 1).
```

`schemas/README.md`: `# Results schema\n\nVersioned Parquet schema arrives in Phase 2.\n`
`infra/README.md`: `# Infrastructure\n\nTerraform for AWS arrives in Phase 4.\n`
`dashboard/README.md`: `# Dashboard\n\nStatic DuckDB-WASM dashboard arrives in Phase 3.\n`

- [ ] **Step 6: Write the failing test** `tests/python/test_package.py`

```python
import amrtools


def test_package_version():
    assert amrtools.__version__ == "0.1.0"
```

- [ ] **Step 7: Run it to see it fail**

Run: `python3 -m pytest tests/python -q`
Expected: FAIL/ERROR (`ModuleNotFoundError: No module named 'amrtools'` or pytest missing).

- [ ] **Step 8: Create the venv and install**

```bash
python3 -m venv .venv
.venv/bin/pip install -e ".[dev,pipeline]"
```

- [ ] **Step 9: Run test to verify it passes**

Run: `.venv/bin/pytest -q`
Expected: `1 passed`

- [ ] **Step 10: Write `.pre-commit-config.yaml` and run it**

```yaml
exclude: ^(modules/nf-core/|tests/python/fixtures/|tests/data/stub/)
repos:
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v6.0.0
    hooks:
      - id: trailing-whitespace
      - id: end-of-file-fixer
      - id: check-yaml
      - id: check-json
      - id: check-added-large-files
        args: ["--maxkb=1000"]
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.16.10
    hooks:
      - id: ruff-check
        args: ["--fix"]
      - id: ruff-format
  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.30.1
    hooks:
      - id: gitleaks
```

Run: `.venv/bin/pre-commit install && .venv/bin/pre-commit run --all-files`
Expected: all hooks Passed (rerun once if a fixer modified files).

- [ ] **Step 11: Commit**

```bash
git add .gitignore .dockerignore .pre-commit-config.yaml pyproject.toml README.md src tests schemas infra dashboard
git commit -m "chore: scaffold repo, amrtools package and dev tooling"
```

---

### Task 2: Shared columns, errors and assembly parser

**Files:**
- Create: `src/amrtools/errors.py`, `src/amrtools/columns.py`, `src/amrtools/parsers/assembly.py`, `tests/python/helpers.py`, `tests/python/test_assembly.py`

**Interfaces:**
- Produces:
  - `amrtools.errors.InputFormatError(ValueError)`
  - `amrtools.columns.GENE_COLUMNS: list[str]`, `SUMMARY_COLUMNS: list[str]` (exact lists in Global Constraints)
  - `amrtools.parsers.assembly.AssemblyStats(total_length: int, n_contigs: int, n50: int)` (frozen dataclass)
  - `n50(lengths: list[int]) -> int`, `contig_lengths(path: Path) -> list[int]`, `read_assembly(path: Path) -> AssemblyStats`
  - `tests/python/helpers.py: write_contigs(path: Path, lengths: list[int]) -> Path`

- [ ] **Step 1: Write errors and columns (no behavior, used by tests)**

`src/amrtools/errors.py`:
```python
class InputFormatError(ValueError):
    """A tool output file is empty, malformed or missing an expected field."""
```

`src/amrtools/columns.py`:
```python
"""Output table layouts. These become results schema v0.1 in Phase 2."""

GENE_COLUMNS = [
    "sample",
    "sample_type",
    "organism",
    "gene_symbol",
    "element_name",
    "element_type",
    "element_subtype",
    "drug_class",
    "drug_subclass",
    "method",
    "pct_identity",
    "pct_coverage",
    "contig_id",
    "amrfinder_version",
    "amrfinder_db_version",
]

SUMMARY_COLUMNS = [
    "sample",
    "sample_type",
    "organism",
    "kleborate_species",
    "st",
    "resistance_score",
    "virulence_score",
    "reads_after_qc",
    "q30_rate",
    "assembly_length",
    "n_contigs",
    "n50",
    "n_amr_genes",
    "qc_status",
    "qc_reasons",
]
```

`tests/python/helpers.py`:
```python
"""Builders for small tool-output files used across tests."""

from pathlib import Path


def write_contigs(path: Path, lengths: list[int]) -> Path:
    path.write_text("".join(f">contig_{i}\n{'A' * n}\n" for i, n in enumerate(lengths, 1)))
    return path
```

- [ ] **Step 2: Write the failing tests** `tests/python/test_assembly.py`

```python
import pytest
from helpers import write_contigs

from amrtools.errors import InputFormatError
from amrtools.parsers.assembly import AssemblyStats, n50, read_assembly


def test_n50_picks_contig_that_reaches_half_the_assembly():
    assert n50([100, 200, 300, 400]) == 300


def test_n50_single_contig():
    assert n50([42]) == 42


def test_n50_of_empty_assembly_is_zero():
    assert n50([]) == 0


def test_read_assembly_handles_multiline_sequences(tmp_path):
    fasta = tmp_path / "contigs.fa"
    fasta.write_text(">c1 len=6\nACGT\nAC\n>c2\nACG\n>c3\nA\n")
    assert read_assembly(fasta) == AssemblyStats(total_length=10, n_contigs=3, n50=6)


def test_read_assembly_from_helper(tmp_path):
    fasta = write_contigs(tmp_path / "contigs.fa", [50, 30, 20])
    assert read_assembly(fasta) == AssemblyStats(total_length=100, n_contigs=3, n50=50)


def test_empty_fasta_gives_zero_stats(tmp_path):
    fasta = tmp_path / "contigs.fa"
    fasta.write_text("")
    assert read_assembly(fasta) == AssemblyStats(total_length=0, n_contigs=0, n50=0)


def test_sequence_before_first_header_is_rejected(tmp_path):
    fasta = tmp_path / "contigs.fa"
    fasta.write_text("ACGT\n>c1\nA\n")
    with pytest.raises(InputFormatError, match="sequence before first FASTA header"):
        read_assembly(fasta)
```

- [ ] **Step 3: Run to verify failure**

Run: `.venv/bin/pytest tests/python/test_assembly.py -q`
Expected: ERROR `ModuleNotFoundError: No module named 'amrtools.parsers.assembly'`

- [ ] **Step 4: Implement** `src/amrtools/parsers/assembly.py`

```python
"""Assembly statistics computed from a contigs FASTA."""

from dataclasses import dataclass
from pathlib import Path

from amrtools.errors import InputFormatError


@dataclass(frozen=True)
class AssemblyStats:
    total_length: int
    n_contigs: int
    n50: int


def n50(lengths: list[int]) -> int:
    """Smallest length L such that contigs of length >= L cover half the assembly."""
    total = sum(lengths)
    covered = 0
    for length in sorted(lengths, reverse=True):
        covered += length
        if covered * 2 >= total:
            return length
    return 0


def contig_lengths(path: Path) -> list[int]:
    lengths: list[int] = []
    with open(path) as handle:
        for raw in handle:
            line = raw.strip()
            if line.startswith(">"):
                lengths.append(0)
            elif line:
                if not lengths:
                    raise InputFormatError(f"{path}: sequence before first FASTA header")
                lengths[-1] += len(line)
    return lengths


def read_assembly(path: Path) -> AssemblyStats:
    lengths = contig_lengths(path)
    return AssemblyStats(total_length=sum(lengths), n_contigs=len(lengths), n50=n50(lengths))
```

- [ ] **Step 5: Run to verify pass**

Run: `.venv/bin/pytest tests/python/test_assembly.py -q`
Expected: `7 passed`

- [ ] **Step 6: Commit**

```bash
git add src/amrtools tests/python
git commit -m "feat(amrtools): add output columns and assembly statistics"
```

---

### Task 3: fastp parser

**Files:**
- Create: `src/amrtools/parsers/fastp.py`, `tests/python/test_fastp.py`
- Modify: `tests/python/helpers.py` (append `write_fastp`)

**Interfaces:**
- Consumes: `InputFormatError` (Task 2)
- Produces: `FastpStats(reads_after_qc: int, q30_rate: float)`; `read_fastp(path: Path) -> FastpStats`; helper `write_fastp(path: Path, total_reads: int = 1000, q30_rate: float = 0.912) -> Path`

- [ ] **Step 1: Append helper to `tests/python/helpers.py`**

```python
import json


def write_fastp(path: Path, total_reads: int = 1000, q30_rate: float = 0.912) -> Path:
    report = {
        "summary": {
            "fastp_version": "1.3.6",
            "before_filtering": {"total_reads": total_reads + 200, "q30_rate": 0.9},
            "after_filtering": {
                "total_reads": total_reads,
                "total_bases": total_reads * 150,
                "q20_rate": 0.97,
                "q30_rate": q30_rate,
            },
        }
    }
    path.write_text(json.dumps(report))
    return path
```
(Move `import json` to the top of the file next to `from pathlib import Path`.)

- [ ] **Step 2: Write the failing tests** `tests/python/test_fastp.py`

```python
import pytest
from helpers import write_fastp

from amrtools.errors import InputFormatError
from amrtools.parsers.fastp import FastpStats, read_fastp


def test_reads_after_filtering_values(tmp_path):
    report = write_fastp(tmp_path / "s.fastp.json", total_reads=1000, q30_rate=0.912)
    assert read_fastp(report) == FastpStats(reads_after_qc=1000, q30_rate=0.912)


def test_missing_after_filtering_is_rejected(tmp_path):
    report = tmp_path / "s.fastp.json"
    report.write_text('{"summary": {}}')
    with pytest.raises(InputFormatError, match="missing fastp field 'after_filtering'"):
        read_fastp(report)


def test_invalid_json_is_rejected(tmp_path):
    report = tmp_path / "s.fastp.json"
    report.write_text("")
    with pytest.raises(InputFormatError, match="not valid fastp JSON"):
        read_fastp(report)
```

- [ ] **Step 3: Run to verify failure**

Run: `.venv/bin/pytest tests/python/test_fastp.py -q`
Expected: ERROR `No module named 'amrtools.parsers.fastp'`

- [ ] **Step 4: Implement** `src/amrtools/parsers/fastp.py`

```python
"""Read-level QC metrics from a fastp JSON report."""

import json
from dataclasses import dataclass
from pathlib import Path

from amrtools.errors import InputFormatError


@dataclass(frozen=True)
class FastpStats:
    reads_after_qc: int
    q30_rate: float


def read_fastp(path: Path) -> FastpStats:
    try:
        report = json.loads(Path(path).read_text())
    except json.JSONDecodeError as exc:
        raise InputFormatError(f"{path}: not valid fastp JSON ({exc.msg})") from exc
    try:
        after = report["summary"]["after_filtering"]
        return FastpStats(reads_after_qc=int(after["total_reads"]), q30_rate=float(after["q30_rate"]))
    except KeyError as exc:
        raise InputFormatError(f"{path}: missing fastp field '{exc.args[0]}'") from exc
```

- [ ] **Step 5: Run to verify pass**

Run: `.venv/bin/pytest tests/python/test_fastp.py -q`
Expected: `3 passed`

- [ ] **Step 6: Commit**

```bash
git add src/amrtools/parsers/fastp.py tests/python
git commit -m "feat(amrtools): parse fastp QC report"
```

---

### Task 4: Kleborate parser

**Files:**
- Create: `src/amrtools/parsers/kleborate.py`, `tests/python/fixtures/kleborate_SRR5386028.tsv`, `tests/python/test_kleborate.py`

**Interfaces:**
- Consumes: `InputFormatError`
- Produces: `KleborateResult(species: str, st: str, resistance_score: str, virulence_score: str)`; `NO_RESULT` (all `"NA"`); `read_kleborate(path: Path) -> KleborateResult`; fixture `tests/python/fixtures/kleborate_SRR5386028.tsv` (real Kleborate 3 output, species `Klebsiella pneumoniae`, ST `ST13`, resistance `3`, virulence `2`)

- [ ] **Step 1: Fetch the real fixture (pinned commit)**

```bash
mkdir -p tests/python/fixtures
curl -sf https://raw.githubusercontent.com/klebgenomics/Kleborate/f5b116af671f5984c2773fdb01aa5c6b10d87401/test/kpsc_test/example_output/klebsiella_pneumo_complex_output.txt \
  | awk -F'\t' 'NR==1 || $1=="SRR5386028"' > tests/python/fixtures/kleborate_SRR5386028.tsv
wc -l tests/python/fixtures/kleborate_SRR5386028.tsv
```
Expected: `2 tests/python/fixtures/kleborate_SRR5386028.tsv`

- [ ] **Step 2: Write the failing tests** `tests/python/test_kleborate.py`

```python
from pathlib import Path

import pytest

from amrtools.errors import InputFormatError
from amrtools.parsers.kleborate import NO_RESULT, KleborateResult, read_kleborate

FIXTURE = Path(__file__).parent / "fixtures" / "kleborate_SRR5386028.tsv"


def test_reads_real_kleborate_v3_output():
    assert read_kleborate(FIXTURE) == KleborateResult(
        species="Klebsiella pneumoniae", st="ST13", resistance_score="3", virulence_score="2"
    )


def test_read_kleborate_empty_file_means_no_result(tmp_path):
    empty = tmp_path / "s.kleborate.tsv"
    empty.write_text("")
    assert read_kleborate(empty) == NO_RESULT


def test_output_without_st_column_gives_na(tmp_path):
    table = tmp_path / "s.kleborate.tsv"
    table.write_text("strain\tspecies\nx\tEscherichia coli\n")
    result = read_kleborate(table)
    assert result.species == "Escherichia coli"
    assert result.st == "NA"
    assert result.resistance_score == "NA"


def test_missing_species_column_is_rejected(tmp_path):
    table = tmp_path / "s.kleborate.tsv"
    table.write_text("strain\tST\nx\tST13\n")
    with pytest.raises(InputFormatError, match="missing Kleborate column 'species'"):
        read_kleborate(table)


def test_more_than_one_row_is_rejected(tmp_path):
    table = tmp_path / "s.kleborate.tsv"
    table.write_text("strain\tspecies\na\tKlebsiella pneumoniae\nb\tKlebsiella pneumoniae\n")
    with pytest.raises(InputFormatError, match="expected 1 Kleborate row, found 2"):
        read_kleborate(table)
```

- [ ] **Step 3: Run to verify failure**

Run: `.venv/bin/pytest tests/python/test_kleborate.py -q`
Expected: ERROR `No module named 'amrtools.parsers.kleborate'`

- [ ] **Step 4: Implement** `src/amrtools/parsers/kleborate.py`

```python
"""Species, sequence type and scores from Kleborate v3 output (--trim_headers)."""

from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from amrtools.errors import InputFormatError


@dataclass(frozen=True)
class KleborateResult:
    species: str
    st: str
    resistance_score: str
    virulence_score: str


NO_RESULT = KleborateResult(species="NA", st="NA", resistance_score="NA", virulence_score="NA")


def read_kleborate(path: Path) -> KleborateResult:
    """An empty file means Kleborate wrote no result for this assembly (outside the preset)."""
    path = Path(path)
    if path.stat().st_size == 0:
        return NO_RESULT
    table = pd.read_csv(path, sep="\t", dtype=str, keep_default_na=False)
    if "species" not in table.columns:
        raise InputFormatError(f"{path}: missing Kleborate column 'species'")
    if len(table) != 1:
        raise InputFormatError(f"{path}: expected 1 Kleborate row, found {len(table)}")
    row = table.iloc[0]

    def field(name: str) -> str:
        return row.get(name, "") or "NA"

    return KleborateResult(
        species=field("species"),
        st=field("ST"),
        resistance_score=field("resistance_score"),
        virulence_score=field("virulence_score"),
    )
```

- [ ] **Step 5: Run to verify pass**

Run: `.venv/bin/pytest tests/python/test_kleborate.py -q`
Expected: `5 passed`

- [ ] **Step 6: Commit**

```bash
git add src/amrtools/parsers/kleborate.py tests/python
git commit -m "feat(amrtools): parse Kleborate v3 typing output"
```

---

### Task 5: AMRFinderPlus parser

**Files:**
- Create: `src/amrtools/parsers/amrfinder.py`, `tests/python/test_amrfinder.py`
- Modify: `tests/python/helpers.py` (append AMRFinderPlus builders)

**Interfaces:**
- Consumes: `InputFormatError`
- Produces: `AMRFINDER_FIELDS: list[str]` = `["gene_symbol","element_name","element_type","element_subtype","drug_class","drug_subclass","method","pct_identity","pct_coverage","contig_id"]`; `read_amrfinder(path: Path) -> pd.DataFrame` with exactly those columns (`pct_*` as float); helpers `amrfinder_row(symbol, element_type="AMR", subtype="AMR", drug_class="BETA-LACTAM", subclass="CARBAPENEM") -> dict`, `write_amrfinder(path, rows, version=4) -> Path`

- [ ] **Step 1: Append helpers to `tests/python/helpers.py`**

```python
AMRFINDER_V4_COLUMNS = [
    "Protein id", "Contig id", "Start", "Stop", "Strand", "Element symbol", "Element name",
    "Scope", "Type", "Subtype", "Class", "Subclass", "Method", "Target length",
    "Reference sequence length", "% Coverage of reference", "% Identity to reference",
    "Alignment length", "Closest reference accession", "Closest reference name",
    "HMM accession", "HMM description", "Hierarchy node",
]  # fmt: skip

# AMRFinderPlus v3 names for the columns that v4 renamed.
AMRFINDER_V3_RENAMES = {
    "Protein id": "Protein identifier",
    "Element symbol": "Gene symbol",
    "Element name": "Sequence name",
    "Type": "Element type",
    "Subtype": "Element subtype",
    "% Coverage of reference": "% Coverage of reference sequence",
    "% Identity to reference": "% Identity to reference sequence",
    "Closest reference accession": "Accession of closest sequence",
    "Closest reference name": "Name of closest sequence",
    "HMM accession": "HMM id",
}


def amrfinder_row(
    symbol: str,
    element_type: str = "AMR",
    subtype: str = "AMR",
    drug_class: str = "BETA-LACTAM",
    subclass: str = "CARBAPENEM",
) -> dict[str, str]:
    row = dict.fromkeys(AMRFINDER_V4_COLUMNS, "NA")
    row.update(
        {
            "Contig id": "contig_1",
            "Start": "1",
            "Stop": "882",
            "Strand": "+",
            "Element symbol": symbol,
            "Element name": f"{symbol} test element",
            "Scope": "core",
            "Type": element_type,
            "Subtype": subtype,
            "Class": drug_class,
            "Subclass": subclass,
            "Method": "ALLELEX",
            "% Coverage of reference": "100.00",
            "% Identity to reference": "99.65",
        }
    )
    return row


def write_amrfinder(path: Path, rows: list[dict[str, str]], version: int = 4) -> Path:
    header = AMRFINDER_V4_COLUMNS
    if version == 3:
        header = [AMRFINDER_V3_RENAMES.get(c, c) for c in AMRFINDER_V4_COLUMNS]
    lines = ["\t".join(header)] + ["\t".join(r[c] for c in AMRFINDER_V4_COLUMNS) for r in rows]
    path.write_text("\n".join(lines) + "\n")
    return path
```

- [ ] **Step 2: Write the failing tests** `tests/python/test_amrfinder.py`

```python
import pandas as pd
import pytest
from helpers import amrfinder_row, write_amrfinder

from amrtools.errors import InputFormatError
from amrtools.parsers.amrfinder import AMRFINDER_FIELDS, read_amrfinder

ROWS = [
    amrfinder_row("blaKPC-2"),
    amrfinder_row("ompK36_D135DGD", subtype="POINT"),
    amrfinder_row("iutA", element_type="VIRULENCE", subtype="VIRULENCE", drug_class="NA"),
]


def test_v4_output_maps_to_our_columns(tmp_path):
    genes = read_amrfinder(write_amrfinder(tmp_path / "s.tsv", ROWS))
    assert list(genes.columns) == AMRFINDER_FIELDS
    assert list(genes["gene_symbol"]) == ["blaKPC-2", "ompK36_D135DGD", "iutA"]
    assert list(genes["element_subtype"]) == ["AMR", "POINT", "VIRULENCE"]
    assert genes["pct_identity"].iloc[0] == pytest.approx(99.65)


def test_v3_headers_give_identical_table(tmp_path):
    v4 = read_amrfinder(write_amrfinder(tmp_path / "v4.tsv", ROWS, version=4))
    v3 = read_amrfinder(write_amrfinder(tmp_path / "v3.tsv", ROWS, version=3))
    pd.testing.assert_frame_equal(v3, v4)


def test_header_only_file_means_zero_hits(tmp_path):
    genes = read_amrfinder(write_amrfinder(tmp_path / "s.tsv", []))
    assert genes.empty
    assert list(genes.columns) == AMRFINDER_FIELDS


def test_missing_column_names_file_and_column(tmp_path):
    path = write_amrfinder(tmp_path / "s.tsv", ROWS)
    text = path.read_text().replace("Element symbol", "Something else")
    path.write_text(text)
    with pytest.raises(InputFormatError, match=r"s\.tsv: missing AMRFinderPlus column 'Element symbol'"):
        read_amrfinder(path)


def test_zero_byte_file_is_rejected(tmp_path):
    path = tmp_path / "s.tsv"
    path.write_text("")
    with pytest.raises(InputFormatError, match="empty AMRFinderPlus report"):
        read_amrfinder(path)
```

- [ ] **Step 3: Run to verify failure**

Run: `.venv/bin/pytest tests/python/test_amrfinder.py -q`
Expected: ERROR `No module named 'amrtools.parsers.amrfinder'`

- [ ] **Step 4: Implement** `src/amrtools/parsers/amrfinder.py`

```python
"""AMRFinderPlus report -> one row per detected element, with our column names."""

from pathlib import Path

import pandas as pd

from amrtools.errors import InputFormatError

# Our column -> accepted AMRFinderPlus headers (v4 first, then v3).
_ALIASES = {
    "gene_symbol": ["Element symbol", "Gene symbol"],
    "element_name": ["Element name", "Sequence name"],
    "element_type": ["Type", "Element type"],
    "element_subtype": ["Subtype", "Element subtype"],
    "drug_class": ["Class"],
    "drug_subclass": ["Subclass"],
    "method": ["Method"],
    "pct_identity": ["% Identity to reference", "% Identity to reference sequence"],
    "pct_coverage": ["% Coverage of reference", "% Coverage of reference sequence"],
    "contig_id": ["Contig id"],
}

AMRFINDER_FIELDS = list(_ALIASES)


def read_amrfinder(path: Path) -> pd.DataFrame:
    try:
        report = pd.read_csv(path, sep="\t", dtype=str, keep_default_na=False)
    except pd.errors.EmptyDataError as exc:
        raise InputFormatError(f"{path}: empty AMRFinderPlus report (no header line)") from exc

    columns = {}
    for ours, accepted in _ALIASES.items():
        source = next((name for name in accepted if name in report.columns), None)
        if source is None:
            raise InputFormatError(f"{path}: missing AMRFinderPlus column '{accepted[0]}'")
        columns[ours] = report[source]

    genes = pd.DataFrame(columns, columns=AMRFINDER_FIELDS)
    genes["pct_identity"] = genes["pct_identity"].astype(float)
    genes["pct_coverage"] = genes["pct_coverage"].astype(float)
    return genes
```

- [ ] **Step 5: Run to verify pass**

Run: `.venv/bin/pytest tests/python/test_amrfinder.py -q`
Expected: `5 passed`

- [ ] **Step 6: Commit**

```bash
git add src/amrtools/parsers/amrfinder.py tests/python
git commit -m "feat(amrtools): parse AMRFinderPlus v3 and v4 reports"
```

---

### Task 6: QC rules and per-sample tables

**Files:**
- Create: `src/amrtools/qc.py`, `src/amrtools/sample.py`, `tests/python/test_qc.py`, `tests/python/test_sample.py`

**Interfaces:**
- Consumes: `AssemblyStats`, `read_assembly`, `FastpStats`, `read_fastp`, `read_kleborate`, `read_amrfinder`, `GENE_COLUMNS`, `SUMMARY_COLUMNS`
- Produces:
  - `QcThresholds(min_assembly_length=5_000_000, max_assembly_length=6_500_000, max_contigs=500, min_q30=0.80)` (frozen dataclass)
  - `qc_reasons(*, assembly: AssemblyStats, fastp: FastpStats, species: str, organism: str, thresholds: QcThresholds) -> list[str]` — reasons in order `assembly_length`, `n_contigs`, `q30_rate`, `species_mismatch`
  - `build_sample_tables(*, sample, sample_type, organism, fastp_json, contigs, amrfinder_tsv, kleborate_tsv, amrfinder_version, amrfinder_db_version, thresholds) -> tuple[pd.DataFrame, pd.DataFrame]` (genes with `GENE_COLUMNS`, one-row summary with `SUMMARY_COLUMNS`)
  - `write_tsv(table: pd.DataFrame, path: Path) -> None`

- [ ] **Step 1: Write the failing QC tests** `tests/python/test_qc.py`

```python
import pytest

from amrtools.parsers.assembly import AssemblyStats
from amrtools.parsers.fastp import FastpStats
from amrtools.qc import QcThresholds, qc_reasons

GOOD_ASSEMBLY = AssemblyStats(total_length=5_500_000, n_contigs=120, n50=150_000)
GOOD_FASTP = FastpStats(reads_after_qc=700_000, q30_rate=0.92)
KP = "Klebsiella pneumoniae"


def reasons(assembly=GOOD_ASSEMBLY, fastp=GOOD_FASTP, species=KP):
    return qc_reasons(
        assembly=assembly,
        fastp=fastp,
        species=species,
        organism="Klebsiella_pneumoniae",
        thresholds=QcThresholds(),
    )


def test_good_sample_passes():
    assert reasons() == []


@pytest.mark.parametrize("length", [5_000_000, 6_500_000])
def test_assembly_length_bounds_are_inclusive(length):
    assert reasons(assembly=AssemblyStats(length, 120, 150_000)) == []


@pytest.mark.parametrize("length", [4_999_999, 6_500_001])
def test_assembly_length_outside_bounds_warns(length):
    assert reasons(assembly=AssemblyStats(length, 120, 150_000)) == ["assembly_length"]


def test_contig_count_must_be_below_limit():
    assert reasons(assembly=AssemblyStats(5_500_000, 499, 20_000)) == []
    assert reasons(assembly=AssemblyStats(5_500_000, 500, 20_000)) == ["n_contigs"]


def test_q30_must_be_above_limit():
    assert reasons(fastp=FastpStats(700_000, 0.81)) == []
    assert reasons(fastp=FastpStats(700_000, 0.80)) == ["q30_rate"]


def test_species_must_match_organism():
    assert reasons(species="Klebsiella variicola") == ["species_mismatch"]
    assert reasons(species="NA") == ["species_mismatch"]


def test_all_reasons_reported_in_fixed_order():
    assert reasons(
        assembly=AssemblyStats(1_000_000, 900, 2_000),
        fastp=FastpStats(10, 0.5),
        species="NA",
    ) == ["assembly_length", "n_contigs", "q30_rate", "species_mismatch"]
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest tests/python/test_qc.py -q`
Expected: ERROR `No module named 'amrtools.qc'`

- [ ] **Step 3: Implement** `src/amrtools/qc.py`

```python
"""Per-sample QC flags. Samples are flagged, never dropped."""

from dataclasses import dataclass

from amrtools.parsers.assembly import AssemblyStats
from amrtools.parsers.fastp import FastpStats


@dataclass(frozen=True)
class QcThresholds:
    min_assembly_length: int = 5_000_000
    max_assembly_length: int = 6_500_000
    max_contigs: int = 500
    min_q30: float = 0.80


def qc_reasons(
    *,
    assembly: AssemblyStats,
    fastp: FastpStats,
    species: str,
    organism: str,
    thresholds: QcThresholds,
) -> list[str]:
    reasons = []
    if not thresholds.min_assembly_length <= assembly.total_length <= thresholds.max_assembly_length:
        reasons.append("assembly_length")
    if assembly.n_contigs >= thresholds.max_contigs:
        reasons.append("n_contigs")
    if fastp.q30_rate <= thresholds.min_q30:
        reasons.append("q30_rate")
    if species != organism.replace("_", " "):
        reasons.append("species_mismatch")
    return reasons
```

- [ ] **Step 4: Run to verify pass**

Run: `.venv/bin/pytest tests/python/test_qc.py -q`
Expected: `9 passed`

- [ ] **Step 5: Write the failing sample tests** `tests/python/test_sample.py`

```python
from pathlib import Path

import pytest
from helpers import amrfinder_row, write_amrfinder, write_contigs, write_fastp

from amrtools.columns import GENE_COLUMNS, SUMMARY_COLUMNS
from amrtools.qc import QcThresholds
from amrtools.sample import build_sample_tables, write_tsv

KLEBORATE = Path(__file__).parent / "fixtures" / "kleborate_SRR5386028.tsv"


@pytest.fixture
def inputs(tmp_path):
    return {
        "fastp_json": write_fastp(tmp_path / "s.fastp.json", total_reads=700_000, q30_rate=0.92),
        "contigs": write_contigs(tmp_path / "contigs.fa", [3_000_000, 2_500_000]),
        "amrfinder_tsv": write_amrfinder(
            tmp_path / "s.tsv",
            [
                amrfinder_row("blaKPC-2"),
                amrfinder_row("ompK36_D135DGD", subtype="POINT"),
                amrfinder_row("iutA", element_type="VIRULENCE", subtype="VIRULENCE"),
            ],
        ),
        "kleborate_tsv": KLEBORATE,
    }


def build(inputs, **overrides):
    args = {
        "sample": "S1",
        "sample_type": "isolate",
        "organism": "Klebsiella_pneumoniae",
        "amrfinder_version": "4.2.7",
        "amrfinder_db_version": "2026-09-30.1",
        "thresholds": QcThresholds(),
        **inputs,
        **overrides,
    }
    return build_sample_tables(**args)


def test_gene_table_has_one_row_per_element_and_run_metadata(inputs):
    genes, _ = build(inputs)
    assert list(genes.columns) == GENE_COLUMNS
    assert list(genes["gene_symbol"]) == ["blaKPC-2", "ompK36_D135DGD", "iutA"]
    assert set(genes["sample"]) == {"S1"}
    assert set(genes["amrfinder_db_version"]) == {"2026-09-30.1"}


def test_summary_row_combines_all_tools(inputs):
    _, summary = build(inputs)
    assert list(summary.columns) == SUMMARY_COLUMNS
    row = summary.iloc[0].to_dict()
    assert row["kleborate_species"] == "Klebsiella pneumoniae"
    assert row["st"] == "ST13"
    assert row["reads_after_qc"] == 700_000
    assert row["assembly_length"] == 5_500_000
    assert row["n_contigs"] == 2
    assert row["n50"] == 3_000_000
    assert row["n_amr_genes"] == 2  # AMR gene + point mutation, not the virulence row
    assert row["qc_status"] == "pass"
    assert row["qc_reasons"] == ""


def test_zero_hits_gives_empty_gene_table_and_zero_count(inputs, tmp_path):
    no_hits = write_amrfinder(tmp_path / "none.tsv", [])
    genes, summary = build(inputs, amrfinder_tsv=no_hits)
    assert genes.empty
    assert list(genes.columns) == GENE_COLUMNS
    assert summary.iloc[0]["n_amr_genes"] == 0


def test_low_quality_sample_is_flagged_not_dropped(inputs, tmp_path):
    poor = write_fastp(tmp_path / "poor.json", q30_rate=0.5)
    _, summary = build(inputs, fastp_json=poor)
    assert summary.iloc[0]["qc_status"] == "warn"
    assert summary.iloc[0]["qc_reasons"] == "q30_rate"


def test_kleborate_without_result_flags_species_mismatch(inputs, tmp_path):
    empty = tmp_path / "empty.kleborate.tsv"
    empty.write_text("")
    _, summary = build(inputs, kleborate_tsv=empty)
    row = summary.iloc[0]
    assert row["kleborate_species"] == "NA"
    assert row["st"] == "NA"
    assert row["qc_reasons"] == "species_mismatch"


def test_write_tsv_round_trips_header(inputs, tmp_path):
    genes, _ = build(inputs)
    out = tmp_path / "S1.amr_genes.tsv"
    write_tsv(genes, out)
    assert out.read_text().splitlines()[0].split("\t") == GENE_COLUMNS
```

- [ ] **Step 6: Run to verify failure**

Run: `.venv/bin/pytest tests/python/test_sample.py -q`
Expected: ERROR `No module named 'amrtools.sample'`

- [ ] **Step 7: Implement** `src/amrtools/sample.py`

```python
"""Build one sample's gene table and summary row from its tool outputs."""

from pathlib import Path

import pandas as pd

from amrtools.columns import GENE_COLUMNS, SUMMARY_COLUMNS
from amrtools.parsers.amrfinder import read_amrfinder
from amrtools.parsers.assembly import read_assembly
from amrtools.parsers.fastp import read_fastp
from amrtools.parsers.kleborate import read_kleborate
from amrtools.qc import QcThresholds, qc_reasons


def build_sample_tables(
    *,
    sample: str,
    sample_type: str,
    organism: str,
    fastp_json: Path,
    contigs: Path,
    amrfinder_tsv: Path,
    kleborate_tsv: Path,
    amrfinder_version: str,
    amrfinder_db_version: str,
    thresholds: QcThresholds,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    genes = read_amrfinder(amrfinder_tsv).assign(
        sample=sample,
        sample_type=sample_type,
        organism=organism,
        amrfinder_version=amrfinder_version,
        amrfinder_db_version=amrfinder_db_version,
    )[GENE_COLUMNS]

    fastp = read_fastp(fastp_json)
    assembly = read_assembly(contigs)
    kleborate = read_kleborate(kleborate_tsv)
    reasons = qc_reasons(
        assembly=assembly,
        fastp=fastp,
        species=kleborate.species,
        organism=organism,
        thresholds=thresholds,
    )

    summary = pd.DataFrame(
        [
            {
                "sample": sample,
                "sample_type": sample_type,
                "organism": organism,
                "kleborate_species": kleborate.species,
                "st": kleborate.st,
                "resistance_score": kleborate.resistance_score,
                "virulence_score": kleborate.virulence_score,
                "reads_after_qc": fastp.reads_after_qc,
                "q30_rate": fastp.q30_rate,
                "assembly_length": assembly.total_length,
                "n_contigs": assembly.n_contigs,
                "n50": assembly.n50,
                "n_amr_genes": int((genes["element_type"] == "AMR").sum()),
                "qc_status": "warn" if reasons else "pass",
                "qc_reasons": ";".join(reasons),
            }
        ],
        columns=SUMMARY_COLUMNS,
    )
    return genes, summary


def write_tsv(table: pd.DataFrame, path: Path) -> None:
    table.to_csv(path, sep="\t", index=False)
```

- [ ] **Step 8: Run to verify pass**

Run: `.venv/bin/pytest -q`
Expected: all tests pass (`36 passed`).

- [ ] **Step 9: Commit**

```bash
git add src/amrtools/qc.py src/amrtools/sample.py tests/python
git commit -m "feat(amrtools): QC flags and per-sample tables"
```

---

### Task 7: Merge, CLI and container

**Files:**
- Create: `src/amrtools/merge.py`, `src/amrtools/cli.py`, `containers/amrtools/Dockerfile`, `tests/python/test_merge.py`, `tests/python/test_cli.py`

**Interfaces:**
- Consumes: everything from Tasks 2–6
- Produces:
  - `merge_tables(paths: list[Path], columns: list[str]) -> pd.DataFrame` (sorted by `sample`)
  - CLI `amrtools sample --sample S --sample-type T --organism O --fastp-json F --contigs C --amrfinder A --kleborate K --amrfinder-version V --amrfinder-db-version D [--min-assembly-length N --max-assembly-length N --max-contigs N --min-q30 X] [--outdir DIR]` → `DIR/S.amr_genes.tsv`, `DIR/S.run_summary.tsv`
  - CLI `amrtools stub --sample S --sample-type T --organism O [--outdir DIR]` → same two files, header-only genes and an `NA` summary row
  - CLI `amrtools merge --genes F... --summaries F... [--outdir DIR]` → `DIR/amr_genes.tsv`, `DIR/run_summary.tsv`
  - Exit code 0 on success, 1 with `amrtools: error: <message>` on stderr for bad input
  - Image `ghcr.io/simomounir/amrtools:0.1.0` (amd64) with `amrtools` and `ps` on PATH

- [ ] **Step 1: Write the failing merge tests** `tests/python/test_merge.py`

```python
import pytest

from amrtools.errors import InputFormatError
from amrtools.merge import merge_tables

COLUMNS = ["sample", "value"]


def write(path, text):
    path.write_text(text)
    return path


def test_merge_sorts_by_sample_and_keeps_text(tmp_path):
    b = write(tmp_path / "b.tsv", "sample\tvalue\nb\t0.900\n")
    a = write(tmp_path / "a.tsv", "sample\tvalue\na\t\n")
    merged = merge_tables([b, a], COLUMNS)
    assert list(merged["sample"]) == ["a", "b"]
    assert list(merged["value"]) == ["", "0.900"]


def test_header_only_tables_contribute_no_rows(tmp_path):
    empty = write(tmp_path / "e.tsv", "sample\tvalue\n")
    full = write(tmp_path / "f.tsv", "sample\tvalue\nx\t1\n")
    assert len(merge_tables([empty, full], COLUMNS)) == 1


def test_no_inputs_gives_empty_table_with_columns():
    merged = merge_tables([], COLUMNS)
    assert merged.empty
    assert list(merged.columns) == COLUMNS


def test_mismatched_columns_are_rejected(tmp_path):
    bad = write(tmp_path / "bad.tsv", "sample\tother\nx\t1\n")
    with pytest.raises(InputFormatError, match="bad.tsv: columns do not match"):
        merge_tables([bad], COLUMNS)
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest tests/python/test_merge.py -q`
Expected: ERROR `No module named 'amrtools.merge'`

- [ ] **Step 3: Implement** `src/amrtools/merge.py`

```python
"""Concatenate per-sample tables into run-level tables."""

from pathlib import Path

import pandas as pd

from amrtools.errors import InputFormatError


def merge_tables(paths: list[Path], columns: list[str]) -> pd.DataFrame:
    frames = []
    for path in paths:
        frame = pd.read_csv(path, sep="\t", dtype=str, keep_default_na=False)
        if list(frame.columns) != columns:
            raise InputFormatError(f"{path}: columns do not match the expected table layout")
        frames.append(frame)
    if not frames:
        return pd.DataFrame(columns=columns)
    merged = pd.concat(frames, ignore_index=True)
    return merged.sort_values("sample", kind="stable", ignore_index=True)
```

- [ ] **Step 4: Run to verify pass**

Run: `.venv/bin/pytest tests/python/test_merge.py -q`
Expected: `4 passed`

- [ ] **Step 5: Write the failing CLI tests** `tests/python/test_cli.py`

```python
from pathlib import Path

from helpers import amrfinder_row, write_amrfinder, write_contigs, write_fastp

from amrtools.cli import main
from amrtools.columns import GENE_COLUMNS, SUMMARY_COLUMNS

KLEBORATE = Path(__file__).parent / "fixtures" / "kleborate_SRR5386028.tsv"


def sample_args(tmp_path, sample, amrfinder):
    return [
        "sample",
        "--sample", sample,
        "--sample-type", "isolate",
        "--organism", "Klebsiella_pneumoniae",
        "--fastp-json", str(write_fastp(tmp_path / f"{sample}.json")),
        "--contigs", str(write_contigs(tmp_path / f"{sample}.fa", [3_000_000, 2_500_000])),
        "--amrfinder", str(amrfinder),
        "--kleborate", str(KLEBORATE),
        "--amrfinder-version", "4.2.7",
        "--amrfinder-db-version", "2026-09-30.1",
        "--outdir", str(tmp_path / "out"),
    ]  # fmt: skip


def header(path):
    return path.read_text().splitlines()[0].split("\t")


def test_sample_then_merge_round_trip(tmp_path):
    out = tmp_path / "out"
    hits = write_amrfinder(tmp_path / "hits.tsv", [amrfinder_row("blaKPC-2")])
    none = write_amrfinder(tmp_path / "none.tsv", [])
    assert main(sample_args(tmp_path, "S2", hits)) == 0
    assert main(sample_args(tmp_path, "S1", none)) == 0

    merged = tmp_path / "merged"
    assert main([
        "merge",
        "--genes", str(out / "S2.amr_genes.tsv"), str(out / "S1.amr_genes.tsv"),
        "--summaries", str(out / "S2.run_summary.tsv"), str(out / "S1.run_summary.tsv"),
        "--outdir", str(merged),
    ]) == 0  # fmt: skip

    summary = (merged / "run_summary.tsv").read_text().splitlines()
    assert summary[0].split("\t") == SUMMARY_COLUMNS
    assert [line.split("\t")[0] for line in summary[1:]] == ["S1", "S2"]
    genes = (merged / "amr_genes.tsv").read_text().splitlines()
    assert len(genes) == 2 and genes[1].startswith("S2\t")


def test_qc_threshold_options_are_applied(tmp_path):
    hits = write_amrfinder(tmp_path / "hits.tsv", [])
    args = sample_args(tmp_path, "S1", hits) + ["--max-assembly-length", "1000"]
    assert main(args) == 0
    row = (tmp_path / "out" / "S1.run_summary.tsv").read_text().splitlines()[1].split("\t")
    assert row[SUMMARY_COLUMNS.index("qc_reasons")] == "assembly_length"


def test_stub_writes_placeholder_tables(tmp_path):
    out = tmp_path / "out"
    args = ["stub", "--sample", "S9", "--sample-type", "isolate",
            "--organism", "Klebsiella_pneumoniae", "--outdir", str(out)]  # fmt: skip
    assert main(args) == 0
    assert (out / "S9.amr_genes.tsv").read_text().splitlines() == ["\t".join(GENE_COLUMNS)]
    summary = (out / "S9.run_summary.tsv").read_text().splitlines()
    assert summary[1].split("\t")[:4] == ["S9", "isolate", "Klebsiella_pneumoniae", "NA"]


def test_bad_input_returns_error_code_and_message(tmp_path, capsys):
    broken = tmp_path / "broken.tsv"
    broken.write_text("not\tan\tamrfinder\treport\n")
    assert main(sample_args(tmp_path, "S1", broken)) == 1
    assert "amrtools: error: " in capsys.readouterr().err
```

- [ ] **Step 6: Run to verify failure**

Run: `.venv/bin/pytest tests/python/test_cli.py -q`
Expected: ERROR `No module named 'amrtools.cli'`

- [ ] **Step 7: Implement** `src/amrtools/cli.py`

```python
"""Command-line entry point used by the pipeline's amrtools processes."""

import argparse
import sys
from pathlib import Path

import pandas as pd

from amrtools import __version__
from amrtools.columns import GENE_COLUMNS, SUMMARY_COLUMNS
from amrtools.errors import InputFormatError
from amrtools.merge import merge_tables
from amrtools.qc import QcThresholds
from amrtools.sample import build_sample_tables, write_tsv


def _add_identity(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--sample", required=True)
    parser.add_argument("--sample-type", required=True)
    parser.add_argument("--organism", required=True)
    parser.add_argument("--outdir", type=Path, default=Path("."))


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="amrtools", description=__doc__)
    parser.add_argument("--version", action="version", version=f"amrtools {__version__}")
    commands = parser.add_subparsers(dest="command", required=True)

    sample = commands.add_parser("sample", help="build one sample's gene and summary tables")
    _add_identity(sample)
    for name in ("--fastp-json", "--contigs", "--amrfinder", "--kleborate"):
        sample.add_argument(name, type=Path, required=True)
    sample.add_argument("--amrfinder-version", required=True)
    sample.add_argument("--amrfinder-db-version", required=True)
    defaults = QcThresholds()
    sample.add_argument("--min-assembly-length", type=int, default=defaults.min_assembly_length)
    sample.add_argument("--max-assembly-length", type=int, default=defaults.max_assembly_length)
    sample.add_argument("--max-contigs", type=int, default=defaults.max_contigs)
    sample.add_argument("--min-q30", type=float, default=defaults.min_q30)

    stub = commands.add_parser("stub", help="write placeholder tables for a -stub run")
    _add_identity(stub)

    merge = commands.add_parser("merge", help="merge per-sample tables into run tables")
    merge.add_argument("--genes", type=Path, nargs="+", required=True)
    merge.add_argument("--summaries", type=Path, nargs="+", required=True)
    merge.add_argument("--outdir", type=Path, default=Path("."))
    return parser


def _run_sample(args: argparse.Namespace) -> None:
    genes, summary = build_sample_tables(
        sample=args.sample,
        sample_type=args.sample_type,
        organism=args.organism,
        fastp_json=args.fastp_json,
        contigs=args.contigs,
        amrfinder_tsv=args.amrfinder,
        kleborate_tsv=args.kleborate,
        amrfinder_version=args.amrfinder_version,
        amrfinder_db_version=args.amrfinder_db_version,
        thresholds=QcThresholds(
            min_assembly_length=args.min_assembly_length,
            max_assembly_length=args.max_assembly_length,
            max_contigs=args.max_contigs,
            min_q30=args.min_q30,
        ),
    )
    write_tsv(genes, args.outdir / f"{args.sample}.amr_genes.tsv")
    write_tsv(summary, args.outdir / f"{args.sample}.run_summary.tsv")


def _run_stub(args: argparse.Namespace) -> None:
    row = dict.fromkeys(SUMMARY_COLUMNS, "NA") | {
        "sample": args.sample,
        "sample_type": args.sample_type,
        "organism": args.organism,
    }
    write_tsv(pd.DataFrame(columns=GENE_COLUMNS), args.outdir / f"{args.sample}.amr_genes.tsv")
    write_tsv(pd.DataFrame([row], columns=SUMMARY_COLUMNS), args.outdir / f"{args.sample}.run_summary.tsv")


def _run_merge(args: argparse.Namespace) -> None:
    write_tsv(merge_tables(args.genes, GENE_COLUMNS), args.outdir / "amr_genes.tsv")
    write_tsv(merge_tables(args.summaries, SUMMARY_COLUMNS), args.outdir / "run_summary.tsv")


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    args.outdir.mkdir(parents=True, exist_ok=True)
    commands = {"sample": _run_sample, "stub": _run_stub, "merge": _run_merge}
    try:
        commands[args.command](args)
    except (InputFormatError, FileNotFoundError) as exc:
        print(f"amrtools: error: {exc}", file=sys.stderr)
        return 1
    return 0
```

- [ ] **Step 8: Run all Python tests and lint**

Run: `.venv/bin/pytest -q && .venv/bin/pre-commit run --all-files`
Expected: all tests pass (`44 passed`), hooks Passed.

- [ ] **Step 9: Write** `containers/amrtools/Dockerfile`

```dockerfile
FROM python:3.12-slim

# Nextflow runs `ps` inside task containers to collect resource metrics.
RUN apt-get update \
    && apt-get install -y --no-install-recommends procps \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/amrtools
COPY pyproject.toml README.md ./
COPY src ./src
RUN pip install --no-cache-dir .

LABEL org.opencontainers.image.source="https://github.com/simomounir/amr-cloud-pipeline"
```

- [ ] **Step 10: Build and smoke-test the image**

```bash
docker build --platform linux/amd64 -f containers/amrtools/Dockerfile -t ghcr.io/simomounir/amrtools:0.1.0 .
docker run --rm --platform linux/amd64 ghcr.io/simomounir/amrtools:0.1.0 sh -c "amrtools --version && which ps"
```
Expected: `amrtools 0.1.0` and `/usr/bin/ps`.

- [ ] **Step 11: Commit**

```bash
git add src/amrtools tests/python containers
git commit -m "feat(amrtools): merge step, CLI and container image"
```

---

### Task 8: Nextflow pipeline with stub test

**Files:**
- Create: `.nf-core.yml`, `nextflow.config`, `conf/base.config`, `conf/modules.config`, `conf/test.config`, `nextflow_schema.json`, `assets/schema_input.json`, `main.nf`, `workflows/isolate.nf`, `modules/local/kleborate/main.nf`, `modules/local/amrtools/sample/main.nf`, `modules/local/amrtools/merge/main.nf`, `nf-test.config`, `tests/nf-test/pipeline.nf.test`, `tests/data/samplesheet_stub.csv`, `tests/data/samplesheet_bad.csv`, `tests/data/stub/*.fastq.gz`
- Generated by nf-core tools: `modules.json`, `modules/nf-core/{fastp,shovill,amrfinderplus/run,amrfinderplus/update}/`

**Interfaces:**
- Consumes: amrtools CLI and image from Task 7
- Produces:
  - `nextflow run . -profile test,docker [--input CSV] [--outdir DIR] [--amrfinder_db PATH]`
  - Outputs: `${outdir}/summary/amr_genes.tsv`, `${outdir}/summary/run_summary.tsv`, plus `fastp/`, `assembly/<sample>/contigs.fa`, `amrfinderplus/`, `kleborate/`
  - nf-test tags `stub`, `validation`, `full` (full test added in Task 9)

- [ ] **Step 1: Write `.nf-core.yml`**

```yaml
repository_type: pipeline
nf_core_version: 4.1.0
```

- [ ] **Step 2: Write `nextflow.config`**

```groovy
manifest {
    name            = 'amr-cloud-pipeline'
    description     = 'AMR detection for bacterial isolates'
    homePage        = 'https://github.com/simomounir/amr-cloud-pipeline'
    mainScript      = 'main.nf'
    nextflowVersion = '!>=25.04.0'
    version         = '0.1.0'
}

plugins {
    id 'nf-schema@2.8.0'
}

params {
    input                  = null
    outdir                 = 'results'
    amrfinder_db           = null
    amrtools_container     = 'ghcr.io/simomounir/amrtools:0.1.0'
    qc_min_assembly_length = 5000000
    qc_max_assembly_length = 6500000
    qc_max_contigs         = 500
    qc_min_q30             = 0.80
}

includeConfig 'conf/base.config'
includeConfig 'conf/modules.config'

profiles {
    docker {
        docker.enabled    = true
        docker.runOptions = '--platform linux/amd64 -u $(id -u):$(id -g)'
    }
    test {
        includeConfig 'conf/test.config'
    }
}
```

- [ ] **Step 3: Write `conf/base.config`**

```groovy
process {
    cpus   = 1
    memory = { 2.GB * task.attempt }

    // Out-of-memory kills (137, 140) retry with more memory; anything else stops the run.
    errorStrategy = { task.exitStatus in [137, 140] ? 'retry' : 'terminate' }
    maxRetries    = 2

    resourceLimits = [cpus: 4, memory: 14.GB, time: 8.h]

    withLabel: process_single {
        cpus   = 1
        memory = { 2.GB * task.attempt }
    }
    withLabel: process_low {
        cpus   = 2
        memory = { 4.GB * task.attempt }
    }
    withLabel: process_medium {
        cpus   = 4
        memory = { 8.GB * task.attempt }
    }
}
```

- [ ] **Step 4: Write `conf/modules.config`**

```groovy
process {
    withName: 'FASTP' {
        ext.args   = '--detect_adapter_for_pe'
        publishDir = [path: { "${params.outdir}/fastp" }, mode: 'copy', pattern: '*.{json,html}']
    }
    withName: 'SHOVILL' {
        publishDir = [path: { "${params.outdir}/assembly/${meta.id}" }, mode: 'copy', pattern: 'contigs.fa']
    }
    withName: 'AMRFINDERPLUS_RUN' {
        ext.args   = '--plus'
        publishDir = [path: { "${params.outdir}/amrfinderplus" }, mode: 'copy', pattern: '*.tsv']
    }
    withName: 'KLEBORATE' {
        publishDir = [path: { "${params.outdir}/kleborate" }, mode: 'copy']
    }
    withName: 'AMRTOOLS_MERGE' {
        publishDir = [path: { "${params.outdir}/summary" }, mode: 'copy']
    }
}
```

- [ ] **Step 5: Write `conf/test.config`**

```groovy
// Tiny K. pneumoniae dataset (3 samples, ~20x) for CI and local checks.
params {
    input = "${projectDir}/tests/data/samplesheet_test.csv"
}

process {
    resourceLimits = [cpus: 4, memory: 7.GB, time: 2.h]
}
```

- [ ] **Step 6: Write `assets/schema_input.json`**

```json
{
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://raw.githubusercontent.com/simomounir/amr-cloud-pipeline/main/assets/schema_input.json",
    "title": "Samplesheet",
    "type": "array",
    "items": {
        "type": "object",
        "properties": {
            "sample": {
                "type": "string",
                "pattern": "^[A-Za-z0-9_.-]+$",
                "errorMessage": "sample may only contain letters, digits, '_', '.' and '-'",
                "meta": ["id"]
            },
            "fastq_1": {
                "type": "string",
                "pattern": "^\\S+\\.f(ast)?q\\.gz$",
                "errorMessage": "fastq_1 must be a .fastq.gz or .fq.gz path or URL"
            },
            "fastq_2": {
                "type": "string",
                "pattern": "^\\S+\\.f(ast)?q\\.gz$",
                "errorMessage": "fastq_2 must be a .fastq.gz or .fq.gz path or URL"
            },
            "sample_type": {
                "type": "string",
                "enum": ["isolate"],
                "meta": ["sample_type"]
            },
            "organism": {
                "type": "string",
                "pattern": "^[A-Z][a-z]+_[a-z]+$",
                "errorMessage": "organism must use AMRFinderPlus naming, e.g. Klebsiella_pneumoniae",
                "meta": ["organism"]
            }
        },
        "required": ["sample", "fastq_1", "fastq_2", "sample_type", "organism"]
    },
    "uniqueEntries": ["sample"]
}
```

- [ ] **Step 7: Write `nextflow_schema.json`**

```json
{
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://raw.githubusercontent.com/simomounir/amr-cloud-pipeline/main/nextflow_schema.json",
    "title": "amr-cloud-pipeline parameters",
    "type": "object",
    "properties": {
        "input": {
            "type": "string",
            "format": "file-path",
            "exists": true,
            "schema": "assets/schema_input.json",
            "pattern": "^\\S+\\.csv$",
            "description": "Samplesheet CSV (sample,fastq_1,fastq_2,sample_type,organism)"
        },
        "outdir": {
            "type": "string",
            "format": "directory-path",
            "description": "Output directory"
        },
        "amrfinder_db": {
            "type": "string",
            "description": "AMRFinderPlus database directory or .tar.gz; downloaded when not set"
        },
        "amrtools_container": {
            "type": "string",
            "description": "Container image for amrtools"
        },
        "qc_min_assembly_length": {"type": "integer", "minimum": 0},
        "qc_max_assembly_length": {"type": "integer", "minimum": 0},
        "qc_max_contigs": {"type": "integer", "minimum": 1},
        "qc_min_q30": {"type": "number", "minimum": 0, "maximum": 1}
    },
    "required": ["input", "outdir"]
}
```

- [ ] **Step 8: Install nf-core modules**

```bash
export PATH="$HOME/.local/bin:$PATH" NXF_VER=26.04.6
for m in fastp shovill amrfinderplus/update amrfinderplus/run; do .venv/bin/nf-core modules install "$m"; done
ls modules/nf-core && test -f modules.json
```
Expected: `amrfinderplus fastp shovill` and `modules.json` present. If nf-core prompts, accept defaults. Do not edit anything under `modules/nf-core/`.

- [ ] **Step 9: Write `modules/local/kleborate/main.nf`**

```groovy
// nf-core's kleborate module pins v2.1.0; this runs Kleborate v3.
process KLEBORATE {
    tag "${meta.id}"
    label 'process_low'
    container 'quay.io/biocontainers/kleborate:3.2.4--pyhdfd78af_1'

    input:
    tuple val(meta), path(contigs)

    output:
    tuple val(meta), path("${meta.id}.kleborate.tsv"), emit: tsv

    script:
    """
    kleborate \\
        --assemblies ${contigs} \\
        --outdir kleborate_out \\
        --preset kpsc \\
        --trim_headers \\
        --no_hamronization \\
        --no_genotype_spec

    # Kleborate writes one file per detected species complex, or none when the
    # assembly is outside the preset. An empty file tells amrtools "no result".
    result=\$(find kleborate_out -name '*_output.txt' | head -n 1)
    if [ -n "\$result" ]; then
        cp "\$result" ${meta.id}.kleborate.tsv
    else
        touch ${meta.id}.kleborate.tsv
    fi
    """

    stub:
    """
    touch ${meta.id}.kleborate.tsv
    """
}
```

- [ ] **Step 10: Write `modules/local/amrtools/sample/main.nf`**

```groovy
process AMRTOOLS_SAMPLE {
    tag "${meta.id}"
    label 'process_single'
    container "${params.amrtools_container}"

    input:
    tuple val(meta), path(fastp_json), path(contigs), path(amrfinder_tsv), path(kleborate_tsv)
    val amrfinder_version
    val amrfinder_db_version

    output:
    tuple val(meta), path("${meta.id}.amr_genes.tsv"), emit: genes
    tuple val(meta), path("${meta.id}.run_summary.tsv"), emit: summary

    script:
    """
    amrtools sample \\
        --sample ${meta.id} \\
        --sample-type ${meta.sample_type} \\
        --organism ${meta.organism} \\
        --fastp-json ${fastp_json} \\
        --contigs ${contigs} \\
        --amrfinder ${amrfinder_tsv} \\
        --kleborate ${kleborate_tsv} \\
        --amrfinder-version '${amrfinder_version}' \\
        --amrfinder-db-version '${amrfinder_db_version}' \\
        --min-assembly-length ${params.qc_min_assembly_length} \\
        --max-assembly-length ${params.qc_max_assembly_length} \\
        --max-contigs ${params.qc_max_contigs} \\
        --min-q30 ${params.qc_min_q30}
    """

    stub:
    """
    amrtools stub \\
        --sample ${meta.id} \\
        --sample-type ${meta.sample_type} \\
        --organism ${meta.organism}
    """
}
```

- [ ] **Step 11: Write `modules/local/amrtools/merge/main.nf`** (no stub block: the real merge runs in `-stub` mode too)

```groovy
process AMRTOOLS_MERGE {
    label 'process_single'
    container "${params.amrtools_container}"

    input:
    path genes
    path summaries

    output:
    path 'amr_genes.tsv', emit: genes
    path 'run_summary.tsv', emit: summary

    script:
    """
    amrtools merge --genes ${genes} --summaries ${summaries}
    """
}
```

- [ ] **Step 12: Write `workflows/isolate.nf`**

```groovy
include { FASTP                } from '../modules/nf-core/fastp/main'
include { SHOVILL              } from '../modules/nf-core/shovill/main'
include { AMRFINDERPLUS_UPDATE } from '../modules/nf-core/amrfinderplus/update/main'
include { AMRFINDERPLUS_RUN    } from '../modules/nf-core/amrfinderplus/run/main'
include { KLEBORATE            } from '../modules/local/kleborate/main'
include { AMRTOOLS_SAMPLE      } from '../modules/local/amrtools/sample/main'
include { AMRTOOLS_MERGE       } from '../modules/local/amrtools/merge/main'

workflow ISOLATE {
    take:
    ch_samples // [meta, [fastq_1, fastq_2]]

    main:
    FASTP(ch_samples.map { meta, reads -> [meta, reads, []] }, false, false, false)
    SHOVILL(FASTP.out.reads)

    def ch_db = channel.empty()
    if (params.amrfinder_db) {
        ch_db = channel.value(file(params.amrfinder_db, checkIfExists: true))
    } else {
        AMRFINDERPLUS_UPDATE()
        ch_db = AMRFINDERPLUS_UPDATE.out.db.first()
    }

    AMRFINDERPLUS_RUN(SHOVILL.out.contigs, ch_db)
    KLEBORATE(SHOVILL.out.contigs)

    // [meta, fastp_json, contigs, amrfinder_tsv, kleborate_tsv]
    def ch_per_sample = FASTP.out.json
        .join(SHOVILL.out.contigs)
        .join(AMRFINDERPLUS_RUN.out.report)
        .join(KLEBORATE.out.tsv)

    AMRTOOLS_SAMPLE(
        ch_per_sample,
        AMRFINDERPLUS_RUN.out.tool_version.first(),
        AMRFINDERPLUS_RUN.out.db_version.first()
    )

    AMRTOOLS_MERGE(
        AMRTOOLS_SAMPLE.out.genes.map { meta, table -> table }.collect(),
        AMRTOOLS_SAMPLE.out.summary.map { meta, table -> table }.collect()
    )

    emit:
    genes   = AMRTOOLS_MERGE.out.genes
    summary = AMRTOOLS_MERGE.out.summary
}
```

- [ ] **Step 13: Write `main.nf`**

```groovy
#!/usr/bin/env nextflow

include { validateParameters; samplesheetToList } from 'plugin/nf-schema'
include { ISOLATE } from './workflows/isolate'

// Relative FASTQ paths resolve against the samplesheet's folder, not the launch folder.
def resolveFastq(value, samplesheetDir) {
    return value.contains('://') || value.startsWith('/') ? file(value) : samplesheetDir.resolve(value)
}

workflow {
    validateParameters()

    def samplesheetDir = file(params.input).parent
    def ch_samples = channel
        .fromList(samplesheetToList(params.input, "${projectDir}/assets/schema_input.json"))
        .map { meta, fastq_1, fastq_2 ->
            [meta + [single_end: false], [resolveFastq(fastq_1, samplesheetDir), resolveFastq(fastq_2, samplesheetDir)]]
        }

    ISOLATE(ch_samples)
}
```

- [ ] **Step 14: Create stub data and samplesheets**

```bash
mkdir -p tests/data/stub
for s in stub_a stub_b stub_c; do for r in 1 2; do
  printf '@%s_%s\nACGTACGTAC\n+\nIIIIIIIIII\n' "$s" "$r" | gzip -n > "tests/data/stub/${s}_R${r}.fastq.gz"
done; done
```

`tests/data/samplesheet_stub.csv`:
```csv
sample,fastq_1,fastq_2,sample_type,organism
stub_b,stub/stub_b_R1.fastq.gz,stub/stub_b_R2.fastq.gz,isolate,Klebsiella_pneumoniae
stub_a,stub/stub_a_R1.fastq.gz,stub/stub_a_R2.fastq.gz,isolate,Klebsiella_pneumoniae
stub_c,stub/stub_c_R1.fastq.gz,stub/stub_c_R2.fastq.gz,isolate,Klebsiella_pneumoniae
```

`tests/data/samplesheet_bad.csv` (unsafe name and a duplicate):
```csv
sample,fastq_1,fastq_2,sample_type,organism
bad name;rm,stub/stub_a_R1.fastq.gz,stub/stub_a_R2.fastq.gz,isolate,Klebsiella_pneumoniae
stub_b,stub/stub_b_R1.fastq.gz,stub/stub_b_R2.fastq.gz,isolate,Klebsiella_pneumoniae
stub_b,stub/stub_b_R1.fastq.gz,stub/stub_b_R2.fastq.gz,isolate,Klebsiella_pneumoniae
```

- [ ] **Step 15: Write `nf-test.config` and the failing pipeline tests** `tests/nf-test/pipeline.nf.test`

`nf-test.config`:
```groovy
config {
    testsDir "tests"
    workDir ".nf-test"
}
```

`tests/nf-test/pipeline.nf.test`:
```groovy
nextflow_pipeline {

    name "Isolate pipeline"
    script "../../main.nf"

    test("stub run gives one summary row per sample, sorted") {
        tag "stub"
        options "-stub"

        when {
            params {
                input  = "${baseDir}/tests/data/samplesheet_stub.csv"
                outdir = "$outputDir"
            }
        }

        then {
            assert workflow.success
            def summary = path("$outputDir/summary/run_summary.tsv").readLines()
            assert summary.size() == 4
            assert summary.drop(1).collect { it.split('\t')[0] } == ['stub_a', 'stub_b', 'stub_c']
            assert path("$outputDir/summary/amr_genes.tsv").exists()
        }
    }

    test("samplesheet with unsafe or duplicate sample names is rejected") {
        tag "validation"
        options "-stub"

        when {
            params {
                input  = "${baseDir}/tests/data/samplesheet_bad.csv"
                outdir = "$outputDir"
            }
        }

        then {
            assert workflow.failed
            assert workflow.stdout.join('\n').contains('sample may only contain')
            assert workflow.trace.tasks().size() == 0
        }
    }
}
```

- [ ] **Step 16: Run the tests**

```bash
export PATH="$HOME/.local/bin:$PATH" NXF_VER=26.04.6
docker image inspect ghcr.io/simomounir/amrtools:0.1.0 >/dev/null || docker build --platform linux/amd64 -f containers/amrtools/Dockerfile -t ghcr.io/simomounir/amrtools:0.1.0 .
nf-test test tests/ --tag stub,validation --profile test,docker
```
Expected: `2 passed`. First run pulls the tool images (several minutes on M1). If the validation test fails only on the message check, print `workflow.stdout` in the test temporarily, align the expected substring with what nf-schema prints for the `errorMessage`, then remove the print.

- [ ] **Step 17: Run lint and commit**

```bash
.venv/bin/pre-commit run --all-files
git add .nf-core.yml nextflow.config conf nextflow_schema.json assets main.nf workflows modules modules.json nf-test.config tests/nf-test tests/data
git commit -m "feat: Nextflow isolate pipeline with stub and validation tests"
```

---

### Task 9: Tiny test dataset, GitHub repo and full test

> Outward-facing steps (repo creation, push, Release) need the user's explicit go-ahead in-session.

**Files:**
- Create: `tests/data/make_test_data.sh`, `tests/data/samplesheet_test.csv`, `tests/data/README.md`
- Modify: `tests/nf-test/pipeline.nf.test` (add full test)

**Interfaces:**
- Consumes: pipeline from Task 8
- Produces: GitHub repo `simomounir/amr-cloud-pipeline`; Release `test-data-v1` with six files `<run>_R{1,2}.fastq.gz` for SRR5386028, ERR14097885, SRR33580217; nf-test tag `full`; env var `AMRFINDER_DB` (optional path to a database tarball)

- [ ] **Step 1: Write `tests/data/make_test_data.sh`**

```bash
#!/usr/bin/env bash
# Rebuilds the subsampled reads published as GitHub Release "test-data-v1".
# Usage: tests/data/make_test_data.sh [output_dir]
set -euo pipefail

OUT=${1:-test-data}
TARGET_BASES=110000000 # ~20x of a 5.5 Mb K. pneumoniae genome
SEED=42
SEQTK_IMAGE=quay.io/biocontainers/seqtk:1.5--h577a1d6_1
RUNS=(SRR5386028 ERR14097885 SRR33580217)

mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)

for run in "${RUNS[@]}"; do
    report=$(curl -sf "https://www.ebi.ac.uk/ena/portal/api/filereport?accession=${run}&result=read_run&fields=base_count,fastq_ftp&format=tsv" | tail -n 1)
    bases=$(cut -f2 <<<"$report")
    urls=$(cut -f3 <<<"$report" | tr ';' '\n')
    fraction=$(python3 -c "print(min(1.0, ${TARGET_BASES} / ${bases}))")
    echo "${run}: ${bases} bases, keeping fraction ${fraction}"

    for mate in 1 2; do
        url=$(grep "_${mate}.fastq.gz$" <<<"$urls")
        curl -sfL "https://${url}" -o "${OUT}/${run}_full_R${mate}.fastq.gz"
        # Same seed for both mates keeps read pairs together.
        docker run --rm --platform linux/amd64 -v "${OUT}:/data" -w /data "$SEQTK_IMAGE" \
            sh -c "seqtk sample -s ${SEED} ${run}_full_R${mate}.fastq.gz ${fraction} | gzip -n > ${run}_R${mate}.fastq.gz"
        rm "${OUT}/${run}_full_R${mate}.fastq.gz"
    done
done

ls -lh "$OUT"
```

- [ ] **Step 2: Generate the data**

```bash
chmod +x tests/data/make_test_data.sh
tests/data/make_test_data.sh test-data
```
Expected: six `*_R{1,2}.fastq.gz` files, each roughly 15–45 MB. Downloads ~1.2 GB in total; takes a while.

- [ ] **Step 3: Write `tests/data/samplesheet_test.csv`**

```csv
sample,fastq_1,fastq_2,sample_type,organism
SRR5386028,https://github.com/simomounir/amr-cloud-pipeline/releases/download/test-data-v1/SRR5386028_R1.fastq.gz,https://github.com/simomounir/amr-cloud-pipeline/releases/download/test-data-v1/SRR5386028_R2.fastq.gz,isolate,Klebsiella_pneumoniae
ERR14097885,https://github.com/simomounir/amr-cloud-pipeline/releases/download/test-data-v1/ERR14097885_R1.fastq.gz,https://github.com/simomounir/amr-cloud-pipeline/releases/download/test-data-v1/ERR14097885_R2.fastq.gz,isolate,Klebsiella_pneumoniae
SRR33580217,https://github.com/simomounir/amr-cloud-pipeline/releases/download/test-data-v1/SRR33580217_R1.fastq.gz,https://github.com/simomounir/amr-cloud-pipeline/releases/download/test-data-v1/SRR33580217_R2.fastq.gz,isolate,Klebsiella_pneumoniae
```

- [ ] **Step 4: Write `tests/data/README.md`**

```markdown
# Test data

## Tiny dataset (GitHub Release `test-data-v1`)

Three *Klebsiella pneumoniae* Illumina paired-end runs, subsampled to ~20x with
seqtk (seed 42) by `make_test_data.sh`. Reads are not stored in git.

| Run | Platform | Expected species | Expected ST | Carbapenemase |
|---|---|---|---|---|
| SRR5386028 | NextSeq 500 | Klebsiella pneumoniae | ST13 | KPC-2 |
| ERR14097885 | MiSeq | Klebsiella pneumoniae | ST147 | NDM-5 |
| SRR33580217 | NextSeq 2000 | Klebsiella pneumoniae | ST23 | none |

Expected values come from Kleborate's own test outputs
(klebgenomics/Kleborate, `test/kpsc_test/example_output`, commit f5b116a).
These are public data: results demonstrate the method, not new findings.

## Stub dataset (`stub/`)

One fake read per file, used only by `-stub` runs to check pipeline wiring.
```

- [ ] **Step 5: Ask the user for go-ahead, then create the repo and push**

Confirm with the user first. Then:
```bash
gh repo create simomounir/amr-cloud-pipeline --public --source . --remote origin --description "AMR detection pipeline for bacterial isolates: Nextflow, Docker, AWS Batch"
git add tests/data/make_test_data.sh tests/data/samplesheet_test.csv tests/data/README.md
git commit -m "test: tiny K. pneumoniae dataset definition"
git push -u origin main
```

- [ ] **Step 6: Publish the Release (after go-ahead)**

```bash
gh release create test-data-v1 test-data/*.fastq.gz \
  --title "Test data v1" \
  --notes "Subsampled (~20x) K. pneumoniae reads for CI. Rebuild with tests/data/make_test_data.sh."
curl -sfIL https://github.com/simomounir/amr-cloud-pipeline/releases/download/test-data-v1/SRR5386028_R1.fastq.gz | grep -i '^HTTP' | tail -1
```
Expected: `HTTP/2 200`.

- [ ] **Step 7: Add the full test to `tests/nf-test/pipeline.nf.test`** (inside `nextflow_pipeline { }`, after the validation test)

```groovy
    test("tiny dataset gives expected species, ST and carbapenemases") {
        tag "full"

        when {
            params {
                outdir = "$outputDir"
                if (System.getenv("AMRFINDER_DB")) {
                    amrfinder_db = System.getenv("AMRFINDER_DB")
                }
            }
        }

        then {
            assert workflow.success

            def readTsv = { file ->
                def lines = file.readLines()
                def header = lines[0].split('\t', -1) as List
                lines.drop(1).collect { line -> [header, line.split('\t', -1) as List].transpose().collectEntries() }
            }
            def summary = readTsv(path("$outputDir/summary/run_summary.tsv")).collectEntries { [it.sample, it] }
            def genes = readTsv(path("$outputDir/summary/amr_genes.tsv"))
            def symbols = { sample -> genes.findAll { it.sample == sample }*.gene_symbol }

            assert summary.keySet() == ['ERR14097885', 'SRR33580217', 'SRR5386028'] as Set
            assert summary.values().every { it.kleborate_species == 'Klebsiella pneumoniae' }
            assert summary.SRR5386028.st == 'ST13'
            assert summary.ERR14097885.st == 'ST147'
            assert summary.SRR33580217.st == 'ST23'
            assert symbols('SRR5386028').any { it.startsWith('blaKPC') }
            assert symbols('ERR14097885').any { it.startsWith('blaNDM') }
            assert !symbols('SRR33580217').any { it ==~ /blaKPC.*|blaNDM.*|blaOXA-48.*/ }
        }
    }
```

- [ ] **Step 8: Run the full test**

```bash
export PATH="$HOME/.local/bin:$PATH" NXF_VER=26.04.6
nf-test test tests/ --tag full --profile test,docker
```
Expected: `1 passed`. On the M1 this is slow (emulated amd64, roughly 30–90 min). If it runs out of memory, raise Docker Desktop memory. If it is impractically slow, skip to Task 10 and let CI's `full` job be the first real run, then come back here if it fails.

If an ST assertion fails (e.g. `ST13-1LV`), do not loosen the test. Check `n_contigs`, `n50` and Kleborate's allele columns in `${outdir}/kleborate/`; low coverage at an MLST locus means `TARGET_BASES` should rise (e.g. 30x = 165000000), the data rebuilt and re-released as `test-data-v2`.

- [ ] **Step 9: Commit and push**

```bash
git add tests/nf-test/pipeline.nf.test
git commit -m "test: full pipeline test on tiny K. pneumoniae dataset"
git push
```

---

### Task 10: CI and image publishing

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: nf-test tags `stub`, `validation`, `full`; amrtools Dockerfile; GitHub repo from Task 9
- Produces: CI jobs `lint`, `unit`, `stub`, `full`, `publish-image`; public image `ghcr.io/simomounir/amrtools:0.1.0` and `:latest`

- [ ] **Step 1: Write `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
  pull_request:
  workflow_dispatch:

permissions:
  contents: read

env:
  NXF_VER: "26.04.6"
  NFT_VER: "0.9.5"
  AMRTOOLS_IMAGE: ghcr.io/simomounir/amrtools:0.1.0

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - uses: actions/setup-python@v7
        with:
          python-version: "3.12"
      - run: pip install pre-commit && pre-commit run --all-files --show-diff-on-failure
      - uses: gitleaks/gitleaks-action@v3
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-python@v7
        with:
          python-version: "3.12"
      - run: pip install -e ".[dev]"
      - run: pytest -q

  stub:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-java@v6
        with:
          distribution: temurin
          java-version: "21"
      - uses: nf-core/setup-nextflow@v3
        with:
          version: ${{ env.NXF_VER }}
      - name: Install nf-test
        run: |
          curl -fsSL https://get.nf-test.com | bash -s "$NFT_VER"
          sudo mv nf-test /usr/local/bin/
      - name: Build amrtools image
        run: docker build -f containers/amrtools/Dockerfile -t "$AMRTOOLS_IMAGE" .
      - run: nf-test test tests/ --tag stub,validation --profile test,docker

  full:
    if: github.event_name == 'workflow_dispatch' || (github.event_name == 'push' && github.ref == 'refs/heads/main')
    needs: [unit, stub]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-java@v6
        with:
          distribution: temurin
          java-version: "21"
      - uses: nf-core/setup-nextflow@v3
        with:
          version: ${{ env.NXF_VER }}
      - name: Install nf-test
        run: |
          curl -fsSL https://get.nf-test.com | bash -s "$NFT_VER"
          sudo mv nf-test /usr/local/bin/
      - name: Build amrtools image
        run: docker build -f containers/amrtools/Dockerfile -t "$AMRTOOLS_IMAGE" .
      - name: Weekly AMRFinderPlus database cache key
        id: dbkey
        run: echo "week=$(date -u +%G-%V)" >> "$GITHUB_OUTPUT"
      - uses: actions/cache@v6
        id: dbcache
        with:
          path: amrfinderdb.tar.gz
          key: amrfinderdb-4.2.7-${{ steps.dbkey.outputs.week }}
      - name: Download AMRFinderPlus database
        if: steps.dbcache.outputs.cache-hit != 'true'
        run: |
          docker run --rm -v "$PWD:/work" -w /work quay.io/biocontainers/ncbi-amrfinderplus:4.2.7--hf69ffd2_0 \
            sh -c 'amrfinder_update -d amrfinderdb && tar czf amrfinderdb.tar.gz -C "amrfinderdb/$(readlink amrfinderdb/latest)" . && rm -rf amrfinderdb'
      - name: Full test on tiny dataset
        env:
          AMRFINDER_DB: ${{ github.workspace }}/amrfinderdb.tar.gz
        run: nf-test test tests/ --tag full --profile test,docker
      - uses: actions/upload-artifact@v7
        if: always()
        with:
          name: tiny-dataset-results
          path: .nf-test/tests/*/output/summary/
          if-no-files-found: warn

  publish-image:
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    needs: [unit, stub]
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v7
      - uses: docker/login-action@v4
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v7
        with:
          context: .
          file: containers/amrtools/Dockerfile
          platforms: linux/amd64
          push: true
          tags: |
            ghcr.io/simomounir/amrtools:0.1.0
            ghcr.io/simomounir/amrtools:latest
```

- [ ] **Step 2: Lint locally, commit, push**

```bash
.venv/bin/pre-commit run --all-files
git add .github/workflows/ci.yml
git commit -m "ci: lint, unit, stub, full tiny-dataset run and image publishing"
git push
```

- [ ] **Step 3: Watch the run**

```bash
gh run watch --exit-status "$(gh run list --branch main --limit 1 --json databaseId -q '.[0].databaseId')"
```
Expected: all five jobs succeed. On failure: `gh run view --log-failed`, fix with the systematic-debugging skill, push again.

- [ ] **Step 4: Make the image public**

GHCR packages start private. Ask the user to open `https://github.com/users/simomounir/packages/container/amrtools/settings` → Change visibility → Public (and link it to the repo if not already). Then verify:
```bash
docker logout ghcr.io; docker pull --platform linux/amd64 ghcr.io/simomounir/amrtools:0.1.0
```
Expected: pull succeeds without login.

---

### Task 11: README and done check

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: everything above

- [ ] **Step 1: Replace `README.md`**

````markdown
# AMR Cloud Pipeline

[![CI](https://github.com/simomounir/amr-cloud-pipeline/actions/workflows/ci.yml/badge.svg)](https://github.com/simomounir/amr-cloud-pipeline/actions/workflows/ci.yml)

Detects antimicrobial-resistance genes in bacterial isolate genomes. A Nextflow
pipeline built to run the same way on a laptop, in CI and on AWS Batch.

> Uses public data. Results demonstrate a method, not new surveillance findings.

## What it does

```
reads (Illumina, paired) → fastp → Shovill → AMRFinderPlus ─┐
                                          └→ Kleborate ─────┴→ amrtools → amr_genes.tsv
                                                                         run_summary.tsv
```

| Output | One row per | Contents |
|---|---|---|
| `summary/amr_genes.tsv` | detected gene or mutation | gene, drug class, identity, coverage, tool and database versions |
| `summary/run_summary.tsv` | sample | species, sequence type, resistance/virulence scores, read and assembly QC, `qc_status` |

Samples failing QC thresholds are flagged `warn` with reasons, never dropped.

## Run it

Requirements: Docker, Java 17+, Nextflow ≥ 25.04.

```bash
nextflow run . -profile test,docker            # tiny K. pneumoniae dataset
nextflow run . -profile docker --input samples.csv --outdir results
```

Samplesheet:

```csv
sample,fastq_1,fastq_2,sample_type,organism
S1,reads/S1_R1.fastq.gz,reads/S1_R2.fastq.gz,isolate,Klebsiella_pneumoniae
```

Relative paths resolve against the samplesheet's folder. Pass
`--amrfinder_db <dir or .tar.gz>` to pin an AMRFinderPlus database; otherwise the
latest is downloaded.

On Apple Silicon, containers run as `linux/amd64` under emulation: give Docker
Desktop at least 8 GB of memory and expect slow assemblies.

## Tests

| Layer | Command | Runs in CI |
|---|---|---|
| Python unit tests | `pytest` | every push |
| Pipeline wiring (stub) and input validation | `nf-test test tests/ --tag stub,validation --profile test,docker` | every push |
| Full tiny-dataset run | `nf-test test tests/ --tag full --profile test,docker` | push to main |

Test data: see [tests/data/README.md](tests/data/README.md).

## Roadmap

1. **Phase 1 (this):** local pipeline, tests, CI
2. Phase 2: versioned Parquet results schema
3. Phase 3: static dashboard (DuckDB-WASM on GitHub Pages)
4. Phase 4: AWS Batch with Terraform, real cost per sample
5. Phase 6: metagenome mode on the same platform

Project brief: [docs/amr-cloud-pipeline-project.md](docs/amr-cloud-pipeline-project.md).
````

- [ ] **Step 2: Done-criteria check (spec section 11)**

```bash
gh run list --branch main --limit 1
.venv/bin/pytest -q
```
Expected: latest main run `completed success` with all jobs green; pytest all passing. Confirm the `full` job's `tiny-dataset-results` artifact contains both tables.

- [ ] **Step 3: Commit and push**

```bash
.venv/bin/pre-commit run --all-files
git add README.md
git commit -m "docs: README for Phase 1"
git push
```
