"""Per-sample QC flags. Samples are flagged, never dropped."""

from dataclasses import dataclass

from amrtools.parsers.assembly import AssemblyStats
from amrtools.parsers.fastp import FastpStats


@dataclass(frozen=True)
class QcThresholds:
    min_assembly_length: int = 5_000_000
    max_assembly_length: int = 6_500_000
    max_contigs: int = 500
    min_q30: float = 0.80


def qc_reasons(
    *,
    assembly: AssemblyStats,
    fastp: FastpStats,
    species: str,
    organism: str,
    thresholds: QcThresholds,
) -> list[str]:
    reasons = []
    if not (
        thresholds.min_assembly_length <= assembly.total_length <= thresholds.max_assembly_length
    ):
        reasons.append("assembly_length")
    if assembly.n_contigs >= thresholds.max_contigs:
        reasons.append("n_contigs")
    if fastp.q30_rate <= thresholds.min_q30:
        reasons.append("q30_rate")
    if species != organism.replace("_", " "):
        reasons.append("species_mismatch")
    return reasons
