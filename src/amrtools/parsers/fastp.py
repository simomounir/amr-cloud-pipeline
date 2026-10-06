"""Read-level QC metrics from a fastp JSON report."""

import json
from dataclasses import dataclass
from pathlib import Path

from amrtools.errors import InputFormatError


@dataclass(frozen=True)
class FastpStats:
    reads_after_qc: int
    q30_rate: float


def read_fastp(path: Path) -> FastpStats:
    try:
        report = json.loads(Path(path).read_text())
    except json.JSONDecodeError as exc:
        raise InputFormatError(f"{path}: not valid fastp JSON ({exc.msg})") from exc
    try:
        after = report["summary"]["after_filtering"]
        return FastpStats(
            reads_after_qc=int(after["total_reads"]), q30_rate=float(after["q30_rate"])
        )
    except KeyError as exc:
        raise InputFormatError(f"{path}: missing fastp field '{exc.args[0]}'") from exc
