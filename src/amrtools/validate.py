"""Check Parquet result folders against the results schema."""

import hashlib
import json
from collections import Counter
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from amrtools.errors import InputFormatError
from amrtools.schema import ALLOWED_VALUES, SAMPLES, SCHEMA_MAJOR, TABLES


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


def _upgrade(tables: dict[str, pa.Table]) -> None:
    """Read schema 1.0/1.1 samples tables as 1.2: derive analysis_status from run_summary.

    Those versions stopped the whole run on any failure, so every sample with a summary row
    completed and any other did not.
    """
    samples = tables["samples"]
    metadata = samples.schema.metadata or {}
    version = metadata.get(b"schema_version", b"").decode()
    if "analysis_status" in samples.schema.names or version not in ("1.0.0", "1.1.0"):
        return
    done = set(tables["run_summary"].column("sample").to_pylist())
    status = ["complete" if s in done else "failed" for s in samples.column("sample").to_pylist()]
    field = SAMPLES.field("analysis_status")
    upgraded = samples.add_column(SAMPLES.get_field_index(field.name), field, pa.array(status))
    tables["samples"] = upgraded.replace_schema_metadata(metadata)


def _check_status(directory: Path, tables: dict[str, pa.Table]) -> None:
    summarised = set(tables["run_summary"].column("sample").to_pylist())
    rows = tables["samples"].select(["sample", "analysis_status"]).to_pylist()
    for row in rows:
        if (row["analysis_status"] == "complete") != (row["sample"] in summarised):
            state = "has" if row["sample"] in summarised else "has no"
            raise DatasetError(
                f"{directory / 'samples.parquet'}: sample '{row['sample']}' is "
                f"{row['analysis_status']} but {state} run_summary row"
            )


def _check_keys(directory: Path, tables: dict[str, pa.Table]) -> None:
    for name in ("samples", "run_summary"):
        counts = Counter(tables[name].column("sample").to_pylist())
        duplicate = next((s for s, n in counts.items() if n > 1), None)
        if duplicate is not None:
            raise DatasetError(f"{directory / f'{name}.parquet'}: duplicate sample '{duplicate}'")
    known = set(tables["samples"].column("sample").to_pylist())
    for name in ("amr_genes", "run_summary"):
        samples = tables[name].column("sample").to_pylist()
        orphan = next((s for s in samples if s not in known), None)
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
    for name in TABLES:
        path = directory / f"{name}.parquet"
        if not path.exists():
            raise DatasetError(f"{path}: missing table file")
        tables[name] = pq.read_table(path)
    _upgrade(tables)
    for name, schema in TABLES.items():
        _check_schema(directory / f"{name}.parquet", name, tables[name], schema)
    _check_keys(directory, tables)
    _check_status(directory, tables)
    if (directory / "manifest.json").exists():
        _check_manifest(directory, tables)
    return tables
