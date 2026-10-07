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


def _select_newest(runs: list[dict[str, pa.Table]]) -> dict[str, pa.Table]:
    """Keep each sample's rows from the input with the newest run; later inputs win ties.

    Inputs are compared by position, not run_id: `nextflow -resume` reuses the session id,
    so two batches can share a run_id.
    """
    best: dict[str, tuple] = {}
    for index, run in enumerate(runs):
        for row in run["samples"].select(["sample", "run_started_at"]).to_pylist():
            key = (row["run_started_at"], index)
            if row["sample"] not in best or key >= best[row["sample"]]:
                best[row["sample"]] = key
    selected = {}
    for name in TABLES:
        parts = []
        for index, run in enumerate(runs):
            samples = run[name].column("sample").to_pylist()
            mask = [best[sample][1] == index for sample in samples]
            parts.append(run[name].filter(pa.array(mask, type=pa.bool_())))
        combined = pa.concat_tables(parts)
        order = pc.sort_indices(combined, sort_keys=[("sample", "ascending")])
        selected[name] = combined.take(order)
    return selected


def _manifest(directory: Path, tables: dict[str, pa.Table]) -> dict:
    samples = tables["samples"]
    pairs = zip(
        samples.column("run_id").to_pylist(),
        samples.column("run_started_at").to_pylist(),
        strict=True,
    )
    runs = sorted(
        (
            {"run_id": run_id, "run_started_at": started.isoformat(), "samples": count}
            for (run_id, started), count in Counter(pairs).items()
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
    backup = out.with_name(f".{out.name}.previous")
    if backup.exists():
        raise DatasetError(
            f"{backup}: left over from an interrupted build; check it, then delete it "
            f"or rename it back to {out.name}"
        )
    if out.exists() and not (out / "manifest.json").exists():
        raise DatasetError(
            f"{out}: exists and is not a dataset (no manifest.json); not replacing it"
        )
    tables = _select_newest([validate_dir(Path(directory)) for directory in inputs])

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
            out.rename(backup)
            try:
                staging.rename(out)
            except BaseException:
                backup.rename(out)
                raise
            shutil.rmtree(backup, ignore_errors=True)
        else:
            staging.rename(out)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    return manifest
