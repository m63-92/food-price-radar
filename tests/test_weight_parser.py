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


def test_approx_title_range_containing_option_uses_option_weight():
    # Q13 양파: 상품명은 '14~15kg내외' 근사 표기지만 옵션 규격 15KG 가 범위 안 → 15kg 로 단가 계산
    kg, _, notes = combine_weight("15KG", "양파 (개당250g내외, 14~15kg내외/망)")
    assert kg == 15 and notes


def test_approx_title_range_not_containing_option_is_rejected():
    kg, _, notes = combine_weight("5KG", "양파 14~15kg 내외/망")
    assert kg is None and notes


def test_small_approx_is_piece_size_not_total():
    kg, _, _ = combine_weight("1.8KG", "계란 특란 30구 (60g이상)")
    assert kg == 1.8


def test_approx_option_weight_is_rejected():
    kg, _, _ = combine_weight("약 8kg", "배추(3입,겉잎포함,특,8kg내외망,국산)")
    assert kg is None


def test_ml_is_not_converted():
    assert parse_weight("1.8L").kg is None
