"""Command-line entry point used by the pipeline's amrtools processes."""

import argparse
import sys
from pathlib import Path

import pandas as pd

from amrtools import __version__
from amrtools.columns import GENE_COLUMNS, SUMMARY_COLUMNS
from amrtools.ena import SAMPLESHEET_COLUMNS, fetch_samples, http_get, write_csv
from amrtools.errors import InputFormatError
from amrtools.merge import merge_tables
from amrtools.qc import QcThresholds
from amrtools.sample import build_sample_tables, write_tsv
from amrtools.schema import export_json
from amrtools.validate import validate_dir


def _add_identity(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--sample", required=True)
    parser.add_argument("--sample-type", required=True)
    parser.add_argument("--organism", required=True)
    parser.add_argument("--outdir", type=Path, default=Path("."))


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="amrtools", description=__doc__)
    parser.add_argument("--version", action="version", version=f"amrtools {__version__}")
    commands = parser.add_subparsers(dest="command", required=True)

    sample = commands.add_parser("sample", help="build one sample's gene and summary tables")
    _add_identity(sample)
    for name in ("--fastp-json", "--contigs", "--amrfinder", "--kleborate"):
        sample.add_argument(name, type=Path, required=True)
    sample.add_argument("--amrfinder-version", required=True)
    sample.add_argument("--amrfinder-db-version", required=True)
    defaults = QcThresholds()
    sample.add_argument("--min-assembly-length", type=int, default=defaults.min_assembly_length)
    sample.add_argument("--max-assembly-length", type=int, default=defaults.max_assembly_length)
    sample.add_argument("--max-contigs", type=int, default=defaults.max_contigs)
    sample.add_argument("--min-q30", type=float, default=defaults.min_q30)

    stub = commands.add_parser("stub", help="write placeholder tables for a -stub run")
    _add_identity(stub)

    merge = commands.add_parser("merge", help="merge per-sample tables into run tables")
    merge.add_argument("--genes", type=Path, nargs="+", required=True)
    merge.add_argument("--summaries", type=Path, nargs="+", required=True)
    merge.add_argument("--outdir", type=Path, default=Path("."))

    schema = commands.add_parser("schema", help="export the results schema as JSON")
    schema.add_argument("--export", type=Path, required=True, dest="schema_dir")

    fetch = commands.add_parser("fetch-samples", help="build a samplesheet from ENA accessions")
    fetch.add_argument("accessions", nargs="*")
    fetch.add_argument("--accession-file", type=Path)
    fetch.add_argument("--organism", required=True)
    fetch.add_argument("--out", type=Path, required=True)

    validate = commands.add_parser("validate", help="check Parquet results against the schema")
    validate.add_argument("directory", type=Path)
    return parser


def _run_sample(args: argparse.Namespace) -> None:
    genes, summary = build_sample_tables(
        sample=args.sample,
        sample_type=args.sample_type,
        organism=args.organism,
        fastp_json=args.fastp_json,
        contigs=args.contigs,
        amrfinder_tsv=args.amrfinder,
        kleborate_tsv=args.kleborate,
        amrfinder_version=args.amrfinder_version,
        amrfinder_db_version=args.amrfinder_db_version,
        thresholds=QcThresholds(
            min_assembly_length=args.min_assembly_length,
            max_assembly_length=args.max_assembly_length,
            max_contigs=args.max_contigs,
            min_q30=args.min_q30,
        ),
    )
    write_tsv(genes, args.outdir / f"{args.sample}.amr_genes.tsv")
    write_tsv(summary, args.outdir / f"{args.sample}.run_summary.tsv")


def _run_stub(args: argparse.Namespace) -> None:
    row = dict.fromkeys(SUMMARY_COLUMNS, "NA") | {
        "sample": args.sample,
        "sample_type": args.sample_type,
        "organism": args.organism,
    }
    write_tsv(pd.DataFrame(columns=GENE_COLUMNS), args.outdir / f"{args.sample}.amr_genes.tsv")
    write_tsv(
        pd.DataFrame([row], columns=SUMMARY_COLUMNS),
        args.outdir / f"{args.sample}.run_summary.tsv",
    )


def _run_merge(args: argparse.Namespace) -> None:
    write_tsv(merge_tables(args.genes, GENE_COLUMNS), args.outdir / "amr_genes.tsv")
    write_tsv(merge_tables(args.summaries, SUMMARY_COLUMNS), args.outdir / "run_summary.tsv")


def _run_schema(args: argparse.Namespace) -> None:
    for path in export_json(args.schema_dir):
        print(path)


def _run_fetch_samples(args: argparse.Namespace) -> None:
    accessions = list(args.accessions)
    if args.accession_file:
        lines = args.accession_file.read_text().splitlines()
        accessions += [line.strip() for line in lines if line.strip()]
    if not accessions:
        raise InputFormatError("fetch-samples: give accessions or --accession-file")
    rows, skipped = fetch_samples(accessions, args.organism, get=http_get)
    write_csv(rows, SAMPLESHEET_COLUMNS, args.out)
    write_csv(skipped, ["run_accession", "reason"], args.out.with_suffix(".skipped.csv"))
    print(f"{len(rows)} runs written to {args.out}; {len(skipped)} skipped", file=sys.stderr)


def _run_validate(args: argparse.Namespace) -> None:
    tables = validate_dir(args.directory)
    counts = ", ".join(f"{name} {table.num_rows}" for name, table in tables.items())
    print(f"{args.directory}: valid ({counts})", file=sys.stderr)


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if getattr(args, "outdir", None) is not None:
        args.outdir.mkdir(parents=True, exist_ok=True)
    commands = {
        "sample": _run_sample,
        "stub": _run_stub,
        "merge": _run_merge,
        "schema": _run_schema,
        "fetch-samples": _run_fetch_samples,
        "validate": _run_validate,
    }
    try:
        commands[args.command](args)
    except (InputFormatError, FileNotFoundError) as exc:
        print(f"amrtools: error: {exc}", file=sys.stderr)
        return 1
    return 0
