# AMR Cloud Pipeline: Project Brief

Second portfolio project (after the Tahoe virtual-cell project). Goal: showcase **data engineering + cloud skills** with a hot bioinformatics topic, at minimal cost.

## 1. Goals and constraints

- Audience: employers, recruiters, freelance clients
- Skills to show: cloud (AWS), infrastructure as code, containerized workflows, data engineering, bioinformatics
- Languages: Python, C++ (optional C++ angle: a k-mer sketching tool with pybind11 bindings)
- Budget: as close to free as possible
- Focus: **engineering and cloud side**. Start with **isolates**; consider **metagenomes** later
- Run the compute on **AWS**, publish code, results, and dashboard on **GitHub**
- Later phase: GitHub repo with CI/CD, unit tests, and tests triggered on commits to main

## 2. What is AMR?

Antimicrobial resistance: microbes surviving drugs that used to kill them. Resistance usually comes from specific genes (e.g. beta-lactamases) or point mutations in drug-target genes. Many resistance genes sit on plasmids and mobile elements. They can be detected by sequencing and comparing against curated databases (CARD, ResFinder, NCBI AMRFinderPlus).

Real-world uses of this kind of analysis:

- Wastewater surveillance (track circulating resistance genes in a city)
- Hospital outbreak tracking (same strain across wards?)
- Predicting which antibiotics will fail from the genome
- Agriculture and food-safety monitoring (One Health)
- Research on how resistance spreads

**Framing caveat:** this project uses public data, so results demonstrate a *method*, not new surveillance findings. Say so in the write-up.

## 3. Isolates vs metagenomes

| | Isolates | Metagenomes |
|---|---|---|
| What it is | One cultured organism sequenced | Whole community sequenced at once |
| Question | What resistance does *this strain* carry? | What resistance circulates in *this environment*? |
| Data per sample | ~0.5-2 GB | ~5-20+ GB |
| Main steps | QC, assemble, annotate, AMR calls, strain typing | QC, host removal, taxonomic profiling, AMR detection, abundance |
| Difficulty | Well-established, cleaner | Messier; linking genes to species is hard |
| Compute / RAM | Light | Heavy (large reference databases) |
| Cost per sample | Low | ~5-10x higher |

**Decision:** start with isolates. Metagenomes are a *second pipeline* sharing the platform, not a toggle (likely several extra weeks). A cheaper middle path later: read-based AMR profiling (map reads to a resistance database, plus taxonomic profiling, no assembly).

**What carries over from isolates to metagenomes:** Terraform, Nextflow setup, containers, CI/CD, S3 handoff, dashboard and Parquet serving layer, read QC, AMR databases, cost tracking.
**What doesn't:** assembly/annotation logic, taxonomic profiling, gene-to-organism linking, abundance quantification, the results data model, validation.

## 4. Architecture

```
Public data (SRA / AWS Open Data)
        |
        v
Nextflow pipeline (many short-lived containers, AWS Batch + spot)
        |
        v
Parquet results in S3 (small, permanent handoff point)
        |
        v
Copy to GitHub (repo or Release)  ->  terraform destroy
        |
        v
Dashboard on GitHub Pages (DuckDB-WASM reads Parquet in-browser)
        |
        v
Visitors
```

Key design point: compute and serving communicate **only through results files**. The pipeline can be rerun or improved without touching the dashboard, and after teardown the ongoing AWS bill is $0.

### Dashboard levels (what visitors can do)

1. **Precomputed trend dashboard**: filter, compare, drill down (free, static site). **Build this.**
2. **Query layer**: in-browser SQL via DuckDB-WASM, optionally a small serverless API (FastAPI on Lambda/Cloud Run over Parquet in S3). Use predefined filters, not arbitrary SQL, if exposing an API.
3. **Bring-your-own-data**: users upload data and trigger runs. Expensive and risky (cost, privacy, reliability, validation). **Roadmap only**; at most allow tiny public accession IDs with hard caps.

## 5. Suggested repo structure

