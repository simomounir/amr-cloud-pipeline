# Seed dataset

`seed_accessions.txt` lists 30 public *Klebsiella pneumoniae* Illumina paired-end runs
used to build the dashboard's first real dataset on GitHub Actions (no cloud cost).

Chosen on 2026-10-08 by `scripts/select_seed.py` from the ENA Portal API
(`tax_eq(573) AND instrument_platform="ILLUMINA" AND library_layout="PAIRED"`):

- 3 runs each from PRJNA376414 (KPC study, Houston) and PRJEB50614 (NDM study, India),
  so carbapenemases are represented;
- 24 more, one country at a time (round robin), from runs with a collection year, a
  recognised country and 250 Mb–1 Gb of sequence (about 45x–180x).

Result on that date: 30 runs, 24 countries, collection years 2012–2024, none skipped by
`fetch-samples`.

ENA changes over time, so rerunning the script later can pick different runs; this
committed list is the record. Results are public data and demonstrate a method, not
surveillance findings.
