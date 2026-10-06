# Test data

## Tiny dataset (GitHub Release `test-data-v1`)

Three *Klebsiella pneumoniae* Illumina paired-end runs, subsampled to ~20x with
seqtk (seed 42) by `make_test_data.sh`. Reads are not stored in git.

| Run | Platform | Expected species | Expected ST | Carbapenemase |
|---|---|---|---|---|
| SRR5386028 | NextSeq 500 | Klebsiella pneumoniae | ST13 | KPC-2 |
| ERR14097885 | MiSeq | Klebsiella pneumoniae | ST147 | NDM-5 |
| SRR33580217 | NextSeq 2000 | Klebsiella pneumoniae | ST23 | none |

Expected values come from Kleborate's own test outputs
(klebgenomics/Kleborate, `test/kpsc_test/example_output`, commit f5b116a).
These are public data: results demonstrate the method, not new findings.

## Stub dataset (`stub/`)

One fake read per file, used only by `-stub` runs to check pipeline wiring.
