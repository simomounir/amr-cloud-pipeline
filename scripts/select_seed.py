"""Choose ~30 seed isolates from ENA: real K. pneumoniae Illumina runs, spread over
countries and years, plus runs from two studies known to carry carbapenemases.

Dev tool (needs network). Writes data/seed_accessions.txt deterministically for a
given ENA snapshot; the date and query are recorded in data/README.md.
"""

import csv
import io
import random
import sys
from collections import defaultdict
from pathlib import Path
from urllib.parse import urlencode

from amrtools.ena import http_get
from amrtools.metadata import clean_country, clean_date

SEARCH = "https://www.ebi.ac.uk/ena/portal/api/search"
QUERY = 'tax_eq(573) AND instrument_platform="ILLUMINA" AND library_layout="PAIRED"'
CARBAPENEMASE_STUDIES = {"PRJNA376414": 3, "PRJEB50614": 3}  # KPC (Houston), NDM (India)
SPREAD_TARGET = 24
MIN_BASES, MAX_BASES = 250_000_000, 1_000_000_000  # ~45x-180x of 5.5 Mb


def search(query: str, limit: int) -> list[dict]:
    params = {
        "result": "read_run",
        "query": query,
        "limit": limit,
        "format": "tsv",
        "fields": "run_accession,study_accession,collection_date,country,base_count",
    }
    text = http_get(f"{SEARCH}?{urlencode(params)}")
    return list(csv.DictReader(io.StringIO(text), delimiter="\t"))


def usable(row: dict) -> bool:
    year, _, _ = clean_date(row["collection_date"])
    country, _ = clean_country(row["country"])
    bases = int(row["base_count"] or 0)
    return year is not None and country is not None and MIN_BASES <= bases <= MAX_BASES


def main(out: Path) -> None:
    rng = random.Random(20261008)
    chosen: list[str] = []
    for study, n in CARBAPENEMASE_STUDIES.items():
        rows = [r for r in search(f'{QUERY} AND study_accession="{study}"', 500) if usable(r)]
        chosen += sorted(rng.sample(sorted(r["run_accession"] for r in rows), n))
    by_country: dict[str, list[dict]] = defaultdict(list)
    for row in search(QUERY, 20000):
        if usable(row) and row["study_accession"] not in CARBAPENEMASE_STUDIES:
            by_country[clean_country(row["country"])[0]].append(row)
    countries = sorted(by_country, key=lambda c: (-len(by_country[c]), c))
    for rows in by_country.values():
        rows.sort(key=lambda r: r["run_accession"])
        rng.shuffle(rows)
    spread: list[str] = []
    while len(spread) < SPREAD_TARGET and any(by_country.values()):
        for country in countries:
            if by_country[country] and len(spread) < SPREAD_TARGET:
                spread.append(by_country[country].pop()["run_accession"])
    out.write_text("\n".join(chosen + sorted(spread)) + "\n")
    print(f"wrote {len(chosen) + len(spread)} accessions to {out}", file=sys.stderr)


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "data/seed_accessions.txt"))
