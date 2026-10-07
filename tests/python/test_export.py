import csv
from datetime import UTC, datetime

import pytest

from amrtools.cli import main
from amrtools.columns import GENE_COLUMNS, SUMMARY_COLUMNS
from amrtools.errors import InputFormatError
from amrtools.export import export_run, parse_started_at

STARTED = "2026-10-07T08:15:30.123Z"
PLAIN_SHEET = (
    "sample,fastq_1,fastq_2,sample_type,organism\n"
    "S1,a_1.fastq.gz,a_2.fastq.gz,isolate,Klebsiella_pneumoniae\n"
)


def write_tsv(path, header, rows):
    path.write_text("\n".join("\t".join(r) for r in [header, *rows]) + "\n")
    return path


def merged_tables(tmp_path, samples):
    genes = write_tsv(tmp_path / "amr_genes.tsv", GENE_COLUMNS, [
        [samples[0], "isolate", "Klebsiella_pneumoniae", "blaKPC-2", "KPC-2", "AMR", "AMR",
         "BETA-LACTAM", "CARBAPENEM", "ALLELEX", "100.0", "100.0", "contig_1", "4.2.7",
         "2026-09-30.1"],
        [samples[0], "isolate", "Klebsiella_pneumoniae", "iutA", "iutA", "VIRULENCE",
         "VIRULENCE", "NA", "NA", "BLASTX", "99.1", "100.0", "contig_2", "4.2.7",
         "2026-09-30.1"],
    ])  # fmt: skip
    summaries = [
        [s, "isolate", "Klebsiella_pneumoniae", "Klebsiella pneumoniae", "ST13", "3", "2",
         "1174982", "0.875", "5725147", "541", "94215", "24", "warn", "n_contigs"]
        for s in samples
    ]  # fmt: skip
    summary = write_tsv(tmp_path / "run_summary.tsv", SUMMARY_COLUMNS, summaries)
    return genes, summary


def run_export(tmp_path, samplesheet, samples):
    genes, summary = merged_tables(tmp_path, samples)
    return export_run(samplesheet=samplesheet, genes_tsv=genes, summary_tsv=summary,
                      run_id="session-1", run_started_at=STARTED, outdir=tmp_path / "parquet",
                      samples_tsv=tmp_path / "samples.tsv")  # fmt: skip


def plain_sheet(tmp_path):
    sheet = tmp_path / "sheet.csv"
    sheet.write_text(PLAIN_SHEET)
    return sheet


def test_metadata_is_cleaned_into_samples_table(tmp_path):
    sheet = tmp_path / "sheet.csv"
    sheet.write_text(
        "sample,fastq_1,fastq_2,sample_type,organism,run_accession,sample_accession,"
        "study_accession,collection_date,country,isolation_source,host\n"
        "SRR5386028,a_1.fastq.gz,a_2.fastq.gz,isolate,Klebsiella_pneumoniae,SRR5386028,"
        "SAMN06438663,PRJNA376414,2014-09-28,USA: Houston,urine,Homo sapiens\n"
    )
    tables = run_export(tmp_path, sheet, ["SRR5386028"])
    (row,) = tables["samples"].to_pylist()
    assert row["country"] == "United States"
    assert row["region"] == "Houston"
    assert row["collection_year"] == 2014
    assert row["collection_month"] == 9
    assert row["source_category"] == "urine"
    assert row["country_raw"] == "USA: Houston"
    assert row["run_started_at"] == datetime(2026, 10, 7, 8, 15, 30, 123000, tzinfo=UTC)
    assert (tmp_path / "parquet" / "samples.parquet").exists()


def test_samplesheet_without_metadata_columns(tmp_path):
    (row,) = run_export(tmp_path, plain_sheet(tmp_path), ["S1"])["samples"].to_pylist()
    assert row["collection_date_precision"] == "missing"
    assert row["source_category"] == "unknown"
    assert row["country"] is None


def test_typed_gene_and_summary_tables(tmp_path):
    tables = run_export(tmp_path, plain_sheet(tmp_path), ["S1"])
    genes = tables["amr_genes"].to_pylist()
    assert genes[0]["pct_identity"] == 100.0
    assert genes[1]["drug_class"] is None  # "NA" becomes null
    (summary,) = tables["run_summary"].to_pylist()
    assert summary["n_contigs"] == 541
    assert summary["resistance_score"] == 3
    assert summary["qc_reasons"] == "n_contigs"


def test_samples_tsv_is_written(tmp_path):
    run_export(tmp_path, plain_sheet(tmp_path), ["S1"])
    with open(tmp_path / "samples.tsv", newline="") as handle:
        (row,) = list(csv.DictReader(handle, delimiter="\t"))
    assert row["sample"] == "S1"
    assert row["country"] == ""


def test_stub_tables_export_cleanly(tmp_path):
    out = tmp_path / "stub"
    assert main(["stub", "--sample", "S1", "--sample-type", "isolate",
                 "--organism", "Klebsiella_pneumoniae", "--outdir", str(out)]) == 0  # fmt: skip
    tables = export_run(samplesheet=plain_sheet(tmp_path), genes_tsv=out / "S1.amr_genes.tsv",
                        summary_tsv=out / "S1.run_summary.tsv", run_id="stub",
                        run_started_at=STARTED, outdir=tmp_path / "parquet")  # fmt: skip
    (summary,) = tables["run_summary"].to_pylist()
    assert summary["kleborate_species"] is None
    assert summary["qc_status"] == "warn"


def test_timestamp_without_timezone_is_rejected():
    with pytest.raises(InputFormatError, match="needs a timezone"):
        parse_started_at("2026-10-07T08:15:30")
    expected = datetime(2026, 10, 7, 8, 15, 30, tzinfo=UTC)
    assert parse_started_at("2026-10-07T10:15:30+02:00") == expected


def test_cli_export(tmp_path):
    genes, summary = merged_tables(tmp_path, ["S1"])
    assert main(["export", "--samplesheet", str(plain_sheet(tmp_path)), "--genes", str(genes),
                 "--summary", str(summary), "--run-id", "r1", "--run-started-at", STARTED,
                 "--outdir", str(tmp_path / "pq"), "--samples-tsv",
                 str(tmp_path / "s.tsv")]) == 0  # fmt: skip
    assert sorted(p.name for p in (tmp_path / "pq").iterdir()) == [
        "amr_genes.parquet", "run_summary.parquet", "samples.parquet"]  # fmt: skip
