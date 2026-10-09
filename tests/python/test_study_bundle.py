"""amrtools study-bundle: cohort.parquet and study.json for a study release."""

import json
from pathlib import Path

import pyarrow.parquet as pq
import pytest
from dataset_helpers import gene_record, sample_record, summary_record, write_run

from amrtools.cli import main
from amrtools.study import build_bundle, family_of, parse_story

STORY = """---
title: Carbapenemases in clones
question: Which families travel with which clones?
focus: carbapenemases
---
## Background
First *paragraph*.

Second paragraph.

## Findings
### Each clone has a signature carbapenemase {#heatmap}
ST258 carries KPC.

### A finding without a figure
Text.
"""

YAML = """title: t
organism: Klebsiella_pneumoniae
max_isolates: 10
reference_name: Pathogenwatch (AMRnet)
reference_st_column: amrnet_st
reference_carbapenemases_column: amrnet_carbapenemases
"""

COHORT = """run_accession,clone,period,year,country,amrnet_st,amrnet_carbapenemases
S1,ST258/512,2013-2017,2015,Greece,ST258,KPC-2
S2,ST147,2018 or later,2019,India,ST147,-
S3,ST147,2018 or later,2020,India,ST147,NDM-1
"""

TRACE = (
    "task_id\tname\tstatus\tsubmit\tduration\n"
    "1\tISOLATE:FASTP (S1)\tCOMPLETED\t2026-10-09 10:00:00.000\t2m 0s\n"
    "2\tISOLATE:SHOVILL (S1)\tCOMPLETED\t2026-10-09 10:30:00.000\t1h 5m 30s\n"
)


def _study(tmp_path, cohort=True) -> Path:
    d = tmp_path / "studies" / "demo"
    d.mkdir(parents=True)
    (d / "story.md").write_text(STORY)
    (d / "study.yaml").write_text(YAML)
    if cohort:
        (d / "cohort.csv").write_text(COHORT)
    return d


def _dataset(tmp_path) -> Path:
    samples = [sample_record("S1"), sample_record("S2"),
               sample_record("S3", analysis_status="failed")]  # fmt: skip
    genes = [gene_record("S1", gene_symbol="blaKPC-2"),
             gene_record("S2", gene_symbol="blaNDM-1")]  # S2: we find NDM, AMRnet none  # fmt: skip
    summaries = [summary_record("S1", st="ST258"), summary_record("S2", st="ST11")]
    return write_run(tmp_path / "ds", samples, genes, summaries)


def _run_dir(tmp_path) -> Path:
    r = tmp_path / "run"
    r.mkdir()
    (r / "cost.json").write_text(json.dumps({"summary": {
        "instances": 2, "instance_hours": 1.5, "total_usd": 0.12, "samples": 3,
        "per_sample_usd": 0.04}}))  # fmt: skip
    (r / "trace.tsv").write_text(TRACE)
    return r


def test_parse_story():
    story = parse_story(STORY)
    assert story["title"] == "Carbapenemases in clones"
    assert story["focus"] == "carbapenemases"
    assert story["background"] == ["First *paragraph*.", "Second paragraph."]
    assert story["findings"] == [
        {"id": "each-clone-has-a-signature-carbapenemase", "figure": "heatmap",
         "title": "Each clone has a signature carbapenemase", "text": "ST258 carries KPC."},
        {"id": "a-finding-without-a-figure", "figure": None,
         "title": "A finding without a figure", "text": "Text."},
    ]  # fmt: skip


def test_story_with_unknown_figure_is_refused():
    with pytest.raises(ValueError, match="figure"):
        parse_story(STORY.replace("{#heatmap}", "{#pie}"))


@pytest.mark.parametrize(("symbol", "family"), [
    ("blaKPC-2", "KPC"), ("blaNDM-5", "NDM"), ("blaOXA-48", "OXA-48-like"),
    ("blaOXA-232", "OXA-48-like"), ("blaVIM-1", "VIM"), ("blaIMP-4", "IMP"), ("blaGES-5", "other"),
])  # fmt: skip
def test_family_of(symbol, family):
    assert family_of(symbol) == family


def test_bundle_writes_cohort_and_study_json(tmp_path):
    out = tmp_path / "out"
    info = build_bundle(_study(tmp_path), _dataset(tmp_path), _run_dir(tmp_path), out)
    cohort = pq.read_table(out / "cohort.parquet").to_pylist()
    assert cohort[0] == {"sample": "S1", "clone": "ST258/512", "period": "2013-2017", "year": 2015,
                         "country": "Greece", "ref_st": "ST258",
                         "ref_carbapenemases": "KPC-2"}  # fmt: skip
    assert json.loads((out / "study.json").read_text()) == info
    assert info["study"] == "demo" and info["reference"] == {"name": "Pathogenwatch (AMRnet)"}
    assert info["run"]["selected"] == 3 and info["run"]["analysed"] == 2
    assert info["run"]["failed"] == ["S3"]
    assert info["run"]["cost_usd"] == 0.12 and info["run"]["instance_hours"] == 1.5
    assert info["run"]["wall_time_minutes"] == 96  # 10:00 -> 10:30 + 65.5 min, rounded
    agreement = info["agreement"]
    assert agreement["st"] == {"agree": 1, "total": 2}
    assert agreement["carbapenemase_family"] == {"agree": 1, "total": 2}
    assert {"sample": "S2", "field": "st", "ours": "ST11", "reference": "ST147"} in agreement[
        "disagreements"
    ]
    assert {"sample": "S2", "field": "carbapenemase_family", "ours": "NDM",
            "reference": "none"} in agreement["disagreements"]  # fmt: skip
    assert {"ours": "KPC", "reference": "KPC", "genomes": 1} in agreement["family_matrix"]
    assert info["versions"] == {"amrfinder": ["4.2.7"], "amrfinder_db": ["2026-09-30.1"]}


def test_study_without_cohort_or_run_dir(tmp_path):
    out = tmp_path / "out"
    info = build_bundle(_study(tmp_path, cohort=False), _dataset(tmp_path), None, out)
    cohort = pq.read_table(out / "cohort.parquet")
    assert cohort.column("sample").to_pylist() == ["S1", "S2", "S3"]
    assert cohort.column("clone").null_count == 3
    assert info["agreement"] is None
    assert info["run"]["cost_usd"] is None and info["run"]["wall_time_minutes"] is None


def test_cli(tmp_path):
    out = tmp_path / "out"
    args = ["study-bundle", "--study-dir", str(_study(tmp_path)), "--dataset",
            str(_dataset(tmp_path)), "--run-dir", str(_run_dir(tmp_path)),
            "--out", str(out)]  # fmt: skip
    assert main(args) == 0
    assert (out / "study.json").exists() and (out / "cohort.parquet").exists()
