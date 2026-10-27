"""식봄(foodspring.co.kr) 어댑터.

robots.txt(2026-10-25 갱신본)는 모든 User-agent 에 대해 /search/all, /goods/detail/ 을 Allow,
/API/·/_next/ 를 Disallow 한다. 따라서 공개 HTML 페이지에 서버 렌더링된 __NEXT_DATA__
(Relay 레코드)만 읽고, 내부 API·GraphQL 엔드포인트는 호출하지 않는다.

한계(docs/source-feasibility.md 참조)
- 검색 페이지는 키워드당 첫 8개 상품만 서버 렌더링된다(추가 페이지는 비허용 API 경로).
- 쿠폰 적용가(appliedCoupon)는 비로그인 기준 표시값이며 발급·적용 조건을 확인할 수 없어
  coupon_eligible=None 으로 기록한다 → 최저가 계산에서 제외되고 참고값으로만 표시된다.
- 배송비는 조건부(일정 금액 이상 무료)이며 검색 페이지에는 금액이 없을 수 있다.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from urllib.parse import quote

from ..models import ListingObservation, ProviderCheck
from ..normalize import best_price, combine_weight, parse_krw
from .base import AdapterError, PoliteHttpClient, SourceAdapter

BASE = "https://www.foodspring.co.kr"
_NEXT_DATA_RE = re.compile(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', re.S)
COUPON_NOTE = "식봄 표시 쿠폰 적용가(비로그인 기준) — 발급·적용 조건 미확인으로 최저가 계산 제외"


def parse_next_data(html: str) -> dict:
    m = _NEXT_DATA_RE.search(html)
    if not m:
        raise AdapterError("parse", "__NEXT_DATA__ 를 찾을 수 없음(페이지 구조 변경 가능)")
    try:
        return json.loads(m.group(1))
    except json.JSONDecodeError as e:
        raise AdapterError("parse", f"__NEXT_DATA__ JSON 파싱 실패: {e}") from e


def _records(data: dict) -> dict:
    recs = data.get("props", {}).get("pageProps", {}).get("initialRecords")
    if not isinstance(recs, dict):
        raise AdapterError("parse", "initialRecords 없음(페이지 구조 변경 가능)")
    return recs


def _ref(recs: dict, obj: object) -> dict | None:
    if isinstance(obj, dict) and "__ref" in obj:
        return recs.get(obj["__ref"])
    return None


def _search_goods_ids(recs: dict) -> list[str]:
    for key, rec in recs.items():
        if rec.get("__typename") == "GoodsConnection" and key.startswith("client:root:goodsSearch"):
            ids: list[str] = []
            for edge_id in rec.get("edges", {}).get("__refs", []):
                node = _ref(recs, recs.get(edge_id, {}).get("node"))
                if node and node.get("__typename") == "Goods":
                    ids.append(node["__id"])
            return ids
    return []


def listing_from_goods(recs: dict, goods: dict, observed_at: str) -> ListingObservation:
    nid = str(goods.get("nid"))
    title = (goods.get("name") or "").strip()
    price = _ref(recs, goods.get("price")) or {}
    regular = parse_krw(price.get("originalPrice"))
    sale = parse_krw(price.get("salePrice"))
    coupon_rec = _ref(recs, price.get("appliedCoupon"))
    coupon = parse_krw(coupon_rec.get("price")) if coupon_rec else None
    vendor = _ref(recs, goods.get("vendor")) or {}

    shipping_status = "unknown"
    shipping_price = None
    shipping_note = None
    if goods.get("isFreeDelivery") is True:
        shipping_status = "free"
    else:
        fee = _ref(recs, goods.get("deliveryFee"))
        if fee and fee.get("__typename") == "ConditionalDeliveryFee":
            shipping_status = "paid"
            shipping_price = parse_krw(fee.get("price"))
            if fee.get("condition") is not None:
                shipping_note = f"₩{int(fee['condition']):,} 이상 구매 시 무료배송(판매자 묶음 기준)"

    stock = _ref(recs, goods.get("stock")) or {}
    non_purchasable = goods.get("nonPurchasableReason", {}).get("__refs", [])
    if non_purchasable or stock.get("quantity") == 0:
        availability = "out_of_stock"
    elif isinstance(stock.get("quantity"), int) and stock["quantity"] > 0:
        availability = "in_stock"
    else:
        availability = "unknown"

    standard = goods.get("standard")
    unit = goods.get("unit")
    weight_kg, weight_text, notes = combine_weight(standard, title)
    bp = best_price(regular, sale, coupon, None)
    if "sale_gt_regular" in bp.warnings:
        notes.append("할인가가 정상가보다 높게 표기됨")
    if bp.price is None:
        notes.append("가격 정보 없음")
    if shipping_note:
        notes.append(shipping_note)
    needs_review = weight_kg is None or bp.price is None or "sale_gt_regular" in bp.warnings

    return ListingObservation(
        source="foodspring",
        source_product_id=nid,
        source_option_id=None,
        source_url=f"{BASE}/goods/detail/{nid}",
        title=title or f"식봄 상품 {nid}",
        seller=vendor.get("name"),
        product_option=" / ".join(x for x in (standard, unit) if x) or None,
        raw_weight_text=weight_text,
        weight_kg=weight_kg,
        regular_price_krw=regular,
        sale_price_krw=sale,
        coupon_price_krw=coupon,
        coupon_eligible=None,
        coupon_conditions=COUPON_NOTE if coupon is not None else None,
        shipping_status=shipping_status,  # type: ignore[arg-type]
        shipping_price_krw=shipping_price,
        availability=availability,  # type: ignore[arg-type]
        observed_at=observed_at,
        extraction_status="needs_review" if needs_review else "verified",
        review_notes=notes,
        parse_confidence=0.6 if needs_review else 0.9,
    )


def parse_search_html(html: str, observed_at: str) -> list[ListingObservation]:
    recs = _records(parse_next_data(html))
    ids = _search_goods_ids(recs)
    return [listing_from_goods(recs, recs[i], observed_at) for i in ids if i in recs]


def parse_detail_html(html: str, goods_nid: str, observed_at: str) -> ListingObservation | None:
    recs = _records(parse_next_data(html))
    goods = recs.get(f"goods_{goods_nid}")
    if not goods or goods.get("__typename") != "Goods":
        return None
    return listing_from_goods(recs, goods, observed_at)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class FoodspringAdapter(SourceAdapter):
    source = "foodspring"

    def __init__(self, http: PoliteHttpClient):
        self.http = http

    def check(self) -> ProviderCheck:
        try:
            ok = self.http.allowed(f"{BASE}/search/all?key=test")
        except AdapterError as e:
            return ProviderCheck("foodspring", "temporary_error", str(e))
        if not ok:
            return ProviderCheck("foodspring", "restricted", "robots.txt 가 검색 페이지 수집을 허용하지 않음")
        return ProviderCheck("foodspring", "available",
                             "공개 검색/상세 페이지(SSR) 수집 · 키워드당 상위 8개 · 쿠폰가는 조건 미확인 참고값")

    def search(self, keyword: str) -> list[ListingObservation]:
        html = self.http.get_text(f"{BASE}/search/all?key={quote(keyword)}")
        return parse_search_html(html, _now())

    def fetch_url(self, url: str) -> ListingObservation | None:
        m = re.search(r"foodspring\.co\.kr/goods/detail/(\d+)", url)
        if not m:
            return None
        html = self.http.get_text(f"{BASE}/goods/detail/{m.group(1)}")
        return parse_detail_html(html, m.group(1), _now())
