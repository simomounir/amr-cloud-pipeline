import pytest
from helpers import write_fastp

from amrtools.errors import InputFormatError
from amrtools.parsers.fastp import FastpStats, read_fastp


def test_reads_after_filtering_values(tmp_path):
    report = write_fastp(tmp_path / "s.fastp.json", total_reads=1000, q30_rate=0.912)
    assert read_fastp(report) == FastpStats(reads_after_qc=1000, q30_rate=0.912)


def test_missing_after_filtering_is_rejected(tmp_path):
    report = tmp_path / "s.fastp.json"
    report.write_text('{"summary": {}}')
    with pytest.raises(InputFormatError, match="missing fastp field 'after_filtering'"):
        read_fastp(report)


def test_invalid_json_is_rejected(tmp_path):
    report = tmp_path / "s.fastp.json"
    report.write_text("")
    with pytest.raises(InputFormatError, match="not valid fastp JSON"):
        read_fastp(report)
