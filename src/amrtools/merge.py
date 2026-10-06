"""Concatenate per-sample tables into run-level tables."""

from pathlib import Path

import pandas as pd

from amrtools.errors import InputFormatError


def merge_tables(paths: list[Path], columns: list[str]) -> pd.DataFrame:
    frames = []
    for path in paths:
        frame = pd.read_csv(path, sep="\t", dtype=str, keep_default_na=False)
        if list(frame.columns) != columns:
            raise InputFormatError(f"{path}: columns do not match the expected table layout")
        frames.append(frame)
    if not frames:
        return pd.DataFrame(columns=columns)
    merged = pd.concat(frames, ignore_index=True)
    return merged.sort_values("sample", kind="stable", ignore_index=True)
