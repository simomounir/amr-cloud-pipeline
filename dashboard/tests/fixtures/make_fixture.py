"""Write the dashboard's fixture dataset (isolates F1-F6) with amrtools, so it uses the
real schema. Run from the repo root: .venv/bin/python dashboard/tests/fixtures/make_fixture.py
"""

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tests" / "python"))

from dataset_helpers import gene_record, sample_record, summary_record, write_run  # noqa: E402

from amrtools.dataset import build_dataset  # noqa: E402

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


def main() -> None:
    staging = ROOT / "dashboard" / "tests" / "fixtures" / "run"
    out = ROOT / "dashboard" / "tests" / "fixtures" / "data"
    shutil.rmtree(staging, ignore_errors=True)
    shutil.rmtree(out, ignore_errors=True)
    samples, summaries, genes = [], [], []
    for sample, (country, year, source, st, qc) in ISOLATES.items():
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
        for symbol, subclass, element_type, subtype in GENES[sample]:
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
    write_run(staging, samples, genes, summaries)
    build_dataset([staging], out)
    shutil.rmtree(staging)
    print(f"fixture dataset written to {out}")


if __name__ == "__main__":
    main()
