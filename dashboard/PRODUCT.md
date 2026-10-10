# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary: technical reviewers.** Hiring managers and engineers in data engineering, cloud and
  bioinformatics, judging the author's skills from a portfolio link. They arrive cold, skim first,
  then dig into one study, the method and the code.
- **Secondary: curious scientists** (microbiology, AMR). They should be able to follow each study's
  science without reading code.

## Product Purpose

A static site that presents studies: questions answered by re-analysing public *Klebsiella
pneumoniae* genomes with the AMR Cloud Pipeline. Each study page states its question, background,
findings with figures, and how the result was checked. Success: a reviewer understands within about
30 seconds what was built and what one study found, then can verify it (method, cost, agreement,
code) and explore the genomes.

## Positioning

One person built the whole chain and shows it end to end, with its limits stated openly: public
genomes (ENA) → reproducible cloud pipeline on AWS Batch spot (about $0.03 per genome, nothing
running between runs) → validated results (99% agreement with Pathogenwatch on sequence type and
carbapenemase family for study 1) → readable study pages queried in the browser.

## Operating Context

- Hosted on GitHub Pages from the repository `simomounir/amr-cloud-pipeline`; each study's data is a
  GitHub Release pinned in `dashboard/studies.json`; all queries run in the visitor's browser
  (DuckDB-WASM); no server, no accounts, no tracking.
- Visitors open it from a CV, LinkedIn or GitHub link, on desktop or phone.
- New studies are added over time; each brings its own story and figures.

## Capabilities and Constraints

- *Klebsiella pneumoniae* only for now (Kleborate is Klebsiella-specific).
- Story text and interpretation are hand-written per study in `studies/<name>/story.md`; the site
  never generates interpretation. Changing published story text requires republishing that study's
  release.
- Results describe the sampled public genomes, not prevalence; public genomes over-represent
  resistant and outbreak isolates. This caveat must stay visible.
- Terminology: "genome" for one analysed sample; ST (sequence type), clone, carbapenemase family
  (KPC, NDM, OXA-48-like, VIM, IMP, other, none).
- Static assets only; no external font, map or analytics services at runtime.

## Brand Commitments

- Project name: AMR Cloud Pipeline; site name: Klebsiella AMR.
- Author shown as the GitHub handle **simomounir**, linked to https://github.com/simomounir; no real
  name or other links.
- Voice: plain, precise, technical; not journalistic, no hype.

## Evidence on Hand

- Study 1 `studies/carbapenemase-clones` (`RESULTS.md`): 156 genomes selected, 152 analysed, 4
  failed assembly; $4.76 total; agreement 151/152 (ST) and 150/152 (carbapenemase family).
- Pipeline facts and costs: `README.md`, `infra/README.md`.
- No testimonials, users, press or benchmarks exist; do not invent any.

## Product Principles

1. Show the whole chain, from public data to finding, and make every step checkable.
2. Lead with the question and the finding; the numbers and code are one click away, not in the way.
3. State limits where the claim is made (sample bias, n, failures, disagreements).
4. Every figure earns its place by supporting a stated finding.
5. Reviewers are busy: the first screen must prove skill and seriousness.

## Accessibility & Inclusion

Every figure has a table view and keyboard-operable picks; colour never carries meaning alone;
light and dark themes; readable on phones.
