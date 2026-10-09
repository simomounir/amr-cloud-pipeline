"""Write the dashboard's two-study fixture with amrtools, so it uses the real schema.
study-a: isolates F1-F6, plus F7 whose analysis failed, with a cohort.csv and a reference.
study-b: F1 (also in study-a) and G1, with no cohort.csv.
Run from the repo root: .venv/bin/python dashboard/tests/fixtures/make_fixture.py
"""

import json
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tests" / "python"))

from dataset_helpers import gene_record, sample_record, summary_record, write_run  # noqa: E402

from amrtools.dataset import build_dataset  # noqa: E402
from amrtools.study import build_bundle  # noqa: E402

ISOLATES = {
    "F1": ("Germany", 2019, "blood", "ST258", "pass"),
    "F2": ("Germany", 2021, "urine", "ST147", "pass"),
    "F3": ("India", 2021, "wound", "ST147", "pass"),
    "F4": ("United States", None, "screening", "ST23", "pass"),
    "F5": ("India", 2020, "respiratory", "ST11", "warn"),
    "F6": ("Côte d'Ivoire", 2018, "other_clinical", "ST15", "pass"),
}
CARB, CEPH = "CARBAPENEM", "CEPHALOSPORIN"
GENES = {
    "F1": [
        ("blaKPC-2", CARB, "AMR", "AMR"),
        ("blaCTX-M-15", CEPH, "AMR", "AMR"),
        ("fosA", "FOSFOMYCIN", "AMR", "AMR"),
    ],
    "F2": [
        ("blaNDM-5", CARB, "AMR", "AMR"),
        ("blaCTX-M-15", CEPH, "AMR", "AMR"),
        ("fosA", "FOSFOMYCIN", "AMR", "AMR"),
        ("blaSHV-11", "BETA-LACTAM", "AMR", "AMR"),
    ],
    "F3": [
        ("blaNDM-1", CARB, "AMR", "AMR"),
        ("blaOXA-232", CARB, "AMR", "AMR"),
        ("fosA", "FOSFOMYCIN", "AMR", "AMR"),
    ],
    "F4": [
        ("blaCTX-M-14", CEPH, "AMR", "AMR"),
        ("fosA", "FOSFOMYCIN", "AMR", "AMR"),
        ("ompK36_D135DGD", CARB, "AMR", "POINT"),
        ("iutA", None, "VIRULENCE", "VIRULENCE"),
    ],
    "F5": [("blaKPC-3", CARB, "AMR", "AMR")],
    "F6": [],
}


COHORT_A = """run_accession,clone,period,year,country,ref_st_col,ref_carb_col
F1,ST258/512,2013-2017,2019,Germany,ST258,KPC-2
F2,ST147,2018 or later,2021,Germany,ST147,NDM-5
F3,ST147,2018 or later,2021,India,ST147,NDM-1;OXA-232
F4,ST11,2013-2017,2016,United States,ST23,-
F5,ST11,2018 or later,2020,India,ST15,KPC-3
F6,ST307,2012 or earlier,2018,Côte d'Ivoire,ST15,KPC-2
F7,ST307,2018 or later,2020,Nigeria,ST307,-
"""

YAML_A = """title: Fixture study A
reference_name: Fixture reference
reference_st_column: ref_st_col
reference_carbapenemases_column: ref_carb_col
"""

STORY_A = """---
title: Fixture study A
question: Which carbapenemases does each clone carry?
focus: carbapenemases
---
## Background
Fixture background paragraph.

## Findings
### Heatmap finding {#heatmap}
Text one.

### Periods finding {#periods}
Text two.

### Map finding {#map}
Text three.

### Agreement finding {#agreement}
Text four.

## Caveats
Fixture caveat paragraph.
"""

STORY_B = """---
title: Fixture study B
question: Is a second study kept apart?
focus: carbapenemases
---
## Background
Fixture background paragraph.

## Findings
### A finding without a figure
Text.
"""

STUDIES = [
    {"study": "study-a", "release": "dataset-study-a-2026-10-01"},
    {"study": "study-b", "release": "dataset-study-b-2026-10-02"},
]


def isolate_records(isolates: dict, genes_by_sample: dict) -> tuple[list, list, list]:
    samples, summaries, genes = [], [], []
    for sample, (country, year, source, st, qc) in isolates.items():
        samples.append(
            sample_record(
                sample,
                run_id="fx",
                run_accession=f"SRR{sample[1]}000000",
                country=country,
                collection_year=year,
                collection_date_precision="year" if year else "missing",
                source_category=source,
            )
        )
        reasons = "" if qc == "pass" else "n_contigs"
        summaries.append(
            summary_record(sample, run_id="fx", st=st, qc_status=qc, qc_reasons=reasons)
        )
        for symbol, subclass, element_type, subtype in genes_by_sample[sample]:
            genes.append(
                gene_record(
                    sample,
                    run_id="fx",
                    gene_symbol=symbol,
                    element_name=symbol,
                    element_type=element_type,
                    element_subtype=subtype,
                    drug_class=(
                        "FOSFOMYCIN"
                        if subclass == "FOSFOMYCIN"
                        else "BETA-LACTAM"
                        if subclass
                        else None
                    ),
                    drug_subclass=subclass,
                )
            )
    return samples, summaries, genes


def write_study(name: str, out: Path, samples, genes, summaries, story, yaml, cohort) -> None:
    """Write one study's release files: the three tables, manifest, cohort.parquet, study.json."""
    staging = out.parent / f"run-{name}"
    shutil.rmtree(staging, ignore_errors=True)
    write_run(staging, samples, genes, summaries)
    build_dataset([staging], out / name)
    shutil.rmtree(staging)
    with tempfile.TemporaryDirectory() as tmp:
        study_dir = Path(tmp) / name
        study_dir.mkdir()
        (study_dir / "story.md").write_text(story)
        (study_dir / "study.yaml").write_text(yaml)
        if cohort:
            (study_dir / "cohort.csv").write_text(cohort)
        build_bundle(study_dir, out / name, None, out / name)


def main() -> None:
    out = ROOT / "dashboard" / "tests" / "fixtures" / "data"
    shutil.rmtree(out, ignore_errors=True)
    samples, summaries, genes = isolate_records(ISOLATES, GENES)
    # F7: metadata but no results (a pipeline step failed), as schema 1.2.0 records it.
    samples.append(
        sample_record("F7", run_id="fx", run_accession="SRR7000000", country="Nigeria",
                      collection_year=2020, collection_date_precision="year",
                      source_category="blood", analysis_status="failed")
    )  # fmt: skip
    write_study("study-a", out, samples, genes, summaries, STORY_A, YAML_A, COHORT_A)
    b_isolates = {"F1": ISOLATES["F1"], "G1": ("Kenya", 2022, "blood", "ST15", "pass")}
    b_genes = {"F1": GENES["F1"], "G1": [("blaNDM-1", CARB, "AMR", "AMR")]}
    samples, summaries, genes = isolate_records(b_isolates, b_genes)
    write_study(
        "study-b", out, samples, genes, summaries, STORY_B, "title: Fixture study B\n", None
    )
    (out / "studies.json").write_text(json.dumps(STUDIES) + "\n")
    print(f"fixture studies written to {out}")


if __name__ == "__main__":
    main()
