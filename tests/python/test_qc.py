import pytest

from amrtools.parsers.assembly import AssemblyStats
from amrtools.parsers.fastp import FastpStats
from amrtools.qc import QcThresholds, qc_reasons

GOOD_ASSEMBLY = AssemblyStats(total_length=5_500_000, n_contigs=120, n50=150_000)
GOOD_FASTP = FastpStats(reads_after_qc=700_000, q30_rate=0.92)
KP = "Klebsiella pneumoniae"


def reasons(assembly=GOOD_ASSEMBLY, fastp=GOOD_FASTP, species=KP):
    return qc_reasons(
        assembly=assembly,
        fastp=fastp,
        species=species,
        organism="Klebsiella_pneumoniae",
        thresholds=QcThresholds(),
    )


def test_good_sample_passes():
    assert reasons() == []


@pytest.mark.parametrize("length", [5_000_000, 6_500_000])
def test_assembly_length_bounds_are_inclusive(length):
    assert reasons(assembly=AssemblyStats(length, 120, 150_000)) == []


@pytest.mark.parametrize("length", [4_999_999, 6_500_001])
def test_assembly_length_outside_bounds_warns(length):
    assert reasons(assembly=AssemblyStats(length, 120, 150_000)) == ["assembly_length"]


def test_contig_count_must_be_below_limit():
    assert reasons(assembly=AssemblyStats(5_500_000, 499, 20_000)) == []
    assert reasons(assembly=AssemblyStats(5_500_000, 500, 20_000)) == ["n_contigs"]


def test_q30_must_be_above_limit():
    assert reasons(fastp=FastpStats(700_000, 0.81)) == []
    assert reasons(fastp=FastpStats(700_000, 0.80)) == ["q30_rate"]


def test_species_must_match_organism():
    assert reasons(species="Klebsiella variicola") == ["species_mismatch"]
    assert reasons(species="NA") == ["species_mismatch"]


def test_all_reasons_reported_in_fixed_order():
    assert reasons(
        assembly=AssemblyStats(1_000_000, 900, 2_000),
        fastp=FastpStats(10, 0.5),
        species="NA",
    ) == ["assembly_length", "n_contigs", "q30_rate", "species_mismatch"]
