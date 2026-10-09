# Studies

A study is a question plus the public genomes chosen to answer it. Each folder holds:

- `study.yaml`: `title`, `question`, `organism` (AMRFinderPlus name, e.g. `Klebsiella_pneumoniae`)
  and `max_isolates` (a cost guard, at least 1: runs never process more than this).
- `accessions.txt`: ENA run, sample or study accessions, one per line.

Run one on AWS from GitHub: **Actions → Cloud run → Run workflow**, enter the folder name.
Results arrive as a workflow artifact; publish with `scripts/publish-dataset.sh` when happy.
