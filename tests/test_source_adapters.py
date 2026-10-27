"""어댑터 파서 테스트. 픽스처는 2026-10-27 식봄 공개 페이지(robots.txt 허용 경로)의
__NEXT_DATA__ 를 토큰 제거 후 저장한 것이다. 실제 가격은 시점에 따라 바뀐다."""

from pathlib import Path

import httpx
import pytest

from crawler.adapters.base import AdapterError, PoliteHttpClient
from crawler.adapters.coupang import CoupangAdapter, parse_partners_products, partners_authorization
from crawler.adapters.foodspring import FoodspringAdapter, parse_detail_html, parse_search_html
from crawler.adapters.naver import NaverAdapter
from crawler.normalize import best_price, unit_price

FIX = Path(__file__).parent / "fixtures"
OBS_AT = "2026-10-27T05:00:00+00:00"


def read(name: str) -> str:
    return (FIX / name).read_text(encoding="utf-8")


def test_foodspring_search_parses_ssr_listings():
    items = parse_search_html(read("foodspring_search_garlic.html"), OBS_AT)
    assert len(items) == 8
    first = items[0]
    assert first.source == "foodspring"
    assert first.source_product_id == "868118"
    assert first.source_url == "https://www.foodspring.co.kr/goods/detail/868118"
    assert first.seller == "CJ프레시웨이"
    assert first.regular_price_krw == 15050
    assert first.sale_price_krw == 10750
    assert first.coupon_price_krw == 10428
    # 쿠폰 조건 미확인 → eligible None → 최저가 계산 제외
    assert first.coupon_eligible is None
    assert best_price(first.regular_price_krw, first.sale_price_krw, first.coupon_price_krw, first.coupon_eligible).price == 10750
    assert first.weight_kg == 1
    assert first.shipping_status == "paid" and first.shipping_price_krw is None
    assert first.availability == "in_stock"
    assert first.extraction_status == "verified"


def test_foodspring_ambiguous_weight_is_flagged_for_review():
    items = parse_search_html(read("foodspring_search_cabbage.html"), OBS_AT)
    by_id = {i.source_product_id: i for i in items}
    approx = by_id["424161"]  # 규격 '약 8kg'
    assert approx.weight_kg is None
    assert approx.extraction_status == "needs_review"
    assert unit_price(approx.sale_price_krw, approx.weight_kg) is None
    exact = by_id["1168733"]  # 규격 '8kg' / 상품명 '8kg내외' → 근사 표기라 검토
    assert exact.weight_kg is None
    ok = by_id["647652"]  # 규격 '8KG', 상품명에는 중량 없음
    assert ok.weight_kg == 8


def test_foodspring_detail_has_delivery_fee_amount():
    item = parse_detail_html(read("foodspring_detail_868118.html"), "868118", OBS_AT)
    assert item is not None
    assert item.shipping_status == "paid"
    assert item.shipping_price_krw == 10000
    assert any("무료배송" in n for n in item.review_notes)


def test_foodspring_structure_change_raises_parse_error():
    with pytest.raises(AdapterError) as e:
        parse_search_html("<html>no data</html>", OBS_AT)
    assert e.value.kind == "parse"


def _http(handler) -> PoliteHttpClient:
    return PoliteHttpClient(min_interval_s=0, transport=httpx.MockTransport(handler), sleep=lambda _s: None)


ROBOTS = "User-agent: *\nDisallow: /API/\nDisallow: /_next/\nAllow: /search/all\nAllow: /goods/detail/\n"


def test_foodspring_adapter_uses_allowed_path_only():
    seen = []

    def handler(req: httpx.Request):
        seen.append(req.url.path)
        if req.url.path == "/robots.txt":
            return httpx.Response(200, text=ROBOTS)
        return httpx.Response(200, text=read("foodspring_search_garlic.html"))

    items = FoodspringAdapter(_http(handler)).search("깐마늘")
    assert len(items) == 8
    assert seen == ["/robots.txt", "/search/all"]


def test_blocked_response_is_not_bypassed():
    def handler(req: httpx.Request):
        if req.url.path == "/robots.txt":
            return httpx.Response(200, text=ROBOTS)
        return httpx.Response(403, text="denied")

    with pytest.raises(AdapterError) as e:
        FoodspringAdapter(_http(handler)).search("깐마늘")
    assert e.value.kind == "blocked"


def test_robots_disallow_prevents_request():
    calls = []

    def handler(req: httpx.Request):
        calls.append(req.url.path)
        return httpx.Response(200, text="User-agent: *\nDisallow: /\n")

    with pytest.raises(AdapterError) as e:
        FoodspringAdapter(_http(handler)).search("깐마늘")
    assert e.value.kind == "robots"
    assert calls == ["/robots.txt"]


def test_retry_with_backoff_on_503():
    n = {"c": 0}

    def handler(req: httpx.Request):
        if req.url.path == "/robots.txt":
            return httpx.Response(200, text=ROBOTS)
        n["c"] += 1
        return httpx.Response(503) if n["c"] < 3 else httpx.Response(200, text=read("foodspring_search_garlic.html"))

    assert len(FoodspringAdapter(_http(handler)).search("마늘")) == 8
    assert n["c"] == 3


def test_naver_is_restricted_and_never_fakes_success():
    a = NaverAdapter()
    assert a.check().state == "restricted"
    with pytest.raises(AdapterError) as e:
        a.search("마늘")
    assert e.value.kind == "restricted"


def test_coupang_without_keys_is_restricted():
    a = CoupangAdapter(access_key="", secret_key="")
    assert a.check().state == "restricted"
    with pytest.raises(AdapterError) as e:
        a.search("마늘")
    assert e.value.kind == "not_configured"


def test_coupang_partners_signature_format():
    auth = partners_authorization("GET", "/p", "keyword=a", "AK", "SK", now=0)
    assert auth.startswith("CEA algorithm=HmacSHA256, access-key=AK, signed-date=700101T000000Z, signature=")


def test_coupang_partners_parse():
    payload = {"rCode": "0", "data": {"productData": [
        {"productId": 1, "productName": "국산 깐마늘 1kg", "productPrice": 9900, "productUrl": "https://link.coupang.com/x",
         "isRocket": True, "isFreeShipping": True},
        {"productId": 2, "productName": "마늘 1망", "productPrice": 5000, "productUrl": "https://link.coupang.com/y",
         "isRocket": False, "isFreeShipping": False},
    ]}}
    items = parse_partners_products(payload, OBS_AT)
    assert items[0].weight_kg == 1 and items[0].shipping_status == "free" and items[0].regular_price_krw == 9900
    assert items[1].weight_kg is None and items[1].extraction_status == "needs_review"
    assert items[1].shipping_status == "unknown"
