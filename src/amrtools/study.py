"""Per-study release files: cohort.parquet (design variables, reference calls) and study.json
(hand-written story, run facts, agreement with the reference), built at publish time."""

import csv
import json
import re
from datetime import datetime, timedelta
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from amrtools.errors import InputFormatError
from amrtools.validate import validate_dir

FIGURES = ("heatmap", "periods", "map", "agreement")
FAMILIES = ("KPC", "NDM", "OXA-48-like", "VIM", "IMP", "other")
STANDARD = ("clone", "period", "year", "country", "ref_st", "ref_carbapenemases")
_PREFIXES = (("blaKPC", "KPC"), ("blaNDM", "NDM"), ("blaOXA", "OXA-48-like"),
             ("blaVIM", "VIM"), ("blaIMP", "IMP"))  # fmt: skip


def family_of(symbol: str) -> str:
    """Carbapenemase family of an AMRFinderPlus symbol (same rule as the dashboard's SQL)."""
    return next((family for prefix, family in _PREFIXES if symbol.startswith(prefix)), "other")


def read_study_yaml(path: Path) -> dict[str, str]:
    """Flat `key: value` lines (study.yaml stays this simple on purpose)."""
    values = {}
    for line in Path(path).read_text().splitlines():
        if line.strip() and not line.lstrip().startswith("#") and ":" in line:
            key, _, value = line.partition(":")
            values[key.strip()] = value.strip()
    return values


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def parse_story(text: str) -> dict:
    front, _, body = text.partition("\n---\n")
    meta = {}
    for line in front.removeprefix("---\n").splitlines():
        key, _, value = line.partition(":")
        meta[key.strip()] = value.strip()
    sections = re.split(r"^## +(.+)$", body, flags=re.M)
    named = {sections[i].strip(): sections[i + 1] for i in range(1, len(sections) - 1, 2)}
    background = [p.strip() for p in named.get("Background", "").split("\n\n") if p.strip()]
    caveats = [p.strip() for p in named.get("Caveats", "").split("\n\n") if p.strip()]
    meaning = [p.strip() for p in named.get("What this means", "").split("\n\n") if p.strip()]
    findings = []
    for block in re.split(r"^### +", named.get("Findings", ""), flags=re.M)[1:]:
        heading, _, text_ = block.partition("\n")
        match = re.search(r"\s*\{#([^}\s]+)\}\s*$", heading)
        figure = match[1] if match else None
        if figure is not None and figure not in FIGURES:
            raise ValueError(f"unknown figure {{#{figure}}}; use one of {', '.join(FIGURES)}")
        title = heading[: match.start()].strip() if match else heading.strip()
        if any(f["id"] == _slug(title) for f in findings):
            raise ValueError(f"duplicate finding {title!r} (same id as an earlier finding)")
        findings.append({"id": _slug(title), "figure": figure, "title": title,
                         "text": " ".join(text_.split())})  # fmt: skip
    return {"title": meta.get("title", ""), "question": meta.get("question", ""),
            "focus": meta.get("focus", ""), "background": background,
            "findings": findings, "caveats": caveats,
            "meaning": meaning}  # fmt: skip


def _cohort(study_dir: Path, samples: list[str], settings: dict[str, str]) -> pa.Table:
    path = study_dir / "cohort.csv"
    if not path.exists():
        rows = [{"sample": s} for s in samples]
    else:
        renames = {"run_accession": "sample",
                   settings.get("reference_st_column", ""): "ref_st",
                   settings.get("reference_carbapenemases_column", ""):
                   "ref_carbapenemases"}  # fmt: skip
        with open(path, newline="") as handle:
            reader = csv.DictReader(handle)
            if "run_accession" not in (reader.fieldnames or []):
                raise InputFormatError(f"{path}: no run_accession column")
            rows = [{renames.get(k, k): (v or None) for k, v in row.items()} for row in reader]
        seen = set()
        for row in rows:
            if row["sample"] in seen:
                raise InputFormatError(f"{path}: duplicate run_accession {row['sample']}")
            seen.add(row["sample"])
        for row in rows:
            if row.get("year") is not None and not re.fullmatch(r"\d+", row["year"]):
                raise InputFormatError(
                    f"{path}: year {row['year']!r} for {row['sample']} is not an integer"
                )
    extra = sorted({k for r in rows for k in r} - {"sample", *STANDARD})
    columns = {"sample": [r["sample"] for r in rows]}
    for name in (*STANDARD, *extra):
        values = [r.get(name) for r in rows]
        columns[name] = (
            [int(v) if v is not None else None for v in values] if name == "year" else values
        )
    types = {name: (pa.int16() if name == "year" else pa.string()) for name in columns}
    return pa.table({n: pa.array(v, type=types[n]) for n, v in columns.items()})


def _families(genes: list[dict]) -> dict[str, str]:
    """Sample -> sorted '+'-joined carbapenemase families (AMR subtype, carbapenem subclass)."""
    found: dict[str, set[str]] = {}
    for g in genes:
        if g["element_subtype"] == "AMR" and g["drug_subclass"] == "CARBAPENEM":
            found.setdefault(g["sample"], set()).add(family_of(g["gene_symbol"]))
    return {s: "+".join(sorted(f)) for s, f in found.items()}


