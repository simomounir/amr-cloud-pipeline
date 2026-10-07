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
    # Parquet refuses nulls in a required column, so write the file the way a
    # foreign writer would: with the column marked optional.
    run = good_run(tmp_path)
    relaxed = pa.schema(
        [f.with_nullable(True) if f.name == "source_category" else f for f in SAMPLES]
    )
    records = [sample_record("S1", source_category=None), sample_record("S2")]
    table = pa.Table.from_pylist(records, schema=relaxed)
    pq.write_table(table.replace_schema_metadata({"schema_version": "1.0.0"}),
                   run / "samples.parquet")  # fmt: skip
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
