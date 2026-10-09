# Studies

A study is a question plus the public genomes chosen to answer it. Each folder holds:

- `study.yaml`: `title`, `question`, `organism` (AMRFinderPlus name, e.g. `Klebsiella_pneumoniae`)
  and `max_isolates` (a cost guard, at least 1: runs never process more than this).
- `accessions.txt`: ENA run, sample or study accessions, one per line.
- `story.md`: hand-written interpretation. Front matter (`title`, `question`, `focus`), then
  `## Background` paragraphs and `## Findings` with one `### Title {#figure}` per finding. Figures:
  `heatmap`, `periods`, `map`, `agreement` (or none). An optional `## Caveats` section (paragraphs)
  follows. The site shows this text as written.
- Optional reference keys in `study.yaml`: `reference_name` (shown as the comparison source),
  `reference_st_column` and `reference_carbapenemases_column` (column names in `cohort.csv`
  holding the reference's sequence type and carbapenemase calls).

Run one on AWS from GitHub: **Actions → Cloud run → Run workflow**, enter the folder name.
Results arrive as a workflow artifact; publish with `scripts/publish-dataset.sh` when happy.
