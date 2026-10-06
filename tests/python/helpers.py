"""Builders for small tool-output files used across tests."""

from pathlib import Path


def write_contigs(path: Path, lengths: list[int]) -> Path:
    path.write_text("".join(f">contig_{i}\n{'A' * n}\n" for i, n in enumerate(lengths, 1)))
    return path
