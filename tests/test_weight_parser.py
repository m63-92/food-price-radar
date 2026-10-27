import json
from pathlib import Path

import pytest

from crawler.normalize import combine_weight, parse_weight

CASES = json.loads((Path(__file__).parent / "vectors" / "weight_cases.json").read_text(encoding="utf-8"))["cases"]


@pytest.mark.parametrize("case", CASES, ids=[c["text"] or "<empty>" for c in CASES])
def test_shared_weight_vectors(case):
    r = parse_weight(case["text"])
    assert r.status == case["status"]
    assert r.kg == case["kg"]


def test_option_and_title_conflict_goes_to_review():
    kg, _, notes = combine_weight("1KG", "깐마늘 2kg")
    assert kg is None and notes


def test_option_missing_uses_title_weight():
    kg, _, notes = combine_weight("EA", "깐마늘 1kg (대,국내산)")
    assert kg == 1 and notes == []


def test_ambiguous_title_blocks_option_weight():
    kg, _, notes = combine_weight("15KG", "양파 (개당250g내외, 14~15kg내외/망)")
    assert kg is None and notes


def test_ml_is_not_converted():
    assert parse_weight("1.8L").kg is None
