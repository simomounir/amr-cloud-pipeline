from pathlib import Path

import pytest
from helpers import amrfinder_row, write_amrfinder, write_contigs, write_fastp

from amrtools.columns import GENE_COLUMNS, SUMMARY_COLUMNS
from amrtools.qc import QcThresholds
from amrtools.sample import build_sample_tables, write_tsv

KLEBORATE = Path(__file__).parent / "fixtures" / "kleborate_SRR5386028.tsv"


@pytest.fixture
def inputs(tmp_path):
    return {
        "fastp_json": write_fastp(tmp_path / "s.fastp.json", total_reads=700_000, q30_rate=0.92),
        "contigs": write_contigs(tmp_path / "contigs.fa", [3_000_000, 2_500_000]),
        "amrfinder_tsv": write_amrfinder(
            tmp_path / "s.tsv",
            [
                amrfinder_row("blaKPC-2"),
                amrfinder_row("ompK36_D135DGD", subtype="POINT"),
                amrfinder_row("iutA", element_type="VIRULENCE", subtype="VIRULENCE"),
            ],
        ),
        "kleborate_tsv": KLEBORATE,
    }


def build(inputs, **overrides):
    args = {
        "sample": "S1",
        "sample_type": "isolate",
        "organism": "Klebsiella_pneumoniae",
        "amrfinder_version": "4.2.7",
        "amrfinder_db_version": "2026-09-30.1",
        "thresholds": QcThresholds(),
        **inputs,
        **overrides,
    }
    return build_sample_tables(**args)


def test_gene_table_has_one_row_per_element_and_run_metadata(inputs):
    genes, _ = build(inputs)
    assert list(genes.columns) == GENE_COLUMNS
    assert list(genes["gene_symbol"]) == ["blaKPC-2", "ompK36_D135DGD", "iutA"]
    assert set(genes["sample"]) == {"S1"}
    assert set(genes["amrfinder_db_version"]) == {"2026-09-30.1"}


def test_summary_row_combines_all_tools(inputs):
    _, summary = build(inputs)
    assert list(summary.columns) == SUMMARY_COLUMNS
    row = summary.iloc[0].to_dict()
    assert row["kleborate_species"] == "Klebsiella pneumoniae"
    assert row["st"] == "ST13"
    assert row["reads_after_qc"] == 700_000
    assert row["assembly_length"] == 5_500_000
    assert row["n_contigs"] == 2
    assert row["n50"] == 3_000_000
    assert row["n_amr_genes"] == 2  # AMR gene + point mutation, not the virulence row
    assert row["qc_status"] == "pass"
    assert row["qc_reasons"] == ""


def test_zero_hits_gives_empty_gene_table_and_zero_count(inputs, tmp_path):
    no_hits = write_amrfinder(tmp_path / "none.tsv", [])
    genes, summary = build(inputs, amrfinder_tsv=no_hits)
    assert genes.empty
    assert list(genes.columns) == GENE_COLUMNS
    assert summary.iloc[0]["n_amr_genes"] == 0


def test_low_quality_sample_is_flagged_not_dropped(inputs, tmp_path):
    poor = write_fastp(tmp_path / "poor.json", q30_rate=0.5)
    _, summary = build(inputs, fastp_json=poor)
    assert summary.iloc[0]["qc_status"] == "warn"
    assert summary.iloc[0]["qc_reasons"] == "q30_rate"


def test_kleborate_without_result_flags_species_mismatch(inputs, tmp_path):
    empty = tmp_path / "empty.kleborate.tsv"
    empty.write_text("")
    _, summary = build(inputs, kleborate_tsv=empty)
    row = summary.iloc[0]
    assert row["kleborate_species"] == "NA"
    assert row["st"] == "NA"
    assert row["qc_reasons"] == "species_mismatch"


def test_write_tsv_round_trips_header(inputs, tmp_path):
    genes, _ = build(inputs)
    out = tmp_path / "S1.amr_genes.tsv"
    write_tsv(genes, out)
    assert out.read_text().splitlines()[0].split("\t") == GENE_COLUMNS
