"""Turn one pipeline run (samplesheet + merged TSVs) into versioned Parquet tables."""

import csv
from datetime import UTC, datetime
from pathlib import Path

import pyarrow as pa

from amrtools.errors import InputFormatError
from amrtools.metadata import categorize_source, clean_country, clean_date, clean_host, clean_text
from amrtools.schema import AMR_GENES, RUN_SUMMARY, SAMPLES
from amrtools.tables import build_table, write_table
from amrtools.validate import validate_dir

_NA = ("", "NA")
_GENE_NULLABLE = ("drug_class", "drug_subclass", "contig_id")
_SUMMARY_INTS = ("reads_after_qc", "assembly_length", "n_contigs", "n50", "n_amr_genes")


def parse_started_at(text: str) -> datetime:
    started = datetime.fromisoformat(text)
    if started.tzinfo is None:
        raise InputFormatError(f"run start time '{text}' needs a timezone")
    return started.astimezone(UTC)


def _read(path: Path, delimiter: str) -> list[dict[str, str]]:
    with open(path, newline="") as handle:
        return list(csv.DictReader(handle, delimiter=delimiter))


def _null(value: str) -> str | None:
    return None if value in _NA else value


def _int_or_null(value: str) -> int | None:
    return None if value in _NA else int(value)


def _sample_records(rows, run) -> list[dict]:
    records = []
    for row in rows:
        year, month, precision = clean_date(row.get("collection_date"))
        country, region = clean_country(row.get("country"))
        records.append(
            {
                "sample": row["sample"],
                "sample_type": row["sample_type"],
                "organism": row["organism"],
                "run_accession": clean_text(row.get("run_accession")),
                "sample_accession": clean_text(row.get("sample_accession")),
                "study_accession": clean_text(row.get("study_accession")),
                "collection_date_raw": clean_text(row.get("collection_date")),
                "collection_year": year,
                "collection_month": month,
                "collection_date_precision": precision,
                "country": country,
                "region": region,
                "country_raw": clean_text(row.get("country")),
                "isolation_source_raw": clean_text(row.get("isolation_source")),
                "source_category": categorize_source(row.get("isolation_source"), row.get("host")),
                "host": clean_host(row.get("host")),
            }
            | run
        )
    return records


def _gene_records(rows, run) -> list[dict]:
    records = []
    for row in rows:
        record = dict(row) | run
        record["pct_identity"] = float(row["pct_identity"])
        record["pct_coverage"] = float(row["pct_coverage"])
        for name in _GENE_NULLABLE:
            record[name] = _null(row[name])
        records.append(record)
    return records


def _summary_records(rows, run) -> list[dict]:
    records = []
    for row in rows:
        record = dict(row) | run
        record["kleborate_species"] = _null(row["kleborate_species"])
        record["st"] = _null(row["st"])
        record["resistance_score"] = _int_or_null(row["resistance_score"])
        record["virulence_score"] = _int_or_null(row["virulence_score"])
        record["q30_rate"] = float(row["q30_rate"])
        for name in _SUMMARY_INTS:
            record[name] = int(row[name])
        records.append(record)
    return records


def export_run(
    *,
    samplesheet: Path,
    genes_tsv: Path,
    summary_tsv: Path,
    run_id: str,
    run_started_at: str,
    outdir: Path,
    samples_tsv: Path | None = None,
) -> dict[str, pa.Table]:
    run = {"run_id": run_id, "run_started_at": parse_started_at(run_started_at)}
    try:
        samples = _sample_records(_read(samplesheet, ","), run)
        genes = _gene_records(_read(genes_tsv, "\t"), run)
        summaries = _summary_records(_read(summary_tsv, "\t"), run)
        tables = {
            "samples": build_table(samples, SAMPLES),
            "amr_genes": build_table(genes, AMR_GENES),
            "run_summary": build_table(summaries, RUN_SUMMARY),
        }
    except (KeyError, ValueError) as exc:
        raise InputFormatError(f"cannot convert run tables to Parquet: {exc}") from exc
    outdir = Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    for name, table in tables.items():
        write_table(table, outdir / f"{name}.parquet")
    validate_dir(outdir)
    if samples_tsv is not None:
        _write_samples_tsv(tables["samples"], samples_tsv)
    return tables


def _write_samples_tsv(table: pa.Table, path: Path) -> None:
    with open(path, "w", newline="") as handle:
        writer = csv.writer(handle, delimiter="\t", lineterminator="\n")
        writer.writerow(table.schema.names)
        for row in table.to_pylist():
            writer.writerow("" if value is None else value for value in row.values())
