"""scripts/publish-dataset.sh with a fake gh: builds the dataset from a Cloud run artifact,
creates the release and pins it for the site (the commit that follows deploys it)."""

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
    pin = tmp_path / "dataset.txt"
    pin.write_text("dataset-2026-10-08\n")
    env = {**os.environ, "PATH": f"{bin_dir}:{ROOT / '.venv' / 'bin'}:{os.environ['PATH']}",
           "FAKE_LOG": str(tmp_path / "gh.log"), "FAKE_ARTIFACT": str(tmp_path / "artifact"),
           "FAKE_ASSETS": str(tmp_path / "assets.txt"), "DATASET_PIN": str(pin)}  # fmt: skip
    return env, pin


def test_cloud_run_artifact_is_built_released_and_pinned(tmp_path):
    env, pin = _setup(tmp_path)
    proc = subprocess.run(["bash", str(SCRIPT), "123", "cloud-run-study-x-123"], env=env,
                          capture_output=True, text=True, timeout=120)  # fmt: skip
    assert proc.returncode == 0, proc.stdout + proc.stderr
    tag = pin.read_text().strip()
    assert tag.startswith("dataset-") and tag != "dataset-2026-10-08"
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
    assert pin.read_text().strip() == "dataset-2026-10-08"
    assert "release create" not in (tmp_path / "gh.log").read_text()
