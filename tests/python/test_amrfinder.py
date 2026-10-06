import pandas as pd
import pytest
from helpers import amrfinder_row, write_amrfinder

from amrtools.errors import InputFormatError
from amrtools.parsers.amrfinder import AMRFINDER_FIELDS, read_amrfinder

ROWS = [
    amrfinder_row("blaKPC-2"),
    amrfinder_row("ompK36_D135DGD", subtype="POINT"),
    amrfinder_row("iutA", element_type="VIRULENCE", subtype="VIRULENCE", drug_class="NA"),
]


def test_v4_output_maps_to_our_columns(tmp_path):
    genes = read_amrfinder(write_amrfinder(tmp_path / "s.tsv", ROWS))
    assert list(genes.columns) == AMRFINDER_FIELDS
    assert list(genes["gene_symbol"]) == ["blaKPC-2", "ompK36_D135DGD", "iutA"]
    assert list(genes["element_subtype"]) == ["AMR", "POINT", "VIRULENCE"]
    assert genes["pct_identity"].iloc[0] == pytest.approx(99.65)


def test_v3_headers_give_identical_table(tmp_path):
    v4 = read_amrfinder(write_amrfinder(tmp_path / "v4.tsv", ROWS, version=4))
    v3 = read_amrfinder(write_amrfinder(tmp_path / "v3.tsv", ROWS, version=3))
    pd.testing.assert_frame_equal(v3, v4)


def test_header_only_file_means_zero_hits(tmp_path):
    genes = read_amrfinder(write_amrfinder(tmp_path / "s.tsv", []))
    assert genes.empty
    assert list(genes.columns) == AMRFINDER_FIELDS


def test_missing_column_names_file_and_column(tmp_path):
    path = write_amrfinder(tmp_path / "s.tsv", ROWS)
    text = path.read_text().replace("Element symbol", "Something else")
    path.write_text(text)
    with pytest.raises(
        InputFormatError, match=r"s\.tsv: missing AMRFinderPlus column 'Element symbol'"
    ):
        read_amrfinder(path)


def test_zero_byte_file_is_rejected(tmp_path):
    path = tmp_path / "s.tsv"
    path.write_text("")
    with pytest.raises(InputFormatError, match="empty AMRFinderPlus report"):
        read_amrfinder(path)


def test_non_numeric_identity_names_file_and_column(tmp_path):
    row = amrfinder_row("blaKPC-2")
    row["% Identity to reference"] = "high"
    path = write_amrfinder(tmp_path / "s.tsv", [row])
    with pytest.raises(InputFormatError, match=r"s\.tsv: non-numeric values in 'pct_identity'"):
        read_amrfinder(path)
