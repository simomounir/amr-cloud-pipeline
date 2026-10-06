"""Assembly statistics computed from a contigs FASTA."""

from dataclasses import dataclass
from pathlib import Path

from amrtools.errors import InputFormatError


@dataclass(frozen=True)
class AssemblyStats:
    total_length: int
    n_contigs: int
    n50: int


def n50(lengths: list[int]) -> int:
    """Smallest length L such that contigs of length >= L cover half the assembly."""
    total = sum(lengths)
    covered = 0
    for length in sorted(lengths, reverse=True):
        covered += length
        if covered * 2 >= total:
            return length
    return 0


def contig_lengths(path: Path) -> list[int]:
    lengths: list[int] = []
    with open(path) as handle:
        for raw in handle:
            line = raw.strip()
            if line.startswith(">"):
                lengths.append(0)
            elif line:
                if not lengths:
                    raise InputFormatError(f"{path}: sequence before first FASTA header")
                lengths[-1] += len(line)
    return lengths


def read_assembly(path: Path) -> AssemblyStats:
    lengths = contig_lengths(path)
    return AssemblyStats(total_length=sum(lengths), n_contigs=len(lengths), n50=n50(lengths))
