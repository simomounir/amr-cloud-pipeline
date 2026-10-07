import pytest

from amrtools.metadata import (
    categorize_source,
    clean_country,
    clean_date,
    clean_host,
    clean_text,
    is_missing,
)


@pytest.mark.parametrize(
    "raw",
    ["", "  ", None, "not provided", "Not Collected", "missing", "unknown", "NA", "n/a",
     "not applicable", "none", "restricted access"],
)  # fmt: skip
def test_missing_tokens(raw):
    assert is_missing(raw)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("2014-09-28", (2014, 9, "day")),
        ("2019-03", (2019, 3, "month")),
        ("2018", (2018, None, "year")),
        (" 2018 ", (2018, None, "year")),
        ("2020-05-04T10:00:00Z", (2020, 5, "day")),
        ("not provided", (None, None, "missing")),
        ("", (None, None, "missing")),
        ("2017/2018", (None, None, "missing")),
        ("2019-02-30", (None, None, "missing")),
        ("2019-13", (None, None, "missing")),
        ("1850", (None, None, "missing")),
        ("March 2019", (None, None, "missing")),
    ],
)
def test_clean_date(raw, expected):
    assert clean_date(raw) == expected


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("USA: Houston", ("United States", "Houston")),
        ("USA:houston ", ("United States", "houston")),
        ("Germany:Bavaria", ("Germany", "Bavaria")),
        ("India", ("India", None)),
        (" germany ", ("Germany", None)),
        ("UK", ("United Kingdom", None)),
        ("Viet Nam", ("Vietnam", None)),
        ("South Korea", ("South Korea", None)),
        ("Czech Republic", ("Czechia", None)),
        ("Netherlands", ("Netherlands", None)),
        ("DEU", ("Germany", None)),
        ("Lisbon", (None, None)),
        ("Atlantis: North", (None, "North")),
        ("USA: missing", ("United States", None)),
        ("not provided", (None, None)),
        (None, (None, None)),
    ],
)
def test_clean_country(raw, expected):
    assert clean_country(raw) == expected


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("blood", "blood"),
        ("BLOOD culture", "blood"),
        ("urine", "urine"),
        ("Urinary tract", "urine"),
        ("sputum", "respiratory"),
        ("pneumonia", "respiratory"),
        ("bronchoalveolar lavage", "respiratory"),
        ("BAL fluid", "respiratory"),
        ("rectal swab", "screening"),
        ("stool", "screening"),
        ("Pus", "wound"),
        ("skin swab", "wound"),
        ("hospital sink drain", "environmental"),
        ("wastewater", "environmental"),
        ("clinical material", "other_clinical"),
        ("clinical", "other_clinical"),
        ("human", "other_clinical"),
        ("bloodstream infection", "blood"),
        ("hemoculture", "blood"),
        ("Haemoculture", "blood"),
        ("endotracheal aspirate", "respiratory"),
        ("nasopharyngeal swab", "respiratory"),
        ("abdominal drain fluid", "other_clinical"),
        ("lisbon", "unknown"),
        ("Klebsiella pneumoniae microbiological culture", "unknown"),
        ("not provided", "unknown"),
        ("", "unknown"),
        (None, "unknown"),
    ],
)
def test_categorize_source(raw, expected):
    assert categorize_source(raw) == expected


def test_clean_host_and_text():
    assert clean_host(" Homo sapiens ") == "Homo sapiens"
    assert clean_host("not provided") is None
    assert clean_text(" not provided ") == "not provided"
    assert clean_text("  ") is None
    assert clean_text(None) is None


@pytest.mark.parametrize(
    ("raw", "host", "expected"),
    [
        ("pig feces", "Sus scrofa", "animal"),
        ("faeces", "Bos taurus", "animal"),
        ("not provided", "Canis lupus familiaris", "animal"),
        ("farm wastewater", "Sus scrofa", "environmental"),
        ("rectal swab", "Homo sapiens", "screening"),
        ("rectal swab", "homo sapiens ", "screening"),
        ("rectal swab", "not provided", "screening"),
        ("rectal swab", None, "screening"),
        ("blood", "human", "blood"),
        ("blood", "Human", "blood"),
        ("blood", "humans", "blood"),
        ("urine", "Homo sapiens sapiens", "urine"),
        ("blood", "Homo sapiens; female", "blood"),
    ],
)
def test_non_human_host_is_animal(raw, host, expected):
    assert categorize_source(raw, host) == expected
