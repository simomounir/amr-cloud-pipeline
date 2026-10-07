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
