"""Select the study cohort from AMRnet's public K. pneumoniae table (Pathogenwatch genomes).

Design: 4 high-risk clones x 3 collection periods x 13 genomes. Within each cell, genomes are
drawn in a seeded random order, one per country before any country repeats. Carbapenemase genes
are NOT used for selection: they are the outcome. Runs listed in --exclude (e.g. single-end runs
that fetch-samples skips) are dropped and the next genome of the same cell takes their place.

Usage (from the repo root):
    .venv/bin/python studies/carbapenemase-clones/select_cohort.py \
        --amrnet amrnetdb-Klebsiella_pneumoniae.csv.gz
(runs listed in excluded.txt next to this script are dropped by default)

The AMRnet snapshot is refreshed weekly; the one used is pinned by its SHA-256 below and was
downloaded from https://amrnet.s3.amazonaws.com/amrnet-latest/amrnetdb-Klebsiella_pneumoniae.csv.gz
(Last-Modified 2025-08-05).
"""

import argparse
import hashlib
from pathlib import Path

import numpy as np
import pandas as pd

SNAPSHOT_SHA256 = "aba3753f4b7cf603d9dc075080a3c9f4fdf48c46cc7c7b25315459885b39410d"
SEED = 20261009
PER_CELL = 13
CLONES = {"ST258": "ST258/512", "ST512": "ST258/512", "ST11": "ST11", "ST147": "ST147",
          "ST307": "ST307"}  # fmt: skip
PERIOD_BINS, PERIODS = [0, 2012, 2017, 2100], ["2012 or earlier", "2013-2017", "2018 or later"]
HERE = Path(__file__).resolve().parent


def load(path: Path) -> pd.DataFrame:
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != SNAPSHOT_SHA256:
        raise SystemExit(f"{path}: not the pinned AMRnet snapshot (sha256 {digest})")
    d = pd.read_csv(path, low_memory=False)
    d["run"] = d["Run accession"].fillna(d["run accession"])
    usable = (
        (d["dashboard view"] == "include")  # AMRnet's own curation
        & d["Duplicates"].isna()
        & d["run"].notna()
        & d["DATE"].notna()
        & d["COUNTRY_ONLY"].notna()
    )
    d = d[usable].copy()
    d["year"] = d["DATE"].astype(int)
    d["clone"] = d["GENOTYPE"].map(CLONES)
    d = d[d["clone"].notna()].copy()
    d["period"] = pd.cut(d["year"], PERIOD_BINS, labels=PERIODS).astype(str)
    return d


def select(d: pd.DataFrame, excluded: set[str]) -> pd.DataFrame:
    rng = np.random.default_rng(SEED)
    cells = []
    for _, cell in d.groupby(["clone", "period"], sort=True):
        cell = cell.sample(frac=1, random_state=int(rng.integers(1 << 31)))
        cell = cell[~cell["run"].isin(excluded)].copy()
        cell["round"] = cell.groupby("COUNTRY_ONLY").cumcount()  # 0 = first genome of a country
        cells.append(cell.sort_values("round", kind="stable").head(PER_CELL))
    return pd.concat(cells)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--amrnet", type=Path, required=True)
    parser.add_argument("--exclude", type=Path, default=HERE / "excluded.txt")
    args = parser.parse_args()
    excluded = set(args.exclude.read_text().split()) if args.exclude.exists() else set()
    cohort = select(load(args.amrnet), excluded)
    columns = {"run": "run_accession", "clone": "clone", "period": "period", "year": "year",
               "COUNTRY_ONLY": "country", "GENOTYPE": "amrnet_st",
               "Bla_Carb_acquired": "amrnet_carbapenemases",
               "resistance_score": "amrnet_resistance_score",
               "virulence_score": "amrnet_virulence_score"}  # fmt: skip
    table = cohort[list(columns)].rename(columns=columns)
    table.to_csv(HERE / "cohort.csv", index=False)
    (HERE / "accessions.txt").write_text("\n".join(table["run_accession"]) + "\n")
    print(f"{len(table)} genomes, {table['country'].nunique()} countries, "
          f"{table['year'].min()}-{table['year'].max()}")  # fmt: skip


if __name__ == "__main__":
    main()
