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


AMRFINDER_V4_COLUMNS = [
    "Protein id", "Contig id", "Start", "Stop", "Strand", "Element symbol", "Element name",
    "Scope", "Type", "Subtype", "Class", "Subclass", "Method", "Target length",
    "Reference sequence length", "% Coverage of reference", "% Identity to reference",
    "Alignment length", "Closest reference accession", "Closest reference name",
    "HMM accession", "HMM description", "Hierarchy node",
]  # fmt: skip

# AMRFinderPlus v3 names for the columns that v4 renamed.
AMRFINDER_V3_RENAMES = {
    "Protein id": "Protein identifier",
    "Element symbol": "Gene symbol",
    "Element name": "Sequence name",
    "Type": "Element type",
    "Subtype": "Element subtype",
    "% Coverage of reference": "% Coverage of reference sequence",
    "% Identity to reference": "% Identity to reference sequence",
    "Closest reference accession": "Accession of closest sequence",
    "Closest reference name": "Name of closest sequence",
    "HMM accession": "HMM id",
}


def amrfinder_row(
    symbol: str,
    element_type: str = "AMR",
    subtype: str = "AMR",
    drug_class: str = "BETA-LACTAM",
    subclass: str = "CARBAPENEM",
) -> dict[str, str]:
    row = dict.fromkeys(AMRFINDER_V4_COLUMNS, "NA")
    row.update(
        {
            "Contig id": "contig_1",
            "Start": "1",
            "Stop": "882",
            "Strand": "+",
            "Element symbol": symbol,
            "Element name": f"{symbol} test element",
            "Scope": "core",
            "Type": element_type,
            "Subtype": subtype,
            "Class": drug_class,
            "Subclass": subclass,
            "Method": "ALLELEX",
            "% Coverage of reference": "100.00",
            "% Identity to reference": "99.65",
        }
    )
    return row


def write_amrfinder(path: Path, rows: list[dict[str, str]], version: int = 4) -> Path:
    header = AMRFINDER_V4_COLUMNS
    if version == 3:
        header = [AMRFINDER_V3_RENAMES.get(c, c) for c in AMRFINDER_V4_COLUMNS]
    lines = ["\t".join(header)] + ["\t".join(r[c] for c in AMRFINDER_V4_COLUMNS) for r in rows]
    path.write_text("\n".join(lines) + "\n")
    return path
