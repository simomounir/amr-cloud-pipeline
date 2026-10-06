import pytest

from amrtools.errors import InputFormatError
from amrtools.merge import merge_tables

COLUMNS = ["sample", "value"]


def write(path, text):
    path.write_text(text)
    return path


def test_merge_sorts_by_sample_and_keeps_text(tmp_path):
    b = write(tmp_path / "b.tsv", "sample\tvalue\nb\t0.900\n")
    a = write(tmp_path / "a.tsv", "sample\tvalue\na\t\n")
    merged = merge_tables([b, a], COLUMNS)
    assert list(merged["sample"]) == ["a", "b"]
    assert list(merged["value"]) == ["", "0.900"]


def test_header_only_tables_contribute_no_rows(tmp_path):
    empty = write(tmp_path / "e.tsv", "sample\tvalue\n")
    full = write(tmp_path / "f.tsv", "sample\tvalue\nx\t1\n")
    assert len(merge_tables([empty, full], COLUMNS)) == 1


def test_no_inputs_gives_empty_table_with_columns():
    merged = merge_tables([], COLUMNS)
    assert merged.empty
    assert list(merged.columns) == COLUMNS


def test_mismatched_columns_are_rejected(tmp_path):
    bad = write(tmp_path / "bad.tsv", "sample\tother\nx\t1\n")
    with pytest.raises(InputFormatError, match="bad.tsv: columns do not match"):
        merge_tables([bad], COLUMNS)
