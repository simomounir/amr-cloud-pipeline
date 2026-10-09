# Results: carbapenemases in high-risk *K. pneumoniae* clones over time

Run `20261009T104928Z` (Cloud run [37919795836](https://github.com/simomounir/amr-cloud-pipeline/actions/runs/37919795836)),
published as dataset [`dataset-2026-10-09`](https://github.com/simomounir/amr-cloud-pipeline/releases/tag/dataset-2026-10-09).
Design and limits: [README.md](README.md).

## Run

| | |
|---|---|
| Genomes | 156 selected, **152 analysed**, 4 failed (assembly failed twice: ERR3063478, SRR10294975, SRR4302241, ERR10321617; cause not yet checked) |
| QC | 134 pass, 18 warn (kept in the table below; the dashboard hides QC warnings by default) |
| Infrastructure | AWS Batch spot, up to 96 vCPUs, 2 h 09 min, 17.8 instance-hours |
| Cost | **$4.76 total, $0.031 per genome** (spot compute, disk, public IPv4) |

## Agreement with the source's calls

Each genome's sequence type and carbapenemases were also called independently by
Pathogenwatch (Kleborate) in AMRnet's table, which this pipeline never sees.

| | Agree | Differences |
|---|---|---|
| Sequence type | **151 / 152 (99%)** | SRR1561273: ST11 (AMRnet) vs ST11-1LV (here; one locus differs) |
| Carbapenemase family | **150 / 152 (99%)** | ERR10030746: none vs "other"; SRR18747000: none vs KPC (here). Worth a look. |

## Carbapenemase families by clone and period

Percent of analysed genomes in each row (about 13 genomes per row; ST258/512 counted together).

| Clone | Period | KPC | NDM | OXA-48-like | VIM | NDM + OXA-48-like | other / mixed | none |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| ST11 | 2012 or earlier | 38 | 15 | 8 | | | 8 | 31 |
| | 2013–2017 | 31 | 15 | 15 | | 8 | | 31 |
| | 2018 or later | 38 | 31 | 8 | | 8 | | 15 |
| ST147 | 2012 or earlier | | 15 | 8 | 23 | | 8 | 46 |
| | 2013–2017 | 10 | 30 | 30 | | 10 | | 20 |
| | 2018 or later | 17 | 42 | 25 | | 8 | | 8 |
| ST258/512 | all periods | 100 | | | | | | |
| ST307 | 2012 or earlier | 8 | | | | | | 92 |
| | 2013–2017 | 23 | 15 | 8 | | | | 54 |
| | 2018 or later | 8 | 8 | 15 | | 15 | | 54 |

## What it shows

- **ST258/512 is the KPC clone:** every genome carries KPC, in every period.
- **ST147 became an NDM / OXA-48-like carrier:** genomes without a carbapenemase fall from 46% to
  8%, NDM rises from 15% to 42%, and the early VIM genomes disappear.
- **ST11 keeps KPC and adds NDM:** KPC stays near 35%, NDM doubles (15% to 31%).
- **ST307, known for the CTX-M-15 ESBL, is picking up carbapenemases:** from 8% to 46% of genomes.

These describe this sample of public genomes (which over-represents resistant and outbreak
isolates, 13 per clone and period), not prevalence.
