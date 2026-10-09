"""Write src/data/country-codes.json: country name as amrtools writes it -> ISO 3166 numeric
(world-atlas feature ids). Run: .venv/bin/python dashboard/scripts/country_codes.py"""

import json
from pathlib import Path

import pycountry

OUT = Path(__file__).resolve().parents[1] / "src" / "data" / "country-codes.json"
codes = {getattr(c, "common_name", None) or c.name: c.numeric for c in pycountry.countries}
OUT.write_text(json.dumps(dict(sorted(codes.items())), ensure_ascii=False, indent=0) + "\n")
print(f"{len(codes)} countries -> {OUT}")
