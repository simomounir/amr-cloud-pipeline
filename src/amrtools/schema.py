"""Results schema v1: one definition for export, validation, build-dataset and the JSON docs."""

import json
from pathlib import Path

import pyarrow as pa

SCHEMA_VERSION = "1.1.0"
SCHEMA_MAJOR = 1

SOURCE_CATEGORIES = (
    "blood", "urine", "respiratory", "screening", "wound",
    "other_clinical", "environmental", "animal", "unknown",
)  # fmt: skip
DATE_PRECISIONS = ("day", "month", "year", "missing")
QC_STATUSES = ("pass", "warn")

TIMESTAMP = pa.timestamp("us", tz="UTC")


def _field(name: str, type_: pa.DataType, nullable: bool, description: str) -> pa.Field:
    return pa.field(name, type_, nullable=nullable, metadata={"description": description})


def _identity() -> list[pa.Field]:
    return [
        _field("sample", pa.string(), False, "Sample name from the samplesheet"),
        _field("sample_type", pa.string(), False, "isolate (metagenome in a later phase)"),
        _field(
            "organism", pa.string(), False, "AMRFinderPlus organism, e.g. Klebsiella_pneumoniae"
        ),
    ]


def _run() -> list[pa.Field]:
    return [
        _field("run_id", pa.string(), False, "Nextflow session id of the producing run"),
        _field("run_started_at", TIMESTAMP, False, "Start time of the producing run (UTC)"),
    ]


SAMPLES = pa.schema(
    _identity()
    + [
        _field("run_accession", pa.string(), True, "ENA/SRA run accession"),
        _field("sample_accession", pa.string(), True, "ENA/BioSample accession"),
        _field("study_accession", pa.string(), True, "ENA/BioProject accession"),
        _field("collection_date_raw", pa.string(), True, "Collection date as submitted"),
        _field("collection_year", pa.int16(), True, "Collection year"),
        _field("collection_month", pa.int8(), True, "Collection month 1-12"),
        _field("collection_date_precision", pa.string(), False, "day, month, year or missing"),
        _field("country", pa.string(), True, "Country (ISO 3166 common name)"),
        _field("region", pa.string(), True, "Text after the colon in the submitted country"),
        _field("country_raw", pa.string(), True, "Country as submitted"),
        _field("isolation_source_raw", pa.string(), True, "Isolation source as submitted"),
        _field("source_category", pa.string(), False, "Cleaned isolation source category"),
        _field("host", pa.string(), True, "Host organism"),
    ]
    + _run()
)

_GENE_TEXT = {
    "gene_symbol": "AMRFinderPlus element symbol",
    "element_name": "AMRFinderPlus element name",
    "element_type": "AMR, STRESS or VIRULENCE",
    "element_subtype": "AMR, POINT, STRESS, VIRULENCE, ...",
}

AMR_GENES = pa.schema(
    _identity()
    + [_field(name, pa.string(), False, text) for name, text in _GENE_TEXT.items()]
    + [
        _field("drug_class", pa.string(), True, "Drug class"),
        _field("drug_subclass", pa.string(), True, "Drug subclass"),
        _field("method", pa.string(), False, "AMRFinderPlus detection method"),
        _field("pct_identity", pa.float64(), False, "Percent identity to reference"),
        _field("pct_coverage", pa.float64(), False, "Percent coverage of reference"),
        _field("contig_id", pa.string(), True, "Contig carrying the element"),
        _field("amrfinder_version", pa.string(), False, "AMRFinderPlus software version"),
        _field("amrfinder_db_version", pa.string(), False, "AMRFinderPlus database version"),
    ]
    + _run()
)

RUN_SUMMARY = pa.schema(
    _identity()
    + [
        _field("kleborate_species", pa.string(), True, "Species called by Kleborate"),
        _field("st", pa.string(), True, "MLST sequence type, e.g. ST147"),
        _field("resistance_score", pa.int8(), True, "Kleborate resistance score"),
        _field("virulence_score", pa.int8(), True, "Kleborate virulence score"),
        _field("reads_after_qc", pa.int64(), False, "Reads kept by fastp"),
        _field("q30_rate", pa.float64(), False, "Fraction of bases >= Q30 after fastp"),
        _field("assembly_length", pa.int64(), False, "Total assembly length (bp)"),
        _field("n_contigs", pa.int32(), False, "Number of contigs"),
        _field("n50", pa.int64(), False, "Assembly N50 (bp)"),
        _field("n_amr_genes", pa.int32(), False, "AMR elements (genes and point mutations)"),
        _field("qc_status", pa.string(), False, "pass or warn"),
        _field("qc_reasons", pa.string(), False, "Failed QC checks joined by ';', empty if none"),
    ]
    + _run()
)

TABLES = {"samples": SAMPLES, "amr_genes": AMR_GENES, "run_summary": RUN_SUMMARY}

ALLOWED_VALUES = {
    "samples": {
        "source_category": SOURCE_CATEGORIES,
        "collection_date_precision": DATE_PRECISIONS,
    },
    "run_summary": {"qc_status": QC_STATUSES},
}


def _columns_json(schema: pa.Schema) -> list[dict]:
    return [
        {
            "name": field.name,
            "type": str(field.type),
            "nullable": field.nullable,
            "description": field.metadata[b"description"].decode(),
        }
        for field in schema
    ]


def export_json(outdir: Path) -> list[Path]:
    target = Path(outdir) / f"v{SCHEMA_VERSION}"
    target.mkdir(parents=True, exist_ok=True)
    paths = []
    for name, schema in TABLES.items():
        path = target / f"{name}.json"
        document = {
            "table": name,
            "schema_version": SCHEMA_VERSION,
            "columns": _columns_json(schema),
        }
        path.write_text(json.dumps(document, indent=2) + "\n")
        paths.append(path)
    return paths
