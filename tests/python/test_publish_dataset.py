"""scripts/publish-dataset.sh with a fake gh: builds the dataset from a Cloud run artifact,
creates the release and pins it for the site (the commit that follows deploys it)."""

import json
import os
import subprocess
from pathlib import Path

from dataset_helpers import gene_record, sample_record, summary_record, write_run

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "publish-dataset.sh"

FAKE_GH = """#!/usr/bin/env bash
echo "gh $*" >> "$FAKE_LOG"
case "$1 $2" in
  "release view") exit 1 ;;   # tag does not exist yet
  "run download")
    dir=$(printf '%s\\n' "$@" | grep -A1 -- '^--dir$' | tail -1)
    mkdir -p "$dir" && cp -R "$FAKE_ARTIFACT/." "$dir/" ;;
  "release create")
    for a in "$@"; do if [ -f "$a" ]; then basename "$a" >> "$FAKE_ASSETS"; fi; done ;;
esac
"""


def _setup(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    (bin_dir / "gh").write_text(FAKE_GH)
    (bin_dir / "gh").chmod(0o755)
    run = tmp_path / "artifact" / "study-x" / "20261009T104928Z" / "results" / "parquet"
    write_run(run, [sample_record("S1"), sample_record("S2", analysis_status="failed")],
              [gene_record("S1")], [summary_record("S1")])  # fmt: skip
    pin = tmp_path / "studies.json"
    pin.write_text(json.dumps([{"study": "other", "release": "dataset-other-2026-10-01"}]))
    env = {**os.environ, "PATH": f"{bin_dir}:{ROOT / '.venv' / 'bin'}:{os.environ['PATH']}",
           "FAKE_LOG": str(tmp_path / "gh.log"), "FAKE_ARTIFACT": str(tmp_path / "artifact"),
           "FAKE_ASSETS": str(tmp_path / "assets.txt"), "STUDIES_PIN": str(pin)}  # fmt: skip
    return env, pin


def test_cloud_run_artifact_is_built_released_and_pinned(tmp_path):
    env, pin = _setup(tmp_path)
    proc = subprocess.run(["bash", str(SCRIPT), "123", "cloud-run-study-x-123"], env=env,
                          capture_output=True, text=True, timeout=120)  # fmt: skip
    assert proc.returncode == 0, proc.stdout + proc.stderr
    entries = json.loads(pin.read_text())
    assert [e["study"] for e in entries] == ["other", "site"]  # appended
    tag = entries[1]["release"]
    assert tag.startswith("dataset-") and tag != "dataset-other-2026-10-01"
    assets = sorted((tmp_path / "assets.txt").read_text().split())
    tables = ["amr_genes.parquet", "manifest.json", "run_summary.parquet", "samples.parquet"]
    assert assets == tables
    assert f"release create {tag}" in (tmp_path / "gh.log").read_text()
    assert "commit" in proc.stdout  # tells you the commit is what deploys the site


def test_dry_run_changes_nothing(tmp_path):
    env, pin = _setup(tmp_path)
    proc = subprocess.run(["bash", str(SCRIPT), "--dry-run", "123", "cloud-run-study-x-123"],
                          env=env, capture_output=True, text=True, timeout=120)  # fmt: skip
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert json.loads(pin.read_text()) == [
        {"study": "other", "release": "dataset-other-2026-10-01"}
    ]
    assert "release create" not in (tmp_path / "gh.log").read_text()


def _study_setup(tmp_path):
    env, _ = _setup(tmp_path)
    run = next((tmp_path / "artifact").rglob("results")).parent
    (run / "cost.json").write_text(json.dumps({"summary": {"instances": 1, "instance_hours": 0.5,
        "total_usd": 0.05, "samples": 2, "per_sample_usd": 0.025}}))  # fmt: skip
    (run / "trace.tsv").write_text("task_id\tname\tstatus\tsubmit\tduration\n"
                                   "1\tX\tCOMPLETED\t2026-10-09 10:00:00.000\t5m 0s\n")  # fmt: skip
    study = tmp_path / "studies" / "study-x"
    study.mkdir(parents=True)
    (study / "study.yaml").write_text(
        "title: t\norganism: Klebsiella_pneumoniae\nmax_isolates: 5\n"
    )
    story = "---\ntitle: T\nquestion: Q?\nfocus: f\n---\n## Background\nB.\n\n"
    (study / "story.md").write_text(story + "## Findings\n### F {#heatmap}\nT.\n")
    pin = tmp_path / "studies.json"
    pin.write_text(json.dumps([{"study": "other", "release": "dataset-other-2026-10-01"},
                               {"study": "study-x", "release": "dataset-2026-10-09"}]))  # fmt: skip
    env |= {"STUDIES_PIN": str(pin), "STUDIES_DIR": str(tmp_path / "studies")}
    return env, pin


def test_study_release_carries_bundle_and_updates_studies_json(tmp_path):
    env, pin = _study_setup(tmp_path)
    cmd = ["bash", str(SCRIPT), "--study", "study-x", "123", "cloud-run-study-x-123"]
    proc = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=120)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    entries = json.loads(pin.read_text())
    assert [e["study"] for e in entries] == ["other", "study-x"]  # replaced in place
    tag = entries[1]["release"]
    assert tag.startswith("dataset-study-x-")
    assets = sorted((tmp_path / "assets.txt").read_text().split())
    assert assets == ["amr_genes.parquet", "cohort.parquet", "manifest.json",
                      "run_summary.parquet", "samples.parquet", "study.json"]  # fmt: skip


def test_study_needs_a_story(tmp_path):
    env, _ = _study_setup(tmp_path)
    (tmp_path / "studies" / "study-x" / "story.md").unlink()
    cmd = ["bash", str(SCRIPT), "--study", "study-x", "123", "cloud-run-study-x-123"]
    proc = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=120)
    assert proc.returncode != 0 and "story.md" in proc.stderr


def test_study_name_must_be_a_plain_slug(tmp_path):
    env, _ = _study_setup(tmp_path)
    for bad in ("../x", "Study", "-x", "a b"):
        cmd = ["bash", str(SCRIPT), "--study", bad, "123", "cloud-run-study-x-123"]
        proc = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=120)
        assert proc.returncode == 2 and "--study" in proc.stderr, bad
