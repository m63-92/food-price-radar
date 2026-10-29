"""어댑터 파서 테스트. 픽스처는 2026-10-27 식봄 공개 페이지(robots.txt 허용 경로)의
__NEXT_DATA__ 를 토큰 제거 후 저장한 것이다. 실제 가격은 시점에 따라 바뀐다."""

from datetime import datetime, timedelta, timezone
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


KST = timezone(timedelta(hours=9))
MORNING = datetime(2026, 10, 29, 10, 0, tzinfo=KST)
EVENING = datetime(2026, 10, 29, 17, 30, tzinfo=KST)


def test_foodspring_search_parses_ssr_listings():
    items = parse_search_html(read("foodspring_search_garlic.html"), OBS_AT)
    assert len(items) == 8
    first = items[0]
    assert first.source == "foodspring"
    assert first.source_product_id == "868118"
    assert first.source_url == "https://www.foodspring.co.kr/goods/detail/868118"
    assert first.seller == "CJ프레시웨이"
    assert (first.regular_price_krw, first.sale_price_krw, first.coupon_price_krw) == (15050, 10750, 10428)
    # 검색 결과만으로는 쿠폰 종류를 알 수 없어 조건 미확인 → 최저가 계산 제외
    assert first.coupon_eligible is None
    assert best_price(first.regular_price_krw, first.sale_price_krw, first.coupon_price_krw, first.coupon_eligible).price == 10750
    assert first.weight_kg == 1
    assert first.shipping_status == "paid" and first.shipping_price_krw is None
    assert first.shipping_free_threshold_krw == 100000
    assert first.availability == "in_stock" and first.order_status == "orderable"
    assert first.extraction_status == "verified"


def test_foodspring_cabbage_weight_and_piece_columns():
    items = parse_search_html(read("foodspring_search_cabbage.html"), OBS_AT)
    by_id = {i.source_product_id: i for i in items}
    approx = by_id["424161"]  # 규격 '약 8kg' → 총중량 근사
    assert approx.weight_kg is None
    exact = by_id["1168733"]  # 규격 '8kg' + 상품명 '8kg내외' → 옵션 규격 기준 8kg (메모)
    assert exact.weight_kg == 8 and exact.review_notes
    ok = by_id["647652"]  # 규격 '8KG', 상품명 '(국내산, 상, 3입, 48망)'
    assert ok.weight_kg == 8
    assert (ok.piece_count, ok.piece_label) == (3, "입")
    assert unit_price(ok.sale_price_krw, ok.weight_kg) is not None


def test_foodspring_detail_delivery_coupon_and_fee():
    item = parse_detail_html(read("foodspring_detail_868118.html"), "868118", OBS_AT, now_kst=MORNING)
    assert item is not None
    assert item.shipping_status == "paid"
    assert (item.shipping_price_krw, item.shipping_free_threshold_krw) == (10000, 100000)
    # 표시 쿠폰가는 누구나 받는 상품 쿠폰(최소 구매 0원)으로만 구성 → 적용 가능
    assert item.coupon_eligible is True and "베스트셀러" in item.coupon_conditions
    assert best_price(item.regular_price_krw, item.sale_price_krw, item.coupon_price_krw, item.coupon_eligible).kind == "coupon"
    assert item.order_cutoff == "16:00" and item.delivery_lead_days == 1
    assert "월~토 도착" in item.delivery_note and "00:00~11:00 도착 90%" in item.delivery_note
    assert item.order_status == "orderable" and item.order_status_reason is None


def test_order_closed_after_cutoff_at_refresh_time():
    item = parse_detail_html(read("foodspring_detail_868118.html"), "868118", OBS_AT, now_kst=EVENING)
    assert item.order_status == "closed"
    assert item.order_status_reason.startswith("주문 마감(16:00")


def test_direct_delivery_vendor():
    item = parse_detail_html(read("foodspring_detail_371543.html"), "371543", OBS_AT, now_kst=EVENING)
    assert item.seller == "다봄푸드"
    assert item.order_cutoff == "21:00" and item.order_status == "orderable"
    assert (item.shipping_price_krw, item.shipping_free_threshold_krw) == (10000, 70000)
    assert "도착 예정" in item.delivery_note
    assert (item.piece_count, item.piece_label) == (1, "단")


def test_foodspring_structure_change_raises_parse_error():
    with pytest.raises(AdapterError) as e:
        parse_search_html("<html>no data</html>", OBS_AT)
    assert e.value.kind == "parse"


def _http(handler) -> PoliteHttpClient:
    return PoliteHttpClient(min_interval_s=0, transport=httpx.MockTransport(handler), sleep=lambda _s: None)


ROBOTS = "User-agent: *\nDisallow: /API/\nDisallow: /_next/\nAllow: /search/all\nAllow: /goods/detail/\n"


def test_foodspring_adapter_uses_allowed_paths_with_four_sorts_and_details():
    seen = []

    def handler(req: httpx.Request):
        seen.append((req.url.path, req.url.params.get("sort")))
        if req.url.path == "/robots.txt":
            return httpx.Response(200, text=ROBOTS)
        if req.url.path.startswith("/goods/detail/"):
            return httpx.Response(200, text=read("foodspring_detail_868118.html"))
        return httpx.Response(200, text=read("foodspring_search_garlic.html"))

    adapter = FoodspringAdapter(_http(handler))
    basic = adapter.search_basic("깐마늘")
    assert len(basic) == 8  # 같은 상품은 정렬이 달라도 한 번만
    assert [x[1] for x in seen if x[0] == "/search/all"] == ["ACCURACY_DESC", "PRICE_ASC", "PRICE_DESC", "DISCOUNT_RATE_DESC"]
    enriched = adapter.enrich(basic[0])
    assert enriched.order_cutoff == "16:00"
    adapter.enrich(basic[0])  # 같은 실행에서는 상세 재요청 없음
    assert sum(1 for p, _ in seen if p.startswith("/goods/detail/")) == 1
    assert all(p in ("/robots.txt", "/search/all") or p.startswith("/goods/detail/") for p, _ in seen)


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

    assert len(FoodspringAdapter(_http(handler)).search_basic("마늘")) == 8
    assert n["c"] == 6  # 첫 정렬: 503 두 번 후 성공(3회) + 나머지 정렬 3회


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
