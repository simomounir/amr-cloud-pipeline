from pathlib import Path

import pytest

from amrtools.errors import InputFormatError
from amrtools.parsers.kleborate import NO_RESULT, KleborateResult, read_kleborate

FIXTURE = Path(__file__).parent / "fixtures" / "kleborate_SRR5386028.tsv"


def test_reads_real_kleborate_v3_output():
    assert read_kleborate(FIXTURE) == KleborateResult(
        species="Klebsiella pneumoniae", st="ST13", resistance_score="3", virulence_score="2"
    )


def test_read_kleborate_empty_file_means_no_result(tmp_path):
    empty = tmp_path / "s.kleborate.tsv"
    empty.write_text("")
    assert read_kleborate(empty) == NO_RESULT


def test_output_without_st_column_gives_na(tmp_path):
    table = tmp_path / "s.kleborate.tsv"
    table.write_text("strain\tspecies\nx\tEscherichia coli\n")
    result = read_kleborate(table)
    assert result.species == "Escherichia coli"
    assert result.st == "NA"
    assert result.resistance_score == "NA"


def test_missing_species_column_is_rejected(tmp_path):
    table = tmp_path / "s.kleborate.tsv"
    table.write_text("strain\tST\nx\tST13\n")
    with pytest.raises(InputFormatError, match="missing Kleborate column 'species'"):
        read_kleborate(table)


def test_more_than_one_row_is_rejected(tmp_path):
    table = tmp_path / "s.kleborate.tsv"
    table.write_text("strain\tspecies\na\tKlebsiella pneumoniae\nb\tKlebsiella pneumoniae\n")
    with pytest.raises(InputFormatError, match="expected 1 Kleborate row, found 2"):
        read_kleborate(table)


def test_kpsc_species_without_st_column_is_rejected(tmp_path):
    table = tmp_path / "s.kleborate.tsv"
    table.write_text(
        "strain\tspecies\tresistance_score\tvirulence_score\nx\tKlebsiella pneumoniae\t3\t2\n"
    )
    with pytest.raises(InputFormatError, match="missing Kleborate column 'ST'"):
        read_kleborate(table)
