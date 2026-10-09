"""Small valid records for building Parquet test datasets."""

from datetime import UTC, datetime
from pathlib import Path

from amrtools.schema import AMR_GENES, RUN_SUMMARY, SAMPLES
from amrtools.tables import build_table, write_table

T1 = datetime(2026, 10, 1, tzinfo=UTC)
T2 = datetime(2026, 10, 7, tzinfo=UTC)
KP = "Klebsiella_pneumoniae"


def _base(sample, run_id, started):
    return {"sample": sample, "sample_type": "isolate", "organism": KP,
            "run_id": run_id, "run_started_at": started}  # fmt: skip


def sample_record(sample, run_id="r1", started=T1, **overrides):
    record = dict.fromkeys(SAMPLES.names) | _base(sample, run_id, started)
    record |= {"collection_date_precision": "missing", "source_category": "unknown",
               "analysis_status": "complete"}  # fmt: skip
    return record | overrides


def summary_record(sample, run_id="r1", started=T1, **overrides):
    record = dict.fromkeys(RUN_SUMMARY.names) | _base(sample, run_id, started)
    record |= {"kleborate_species": "Klebsiella pneumoniae", "st": "ST147",
               "resistance_score": 2, "virulence_score": 1, "reads_after_qc": 1000,
               "q30_rate": 0.9, "assembly_length": 5_500_000, "n_contigs": 100,
               "n50": 100_000, "n_amr_genes": 1, "qc_status": "pass", "qc_reasons": ""}  # fmt: skip
    return record | overrides


def gene_record(sample, run_id="r1", started=T1, **overrides):
    record = dict.fromkeys(AMR_GENES.names) | _base(sample, run_id, started)
    record |= {"gene_symbol": "blaKPC-2", "element_name": "KPC-2", "element_type": "AMR",
               "element_subtype": "AMR", "drug_class": "BETA-LACTAM",
               "drug_subclass": "CARBAPENEM", "method": "ALLELEX", "pct_identity": 100.0,
               "pct_coverage": 100.0, "contig_id": "contig_1", "amrfinder_version": "4.2.7",
               "amrfinder_db_version": "2026-09-30.1"}  # fmt: skip
    return record | overrides


def write_run(directory: Path, samples, genes, summaries) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    for name, schema, records in (
        ("samples", SAMPLES, samples),
        ("amr_genes", AMR_GENES, genes),
        ("run_summary", RUN_SUMMARY, summaries),
    ):
        write_table(build_table(records, schema), directory / f"{name}.parquet")
    return directory
