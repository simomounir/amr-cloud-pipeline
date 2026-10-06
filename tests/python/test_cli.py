from pathlib import Path

from helpers import amrfinder_row, write_amrfinder, write_contigs, write_fastp

from amrtools.cli import main
from amrtools.columns import GENE_COLUMNS, SUMMARY_COLUMNS

KLEBORATE = Path(__file__).parent / "fixtures" / "kleborate_SRR5386028.tsv"


def sample_args(tmp_path, sample, amrfinder):
    return [
        "sample",
        "--sample", sample,
        "--sample-type", "isolate",
        "--organism", "Klebsiella_pneumoniae",
        "--fastp-json", str(write_fastp(tmp_path / f"{sample}.json")),
        "--contigs", str(write_contigs(tmp_path / f"{sample}.fa", [3_000_000, 2_500_000])),
        "--amrfinder", str(amrfinder),
        "--kleborate", str(KLEBORATE),
        "--amrfinder-version", "4.2.7",
        "--amrfinder-db-version", "2026-09-30.1",
        "--outdir", str(tmp_path / "out"),
    ]  # fmt: skip


def test_sample_then_merge_round_trip(tmp_path):
    out = tmp_path / "out"
    hits = write_amrfinder(tmp_path / "hits.tsv", [amrfinder_row("blaKPC-2")])
    none = write_amrfinder(tmp_path / "none.tsv", [])
    assert main(sample_args(tmp_path, "S2", hits)) == 0
    assert main(sample_args(tmp_path, "S1", none)) == 0

    merged = tmp_path / "merged"
    assert main([
        "merge",
        "--genes", str(out / "S2.amr_genes.tsv"), str(out / "S1.amr_genes.tsv"),
        "--summaries", str(out / "S2.run_summary.tsv"), str(out / "S1.run_summary.tsv"),
        "--outdir", str(merged),
    ]) == 0  # fmt: skip

    summary = (merged / "run_summary.tsv").read_text().splitlines()
    assert summary[0].split("\t") == SUMMARY_COLUMNS
    assert [line.split("\t")[0] for line in summary[1:]] == ["S1", "S2"]
    genes = (merged / "amr_genes.tsv").read_text().splitlines()
    assert len(genes) == 2 and genes[1].startswith("S2\t")


def test_qc_threshold_options_are_applied(tmp_path):
    hits = write_amrfinder(tmp_path / "hits.tsv", [])
    args = sample_args(tmp_path, "S1", hits) + ["--max-assembly-length", "1000"]
    assert main(args) == 0
    row = (tmp_path / "out" / "S1.run_summary.tsv").read_text().splitlines()[1].split("\t")
    assert row[SUMMARY_COLUMNS.index("qc_reasons")] == "assembly_length"


def test_stub_writes_placeholder_tables(tmp_path):
    out = tmp_path / "out"
    args = ["stub", "--sample", "S9", "--sample-type", "isolate",
            "--organism", "Klebsiella_pneumoniae", "--outdir", str(out)]  # fmt: skip
    assert main(args) == 0
    assert (out / "S9.amr_genes.tsv").read_text().splitlines() == ["\t".join(GENE_COLUMNS)]
    summary = (out / "S9.run_summary.tsv").read_text().splitlines()
    assert summary[1].split("\t")[:4] == ["S9", "isolate", "Klebsiella_pneumoniae", "NA"]


def test_bad_input_returns_error_code_and_message(tmp_path, capsys):
    broken = tmp_path / "broken.tsv"
    broken.write_text("not\tan\tamrfinder\treport\n")
    assert main(sample_args(tmp_path, "S1", broken)) == 1
    assert "amrtools: error: " in capsys.readouterr().err
