"""Build one sample's gene table and summary row from its tool outputs."""

from pathlib import Path

import pandas as pd

from amrtools.columns import GENE_COLUMNS, SUMMARY_COLUMNS
from amrtools.parsers.amrfinder import read_amrfinder
from amrtools.parsers.assembly import read_assembly
from amrtools.parsers.fastp import read_fastp
from amrtools.parsers.kleborate import read_kleborate
from amrtools.qc import QcThresholds, qc_reasons


def build_sample_tables(
    *,
    sample: str,
    sample_type: str,
    organism: str,
    fastp_json: Path,
    contigs: Path,
    amrfinder_tsv: Path,
    kleborate_tsv: Path,
    amrfinder_version: str,
    amrfinder_db_version: str,
    thresholds: QcThresholds,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    genes = read_amrfinder(amrfinder_tsv).assign(
        sample=sample,
        sample_type=sample_type,
        organism=organism,
        amrfinder_version=amrfinder_version,
        amrfinder_db_version=amrfinder_db_version,
    )[GENE_COLUMNS]

    fastp = read_fastp(fastp_json)
    assembly = read_assembly(contigs)
    kleborate = read_kleborate(kleborate_tsv)
    reasons = qc_reasons(
        assembly=assembly,
        fastp=fastp,
        species=kleborate.species,
        organism=organism,
        thresholds=thresholds,
    )

    summary = pd.DataFrame(
        [
            {
                "sample": sample,
                "sample_type": sample_type,
                "organism": organism,
                "kleborate_species": kleborate.species,
                "st": kleborate.st,
                "resistance_score": kleborate.resistance_score,
                "virulence_score": kleborate.virulence_score,
                "reads_after_qc": fastp.reads_after_qc,
                "q30_rate": fastp.q30_rate,
                "assembly_length": assembly.total_length,
                "n_contigs": assembly.n_contigs,
                "n50": assembly.n50,
                "n_amr_genes": int((genes["element_type"] == "AMR").sum()),
                "qc_status": "warn" if reasons else "pass",
                "qc_reasons": ";".join(reasons),
            }
        ],
        columns=SUMMARY_COLUMNS,
    )
    return genes, summary


def write_tsv(table: pd.DataFrame, path: Path) -> None:
    table.to_csv(path, sep="\t", index=False)
