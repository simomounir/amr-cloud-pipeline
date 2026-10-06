"""AMRFinderPlus report -> one row per detected element, with our column names."""

from pathlib import Path

import pandas as pd

from amrtools.errors import InputFormatError

# Our column -> accepted AMRFinderPlus headers (v4 first, then v3).
_ALIASES = {
    "gene_symbol": ["Element symbol", "Gene symbol"],
    "element_name": ["Element name", "Sequence name"],
    "element_type": ["Type", "Element type"],
    "element_subtype": ["Subtype", "Element subtype"],
    "drug_class": ["Class"],
    "drug_subclass": ["Subclass"],
    "method": ["Method"],
    "pct_identity": ["% Identity to reference", "% Identity to reference sequence"],
    "pct_coverage": ["% Coverage of reference", "% Coverage of reference sequence"],
    "contig_id": ["Contig id"],
}

AMRFINDER_FIELDS = list(_ALIASES)


def read_amrfinder(path: Path) -> pd.DataFrame:
    try:
        report = pd.read_csv(path, sep="\t", dtype=str, keep_default_na=False)
    except pd.errors.EmptyDataError as exc:
        raise InputFormatError(f"{path}: empty AMRFinderPlus report (no header line)") from exc

    columns = {}
    for ours, accepted in _ALIASES.items():
        source = next((name for name in accepted if name in report.columns), None)
        if source is None:
            raise InputFormatError(f"{path}: missing AMRFinderPlus column '{accepted[0]}'")
        columns[ours] = report[source]

    genes = pd.DataFrame(columns, columns=AMRFINDER_FIELDS)
    for name in ("pct_identity", "pct_coverage"):
        try:
            genes[name] = genes[name].astype(float)
        except ValueError as exc:
            raise InputFormatError(f"{path}: non-numeric values in '{name}'") from exc
    return genes
