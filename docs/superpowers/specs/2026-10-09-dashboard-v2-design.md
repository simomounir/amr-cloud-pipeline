# Dashboard v2 and README: one story per study — Design

Date: 2026-10-09. Approved in conversation, section by section. Builds on Phase 3 (dashboard) and
study 1 (`studies/carbapenemase-clones`, release `dataset-2026-10-09`).

## Goal and audience

Show the whole chain — public genomes → AWS pipeline → validated results → interpretation — to a
mostly technical audience (data engineers, bioinformaticians, hiring reviewers), with enough
background that non-specialists can follow. Each study is a re-analysis of public data, not new
science, but each gets a story and an honest interpretation.

Success: a visitor gets a study's question and main finding in about 30 seconds, can then explore
by clicking, and can see how it was done (method, cost per genome, agreement with a reference,
failures, caveats). New studies add a page without a redesign.

Look: clean and technical, not journalistic. Neutral surfaces, one accent, the existing
colour-blind-safe carbapenemase palette in fixed order, monospace for accessions and versions,
captions with n under every chart, light and dark mode. Short background paragraphs where they
help (what a carbapenemase is, why these clones are "high-risk", why public genomes are biased).

Scope: *Klebsiella pneumoniae* only (Kleborate is Klebsiella-specific); stated on the home page.
Studies may focus on one topic (study 1: carbapenemases) but Explore shows all AMR elements.

## 1. Pages (hash routes; static site, no server)

- **Home** (`#/`): two or three sentences on the project; **How it works** — a small pipeline
  diagram and five one-line steps (pick a question and cohort → one click on GitHub → AWS spot
  runs the pipeline, ~2 h and ~$5 for 150 genomes → validated results are published → this site
  queries them in your browser), linking to Method; stat tiles across studies (genomes analysed,
  cost per genome, agreement with the reference, studies); one card per study (question, one-line
  key finding, thumbnail of its main figure).
- **Study** (`#/study/<name>`), always in this order:
  1. Question and background (3–4 sentences).
  2. Findings: 3–4 numbered statements, **each with its own figure**, takeaway above, caption with
     n below. Text is hand-written per study.
  3. Linked views: timeline, AMR element profile, isolate table (accessions link to ENA).
  4. How we know: cohort design; agreement with the reference (rates and every disagreement);
     failed samples; run cost and time; tool and database versions; caveats.
- **Explore** (`#/explore`): today's filters, charts and table across all published studies, plus
  a study filter.
- **Method** (`#/method`): pipeline tools and versions, cloud architecture, cost, validation;
  mostly links into the repository.

## 2. Data for several studies

- One dataset release per study, tagged `dataset-<study>-YYYY-MM-DD` (date-only tags would
  collide when two studies publish on the same day; older `dataset-YYYY-MM-DD` tags stay valid).
  Besides the three Parquet tables and `manifest.json`, a release carries:
  - `cohort.parquet`: the study's design variables per genome (study 1: clone, period, curated
    year, country) and the reference's calls (study 1: AMRnet ST and carbapenemases), from
    `studies/<name>/cohort.csv`.
  - `study.json`: name, title, question, background and findings text (from
    `studies/<name>/story.md`), run facts (run id, genomes selected/analysed/failed, cost, wall
    time, instance-hours) and agreement figures (computed at publish time from the dataset and
    the cohort).
- `dashboard/dataset.txt` becomes `dashboard/studies.json`: an ordered list of
  `{ "study": <name>, "release": <tag> }`. Publishing a study is still a commit; the Pages build
  downloads every listed release into `public/data/<study>/`.
- Each study page loads only its release; Explore loads all and adds a `study` column in the
  browser. The same genome in two studies is fine: nothing is merged on disk.
- Study pages use the cohort's curated year where the ENA metadata has none (study 1: 9% of
  genomes), so no "undated" bar.
- No change to the pipeline or the Parquet schema; validation and earlier releases are untouched.
- `studies/<name>/story.md` (hand-written, reviewed like code): front matter with `title`,
  `question`, `focus`; sections `## Background` and `## Findings` (one `### ` heading per finding,
  each naming the figure it goes with by id).
- `scripts/publish-dataset.sh --study <name>` builds the extra files, creates the release and
  updates `studies.json`. Study 1's release is republished with them as a new tag.

## 3. Figures and interactions

Study 1 findings and figures:
1. *Each clone has a signature carbapenemase*: heatmap, clones × families (with "none"), % of
   genomes, one sequential hue; toggle to three small heatmaps by period on one scale.
2. *ST147 switched to NDM and OXA-48-like; ST307 is gaining carbapenemases*: small multiples, one
   panel per clone, 100% stacked bars for the three periods, coloured by family, short
   annotations where the change is.
3. *Where the genomes come from*: world map, a dot per country sized by genomes; hover lists
   clones and families; caption: sampling reflects who sequenced, not prevalence.
4. *Can we trust the calls?*: agreement matrix (ours vs the reference) for ST and carbapenemase
   family, with the disagreements listed (incl. ERR10030746, blaGES-5, missed by the reference).

Interactions:
- Clicking a heatmap cell, a stacked-bar segment or a map dot filters the linked views below;
  unselected marks fade. Active filters are removable chips in one row above the views.
- State lives in the URL (`#/study/carbapenemase-clones?clone=ST147&family=NDM`), so links share
  a view.
- Every mark has a hover tooltip with exact count and n. Every chart has a legend (≥ 2 series),
  direct labels where ≤ 4 series, and a table view.

Colour: carbapenemase families keep their fixed hue order everywhere (NDM is always the same
blue); magnitude uses one sequential hue. Palettes are checked with the dataviz validator for
light and dark surfaces; dark mode has its own validated steps.

Technology: React 19, Observable Plot, DuckDB-WASM (unchanged). Map: `world-atlas` +
`topojson-client`, bundled (no external map service). Routing: a small hash router (no new
dependency unless it pays for itself).

## 4. Repository README

Rewrite the top-level README: pitch, live link, a dashboard screenshot, three headline numbers;
a Mermaid architecture diagram (GitHub Actions, OIDC, deployer and runner roles, Terraform, AWS
Batch spot, S3, Releases, Pages) and what happens on a Cloud run; a studies table (question, n,
cost, finding, link to `RESULTS.md`); engineering (tests, final reviews, safety nets, resume,
pinned versions, pinned cohorts); how to run locally, in CI and on AWS. Details stay in `infra/`,
`dashboard/` and `studies/` READMEs.

## 5. Testing

- Unit (vitest): selection/filter state, URL state round trip, route parsing, `studies.json` and
  `study.json` loading, the query behind each new figure, on fixture data with **two studies**
  sharing one genome.
- End to end (Playwright): home shows every study card; a study page shows its findings and
  figures; clicking a heatmap cell filters the table and adds a chip; a shared URL restores the
  selection; Explore shows both studies; dark mode toggles.
- Palettes: dataviz validator, light and dark.
- Screenshots at desktop and phone width, inspected before the PR.
- Publishing: `publish-dataset.sh` tests extended to `cohort.parquet`, `study.json` and
  `studies.json`; a workflow test that Pages downloads every listed release.

## Not in this phase

Study 3 itself (its page comes with its run); other species; scroll-driven animation; a backend.
The cause of study 1's four failed assemblies is checked when an `aws login` session is available
and added to `RESULTS.md`.
