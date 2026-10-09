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
        "isolation_source_raw", "source_category", "host", "analysis_status", "run_id",
        "run_started_at",
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
        "source_category": "urine", "analysis_status": "complete", "run_id": "r1",
        "run_started_at": datetime(2026, 10, 7, tzinfo=UTC),
    }  # fmt: skip
    path = tmp_path / "samples.parquet"
    write_table(build_table([record], SAMPLES), path)
    table = pq.read_table(path)
    assert table.schema.metadata[b"schema_version"] == SCHEMA_VERSION.encode()
    assert table.schema.equals(SAMPLES, check_metadata=False)
    assert table.column("collection_year").to_pylist() == [2014]