```
amr-cloud-pipeline/
  pipeline/        # Nextflow workflows and modules (one module per stage)
  containers/      # Dockerfiles per tool
  infra/           # Terraform (S3, IAM, Batch, budget alerts, OIDC)
  dashboard/       # Static site (DuckDB-WASM + charts)
  schemas/         # Versioned results schema (Parquet)
  tests/           # Unit tests + tiny test dataset
  docs/            # Architecture diagram, cost report, write-up
  .github/workflows/  # CI (tiny-dataset tests), site deploy
```

## 6. Phased plan

**Phase 1: Foundations (local, $0)**
- Create the repo with the structure above
- Pick 3-5 public isolate genomes as a tiny test dataset
- Build local Docker-based steps: read QC, assembly, AMR calling (AMRFinderPlus), species ID
- Unit tests plus a GitHub Actions workflow running the tiny dataset on every push to main

**Phase 2: Standardize the output (local, $0)**
- Define the results schema: sample metadata, detected genes, run summary (versioned)
- Parquet conversion and validation step
- Real metadata cleaning (dates, locations, source), since public metadata is messy

**Phase 3: Dashboard (local, $0)**
- Build against test-run Parquet: filters, trend charts, drill-down to accession IDs, CSV export
- Deploy to GitHub Pages via Actions
- Result: a working end-to-end project before spending anything on AWS

**Phase 4: Cloud (where credits go)**
- Terraform for S3, least-privilege IAM, AWS Batch with spot instances
- **Set the budget alert first**; set up GitHub-to-AWS access with OIDC (no stored keys)
- Small cloud run (~10-20 samples), then the full run (a few hundred isolates)
- Record actual cost per sample and runtime
- Copy results to GitHub, `terraform destroy`, check the console for leftover resources

**Phase 5: Polish**
- README with architecture diagram, cost breakdown, how to reproduce
- Write-up: design choices, limitations, roadmap
- Optional: strain-level comparison (phylogenetic tree), small API

**Phase 6 (later): Metagenome mode**
- Second Nextflow workflow on the same infrastructure, results store, and dashboard shell

## 7. Design choices to make metagenomes easier later

- Keep each pipeline stage modular with clearly defined inputs and outputs
- Version the results schema; include `sample_type` and `organism` fields from the start so an abundance table can later sit next to the gene table
- Keep reference databases configurable, not hard-coded
- Make the dashboard read from tables, not isolate-specific assumptions

## 8. Cost estimates (rough)

> These are planning numbers from general pricing knowledge, not verified quotes. Run the real design through the AWS Pricing Calculator before the big run.

**AWS credits:** new accounts (created after 15 July 2025) get $100 on signup, up to $200 total with onboarding tasks. Sources disagreed on the Free Plan duration (6 vs 12 months); check AWS's Free Tier page. On the Free Plan the account closes when credits run out or the period ends. The Paid plan gets the same credits but bills afterward. Because the public site lives on GitHub, AWS closing is not a problem.

**One-off pipeline run (spot instances, temporary storage deleted afterward)**

| Scenario | Rough compute |
|---|---|
| ~200 bacterial isolates | $5-20 |
| ~100 wastewater metagenomes (later) | $40-150 |
| 500+ metagenomes | $200-800+ |

Budget about 2x for the first run (tests, failures, reruns). Realistic totals: lean isolate build about $10-30; fuller build with reruns about $75-250.

**Ongoing monthly cost after teardown:** about $0-3 (S3 results pennies, GitHub Pages $0, optional domain ~$1/month).

**Surprise-bill checklist**
- NAT gateways (~$30+/month even idle): avoid or tear down
- Forgotten EBS volumes and running instances
- Data egress from AWS (~$0.09/GB): don't serve big files from S3
- Unbounded Athena/BigQuery queries
- Failed jobs retrying in a loop: set retry limits

**Habit to show off:** put the real cost per sample (e.g. "$0.12 per genome") in the README.

## 9. Day-one habits

- Never commit AWS keys; add `.gitignore` and a pre-commit secret scanner
- Set the AWS budget alert before launching anything
- GitHub file limit is 100 MB: keep tables compact, split them, or use Releases
- Use OIDC for GitHub Actions to AWS access

## 10. Next steps

- [ ] Choose the public isolate dataset for the tiny test set
- [ ] Create the repo with the structure in section 5
- [ ] First Nextflow modules: QC, assembly, AMRFinderPlus
- [ ] Define results schema v0.1
- [ ] Set up CI on the tiny dataset
