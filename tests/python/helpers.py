"""Builders for small tool-output files used across tests."""

import json
from pathlib import Path


def write_contigs(path: Path, lengths: list[int]) -> Path:
    path.write_text("".join(f">contig_{i}\n{'A' * n}\n" for i, n in enumerate(lengths, 1)))
    return path


def write_fastp(path: Path, total_reads: int = 1000, q30_rate: float = 0.912) -> Path:
    report = {
        "summary": {
            "fastp_version": "1.3.6",
            "before_filtering": {"total_reads": total_reads + 200, "q30_rate": 0.9},
            "after_filtering": {
                "total_reads": total_reads,
                "total_bases": total_reads * 150,
                "q20_rate": 0.97,
                "q30_rate": q30_rate,
            },
        }
    }
    path.write_text(json.dumps(report))
    return path
