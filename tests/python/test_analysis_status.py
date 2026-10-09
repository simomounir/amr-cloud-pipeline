"""samples.analysis_status (schema 1.2.0): which samples produced results and which failed."""

import pyarrow as pa
import pyarrow.parquet as pq
import pytest
from dataset_helpers import gene_record, sample_record, summary_record, write_run
from test_export import STARTED, merged_tables

from amrtools.dataset import build_dataset
from amrtools.export import export_run
from amrtools.schema import SAMPLES
from amrtools.validate import DatasetError, validate_dir

SHEET = (
    "sample,fastq_1,fastq_2,sample_type,organism\n"
    "S1,a_1.fastq.gz,a_2.fastq.gz,isolate,Klebsiella_pneumoniae\n"
    "S2,b_1.fastq.gz,b_2.fastq.gz,isolate,Klebsiella_pneumoniae\n"
)


def test_export_marks_samples_without_results_as_failed(tmp_path):
    sheet = tmp_path / "sheet.csv"
    sheet.write_text(SHEET)
    genes, summary = merged_tables(tmp_path, ["S1"])  # S2 failed: no results
    tables = export_run(
        samplesheet=sheet,
        genes_tsv=genes,
        summary_tsv=summary,
        run_id="session-1",
        run_started_at=STARTED,
        outdir=tmp_path / "pq",
    )
    status = dict(
        zip(
            tables["samples"].column("sample").to_pylist(),
            tables["samples"].column("analysis_status").to_pylist(),
            strict=True,
        )
    )
    assert status == {"S1": "complete", "S2": "failed"}


def test_complete_sample_without_summary_is_refused(tmp_path):
    run = write_run(
        tmp_path / "r", [sample_record("S1"), sample_record("S2")], [], [summary_record("S1")]
    )
    with pytest.raises(DatasetError, match="S2.*complete"):
        validate_dir(run)


def test_failed_sample_with_summary_is_refused(tmp_path):
    run = write_run(
        tmp_path / "r", [sample_record("S1", analysis_status="failed")], [], [summary_record("S1")]
    )
    with pytest.raises(DatasetError, match="S1.*failed"):
        validate_dir(run)


def test_unknown_status_is_refused(tmp_path):
    run = write_run(
        tmp_path / "r", [sample_record("S1", analysis_status="maybe")], [], [summary_record("S1")]
    )
    with pytest.raises(DatasetError, match="analysis_status"):
        validate_dir(run)


def _downgrade_to_1_1(run):
    """Rewrite samples.parquet as schema 1.1.0 wrote it: no analysis_status column."""
    path = run / "samples.parquet"
    table = pq.read_table(path).drop_columns(["analysis_status"])
    pq.write_table(table.replace_schema_metadata({"schema_version": "1.1.0"}), path)


def test_v1_1_runs_are_read_with_a_derived_status(tmp_path):
    run = write_run(
        tmp_path / "r",
        [sample_record("S1"), sample_record("S2")],
        [gene_record("S1")],
        [summary_record("S1")],
    )
    _downgrade_to_1_1(run)
    tables = validate_dir(run)
    assert tables["samples"].column("analysis_status").to_pylist() == ["complete", "failed"]
    assert tables["samples"].schema.names == SAMPLES.names


def test_build_dataset_upgrades_v1_1_inputs(tmp_path):
    run = write_run(
        tmp_path / "r", [sample_record("S1")], [gene_record("S1")], [summary_record("S1")]
    )
    _downgrade_to_1_1(run)
    build_dataset([run], tmp_path / "ds")
    samples = pq.read_table(tmp_path / "ds" / "samples.parquet")
    assert samples.schema.metadata[b"schema_version"] == b"1.2.0"
    assert samples.column("analysis_status").to_pylist() == ["complete"]
    assert pa.types.is_string(samples.schema.field("analysis_status").type)
