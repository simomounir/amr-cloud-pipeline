"""Clean messy public sample metadata (dates, countries, isolation sources, hosts)."""

import re
from datetime import date

import pycountry

MISSING_TOKENS = frozenset(
    {"", "not provided", "not collected", "missing", "unknown", "not applicable",
     "na", "n/a", "none", "restricted access"}
)  # fmt: skip

_DATE = re.compile(r"^(\d{4})(?:-(\d{2})(?:-(\d{2})(?:[T ].*)?)?)?$")

# Names pycountry does not resolve, mapped to ISO alpha-2 codes.
_COUNTRY_ALIASES = {
    "usa": "US", "u.s.a.": "US", "uk": "GB", "england": "GB", "scotland": "GB",
    "wales": "GB", "russia": "RU", "turkey": "TR", "democratic republic of the congo": "CD",
    "drc": "CD", "republic of the congo": "CG", "ivory coast": "CI", "laos": "LA",
    "syria": "SY", "bolivia": "BO", "venezuela": "VE", "taiwan": "TW", "hong kong": "HK",
    "macedonia": "MK", "swaziland": "SZ", "burma": "MM", "the netherlands": "NL",
    "south korea": "KR", "north korea": "KP", "iran": "IR", "czech republic": "CZ",
    "vietnam": "VN", "viet nam": "VN", "tanzania": "TZ", "moldova": "MD",
}  # fmt: skip

# First matching rule wins. Words match whole words; "bronch" is a prefix.
_SOURCE_RULES = [
    ("blood", ["blood", "bacteremia", "bacteraemia", "sepsis", "septicemia"]),
    ("urine", ["urine", "urinary", "uti"]),
    ("respiratory", ["sputum", r"bronch\w*", "bal", "tracheal", "respiratory", "pneumonia",
                     "lung", "throat", "nasal"]),
    ("screening", ["rectal", "stool", "feces", "faeces", "fecal", "faecal", "perianal",
                   "perirectal", "gut", "colonization", "colonisation", "screening"]),
    ("wound", ["wound", "pus", "abscess", "skin", "tissue", "ulcer"]),
    ("environmental", ["water", "wastewater", "sewage", "soil", "environment", "sink",
                       "drain", "surface"]),
    ("other_clinical", ["clinical", "hospital", "patient", "catheter", "cerebrospinal", "csf",
                        "swab", "aspirate", "fluid", "human"]),
]  # fmt: skip
_SOURCE_PATTERNS = [
    (category, re.compile(r"\b(?:" + "|".join(words) + r")\b")) for category, words in _SOURCE_RULES
]


def clean_text(raw: str | None) -> str | None:
    if raw is None:
        return None
    text = raw.strip()
    return text or None


def is_missing(raw: str | None) -> bool:
    return raw is None or raw.strip().lower() in MISSING_TOKENS


def clean_date(raw: str | None) -> tuple[int | None, int | None, str]:
    missing = (None, None, "missing")
    if is_missing(raw):
        return missing
    match = _DATE.match(raw.strip())
    if not match:
        return missing
    year = int(match[1])
    month = int(match[2]) if match[2] else None
    day = int(match[3]) if match[3] else None
    if not 1900 <= year <= 2100 or (month is not None and not 1 <= month <= 12):
        return missing
    if day is not None:
        try:
            date(year, month, day)
        except ValueError:
            return missing
        return year, month, "day"
    if month is not None:
        return year, month, "month"
    return year, None, "year"


def clean_country(raw: str | None) -> tuple[str | None, str | None]:
    if is_missing(raw):
        return None, None
    name, _, region_text = raw.partition(":")
    name = name.strip()
    region = None if is_missing(region_text) else region_text.strip()
    try:
        alias = _COUNTRY_ALIASES.get(name.lower())
        found = (
            pycountry.countries.get(alpha_2=alias) if alias else pycountry.countries.lookup(name)
        )
    except LookupError:
        return None, region
    return getattr(found, "common_name", None) or found.name, region


def categorize_source(raw: str | None) -> str:
    if is_missing(raw):
        return "unknown"
    text = raw.lower()
    for category, pattern in _SOURCE_PATTERNS:
        if pattern.search(text):
            return category
    return "unknown"


def clean_host(raw: str | None) -> str | None:
    return None if is_missing(raw) else raw.strip()