def _reference_families(text: str | None) -> str:
    if not text or text.strip() in ("-", ""):
        return "none"
    alleles = [a.strip().split("*")[0].split("^")[0] for a in text.split(";") if a.strip()]
    return "+".join(sorted({family_of("bla" + a) for a in alleles}))


def _agreement(cohort: pa.Table, summary: list[dict], genes: list[dict]) -> dict | None:
    ref = {r["sample"]: r for r in cohort.to_pylist()}
    if not any(r["ref_st"] or r["ref_carbapenemases"] for r in ref.values()):
        return None
    ours_fam = _families(genes)
    st = fam = 0
    not_in_reference = [r["sample"] for r in summary if r["sample"] not in ref]
    summary = [r for r in summary if r["sample"] in ref]
    matrix: dict[tuple[str, str], int] = {}
    disagreements = []
    for row in summary:
        sample, theirs = row["sample"], ref[row["sample"]]
        if row["st"] == theirs.get("ref_st"):
            st += 1
        else:
            disagreements.append({"sample": sample, "field": "st", "ours": row["st"],
                                  "reference": theirs.get("ref_st")})  # fmt: skip
        ours, reference = (
            ours_fam.get(sample, "none"),
            _reference_families(theirs.get("ref_carbapenemases")),
        )
        matrix[(ours, reference)] = matrix.get((ours, reference), 0) + 1
        if ours == reference:
            fam += 1
        else:
            disagreements.append({"sample": sample, "field": "carbapenemase_family",
                                  "ours": ours, "reference": reference})  # fmt: skip
    return {"st": {"agree": st, "total": len(summary)},
            "carbapenemase_family": {"agree": fam, "total": len(summary)},
            "family_matrix": [{"ours": o, "reference": r, "genomes": n}
                              for (o, r), n in sorted(matrix.items())],
            "disagreements": disagreements, "not_in_reference": not_in_reference}  # fmt: skip


def _duration_minutes(text: str) -> float:
    units = {"ms": 1 / 60000, "s": 1 / 60, "m": 1, "h": 60, "d": 1440}
    return sum(float(n) * units[u] for n, u in re.findall(r"([\d.]+)(ms|s|m|h|d)", text))


def _run_facts(run_dir: Path | None) -> dict:
    facts = {"cost_usd": None, "cost_per_genome_usd": None, "instance_hours": None,
             "wall_time_minutes": None}  # fmt: skip
    if run_dir is None:
        return facts
    cost = json.loads((run_dir / "cost.json").read_text())["summary"]
    facts |= {"cost_usd": round(cost["total_usd"], 2),
              "cost_per_genome_usd": round(cost["per_sample_usd"], 4),
              "instance_hours": round(cost["instance_hours"], 1)}  # fmt: skip
    with open(run_dir / "trace.tsv", newline="") as handle:
        trace = list(csv.DictReader(handle, delimiter="\t"))
    if trace:
        starts = [datetime.strptime(t["submit"], "%Y-%m-%d %H:%M:%S.%f") for t in trace]
        ends = [
            s + timedelta(minutes=_duration_minutes(t["duration"]))
            for s, t in zip(starts, trace, strict=True)
        ]
        facts["wall_time_minutes"] = round((max(ends) - min(starts)).total_seconds() / 60)
    return facts


def build_bundle(study_dir: Path, dataset_dir: Path, run_dir: Path | None, out_dir: Path) -> dict:
    study_dir, out_dir = Path(study_dir), Path(out_dir)
    tables = validate_dir(dataset_dir)
    samples = tables["samples"].select(["sample", "analysis_status"]).to_pylist()
    summary = tables["run_summary"].select(["sample", "st"]).to_pylist()
    genes = tables["amr_genes"].to_pylist()
    settings = read_study_yaml(study_dir / "study.yaml")
    cohort = _cohort(study_dir, [s["sample"] for s in samples], settings)
    run_ids = sorted(set(tables["samples"].column("run_id").to_pylist()))
    info = {"study": study_dir.name, **parse_story((study_dir / "story.md").read_text()),
            "reference": ({"name": settings["reference_name"]}
                          if settings.get("reference_name") else None),
            "run": {"run_id": ",".join(run_ids), "selected": len(samples), "analysed": len(summary),
                    "failed": [s["sample"] for s in samples if s["analysis_status"] == "failed"],
                    **_run_facts(Path(run_dir) if run_dir else None)},
            "agreement": _agreement(cohort, summary, genes),
            "versions": {"amrfinder": sorted({g["amrfinder_version"] for g in genes}),
                         "amrfinder_db": sorted({g["amrfinder_db_version"]
                                                 for g in genes})}}  # fmt: skip
    out_dir.mkdir(parents=True, exist_ok=True)
    pq.write_table(cohort, out_dir / "cohort.parquet", compression="zstd")
    (out_dir / "study.json").write_text(json.dumps(info, indent=2) + "\n")
    return info
