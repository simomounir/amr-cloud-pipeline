"""Combine per-run Parquet folders into one validated dataset with a manifest."""

import json
import shutil
import tempfile
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

import pyarrow as pa
import pyarrow.compute as pc

from amrtools.schema import SCHEMA_VERSION, TABLES
from amrtools.tables import write_table
from amrtools.validate import DatasetError, sha256, validate_dir

MAX_FILE_BYTES = 95 * 1024 * 1024


def _newest_run_per_sample(samples: pa.Table) -> dict[str, str]:
    newest: dict[str, tuple] = {}
    for row in samples.select(["sample", "run_id", "run_started_at"]).to_pylist():
        current = newest.get(row["sample"])
        if current is None or row["run_started_at"] > current[1]:
            newest[row["sample"]] = (row["run_id"], row["run_started_at"])
    return {sample: run_id for sample, (run_id, _) in newest.items()}


def _keep_winners(table: pa.Table, winners: dict[str, str]) -> pa.Table:
    pairs = zip(table.column("sample").to_pylist(), table.column("run_id").to_pylist(), strict=True)
    mask = [winners.get(sample) == run_id for sample, run_id in pairs]
    kept = table.filter(pa.array(mask, type=pa.bool_()))
    return kept.take(pc.sort_indices(kept, sort_keys=[("sample", "ascending")]))


def _manifest(directory: Path, tables: dict[str, pa.Table]) -> dict:
    samples = tables["samples"]
    run_ids = samples.column("run_id").to_pylist()
    started = dict(zip(run_ids, samples.column("run_started_at").to_pylist(), strict=True))
    runs = sorted(
        (
            {"run_id": run_id, "run_started_at": started[run_id].isoformat(), "samples": count}
            for run_id, count in Counter(run_ids).items()
        ),
        key=lambda run: run["run_started_at"],
    )
    return {
        "schema_version": SCHEMA_VERSION,
        "created_at": datetime.now(UTC).isoformat(),
        "runs": runs,
        "tables": {
            name: {
                "file": f"{name}.parquet",
                "rows": table.num_rows,
                "sha256": sha256(directory / f"{name}.parquet"),
            }
            for name, table in tables.items()
        },
    }


def build_dataset(inputs: list[Path], out: Path) -> dict:
    out = Path(out)
    if out.exists() and not (out / "manifest.json").exists():
        raise DatasetError(
            f"{out}: exists and is not a dataset (no manifest.json); not replacing it"
        )
    runs = [validate_dir(Path(directory)) for directory in inputs]
    combined = {name: pa.concat_tables([run[name] for run in runs]) for name in TABLES}
    winners = _newest_run_per_sample(combined["samples"])
    tables = {name: _keep_winners(table, winners) for name, table in combined.items()}

    out.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".{out.name}.", dir=out.parent))
    try:
        for name, table in tables.items():
            path = staging / f"{name}.parquet"
            write_table(table, path)
            if path.stat().st_size > MAX_FILE_BYTES:
                size = path.stat().st_size / 1024 / 1024
                raise DatasetError(f"{name}.parquet is {size:.1f} MB; GitHub's limit is 100 MB")
        manifest = _manifest(staging, tables)
        (staging / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
        validate_dir(staging)
        if out.exists():
            backup = out.with_name(f".{out.name}.previous")
            out.rename(backup)
            staging.rename(out)
            shutil.rmtree(backup)
        else:
            staging.rename(out)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    return manifest
