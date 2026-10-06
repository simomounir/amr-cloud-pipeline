"""Species, sequence type and scores from Kleborate v3 output (--trim_headers)."""

from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from amrtools.errors import InputFormatError


@dataclass(frozen=True)
class KleborateResult:
    species: str
    st: str
    resistance_score: str
    virulence_score: str


NO_RESULT = KleborateResult(species="NA", st="NA", resistance_score="NA", virulence_score="NA")

# Species of the K. pneumoniae species complex; for these the kpsc preset must report typing.
_KPSC_SPECIES = (
    "Klebsiella pneumoniae",
    "Klebsiella quasipneumoniae",
    "Klebsiella variicola",
    "Klebsiella quasivariicola",
    "Klebsiella africana",
)
_KPSC_REQUIRED = ("ST", "resistance_score", "virulence_score")


def read_kleborate(path: Path) -> KleborateResult:
    """An empty file means Kleborate wrote no result for this assembly (outside the preset).

    Typing columns may be absent only for species outside the K. pneumoniae complex.
    """
    path = Path(path)
    if path.stat().st_size == 0:
        return NO_RESULT
    table = pd.read_csv(path, sep="\t", dtype=str, keep_default_na=False)
    if "species" not in table.columns:
        raise InputFormatError(f"{path}: missing Kleborate column 'species'")
    if len(table) != 1:
        raise InputFormatError(f"{path}: expected 1 Kleborate row, found {len(table)}")
    row = table.iloc[0]
    if row["species"].startswith(_KPSC_SPECIES):
        for column in _KPSC_REQUIRED:
            if column not in table.columns:
                raise InputFormatError(f"{path}: missing Kleborate column '{column}'")

    def field(name: str) -> str:
        return row.get(name, "") or "NA"

    return KleborateResult(
        species=field("species"),
        st=field("ST"),
        resistance_score=field("resistance_score"),
        virulence_score=field("virulence_score"),
    )
