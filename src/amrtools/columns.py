"""Output table layouts. These become results schema v0.1 in Phase 2."""

GENE_COLUMNS = [
    "sample",
    "sample_type",
    "organism",
    "gene_symbol",
    "element_name",
    "element_type",
    "element_subtype",
    "drug_class",
    "drug_subclass",
    "method",
    "pct_identity",
    "pct_coverage",
    "contig_id",
    "amrfinder_version",
    "amrfinder_db_version",
]

SUMMARY_COLUMNS = [
    "sample",
    "sample_type",
    "organism",
    "kleborate_species",
    "st",
    "resistance_score",
    "virulence_score",
    "reads_after_qc",
    "q30_rate",
    "assembly_length",
    "n_contigs",
    "n50",
    "n_amr_genes",
    "qc_status",
    "qc_reasons",
]
