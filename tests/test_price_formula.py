import inspect
import json
from pathlib import Path

import pytest

from crawler.normalize import best_price, unit_price

CASES = json.loads((Path(__file__).parent / "vectors" / "pricing_cases.json").read_text(encoding="utf-8"))["cases"]


@pytest.mark.parametrize("c", CASES, ids=[c["name"] for c in CASES])
def test_shared_pricing_vectors(c):
    bp = best_price(c["regular"], c["sale"], c["coupon"], c["couponEligible"])
    assert bp.price == c["best"]
    assert bp.kind == c["kind"]
    assert sorted(bp.warnings) == sorted(c["warnings"])
    assert unit_price(bp.price, c["weightKg"]) == c["unit"]


def test_shipping_is_not_an_input_of_price_formula():
    # 배송비를 단가 분자에 더할 수 있는 경로 자체가 없어야 한다 (명세 5.2 변경 금지 규칙)
    assert "shipping" not in " ".join(inspect.signature(best_price).parameters)
    assert "shipping" not in " ".join(inspect.signature(unit_price).parameters)


def test_spec_example_table():
    # 명세 5.4 검증 예시 (계산 테스트용 가상 데이터)
    a = best_price(10000, 8000, 7000, True)
    assert unit_price(a.price, 1) == 7000
    b = best_price(5000, 4500, None, None)
    assert unit_price(b.price, 0.5) == 9000
    c = best_price(3900, None, None, None)
    assert unit_price(c.price, None) is None
