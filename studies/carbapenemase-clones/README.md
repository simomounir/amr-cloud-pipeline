# Carbapenemases in high-risk *K. pneumoniae* clones over time

**Question.** Which carbapenemase families (KPC, NDM, OXA-48-like, VIM, IMP) travel with the
high-risk clones ST11, ST147, ST258/512 and ST307, and how has that changed over time?

**Cohort (156 genomes, 55 countries, 1999–2022).** Drawn from AMRnet's public table of
Pathogenwatch *K. pneumoniae* genomes (snapshot 2025-08-05, pinned by SHA-256 in
`select_cohort.py`): genomes that pass AMRnet's curation, are not duplicates and have an ENA run,
a collection year and a country. 4 clones × 3 periods (2012 or earlier, 2013–2017, 2018 or later)
× 13 genomes; within each cell a seeded random order, one genome per country before any country
repeats. Carbapenemase genes were **not** used to select genomes: they are the outcome.
`excluded.txt` lists runs dropped because the pipeline cannot use them (single-end reads).

**Files.** `accessions.txt` (what the Cloud run processes), `cohort.csv` (each genome's clone,
period, country and AMRnet's own ST and carbapenemase calls, for an agreement check against this
pipeline), `select_cohort.py` (reproduces both).

**Limits.** Public genomes over-represent resistant and outbreak-associated isolates, and the
clone labels come from the source's typing; results describe this sample, not prevalence.
