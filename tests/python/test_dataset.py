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
    args = ["build-dataset", str(run1(tmp_path)), str(run2(tmp_path)), "--out", str(out)]
    assert main(args) == 0
    assert (out / "manifest.json").exists()
