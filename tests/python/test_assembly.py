import pytest
from helpers import write_contigs

from amrtools.errors import InputFormatError
from amrtools.parsers.assembly import AssemblyStats, n50, read_assembly


def test_n50_picks_contig_that_reaches_half_the_assembly():
    assert n50([100, 200, 300, 400]) == 300


def test_n50_single_contig():
    assert n50([42]) == 42


def test_n50_of_empty_assembly_is_zero():
    assert n50([]) == 0


def test_read_assembly_handles_multiline_sequences(tmp_path):
    fasta = tmp_path / "contigs.fa"
    fasta.write_text(">c1 len=6\nACGT\nAC\n>c2\nACG\n>c3\nA\n")
    assert read_assembly(fasta) == AssemblyStats(total_length=10, n_contigs=3, n50=6)


def test_read_assembly_from_helper(tmp_path):
    fasta = write_contigs(tmp_path / "contigs.fa", [50, 30, 20])
    assert read_assembly(fasta) == AssemblyStats(total_length=100, n_contigs=3, n50=50)


def test_empty_fasta_gives_zero_stats(tmp_path):
    fasta = tmp_path / "contigs.fa"
    fasta.write_text("")
    assert read_assembly(fasta) == AssemblyStats(total_length=0, n_contigs=0, n50=0)


def test_sequence_before_first_header_is_rejected(tmp_path):
    fasta = tmp_path / "contigs.fa"
    fasta.write_text("ACGT\n>c1\nA\n")
    with pytest.raises(InputFormatError, match="sequence before first FASTA header"):
        read_assembly(fasta)
