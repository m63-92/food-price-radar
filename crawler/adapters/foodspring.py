"""식봄(foodspring.co.kr) 어댑터.

robots.txt(2026-10-25 갱신본)는 모든 User-agent 에 대해 /search/all, /goods/detail/ 을 Allow,
/API/·/_next/ 를 Disallow 한다. 따라서 공개 HTML 페이지에 서버 렌더링된 __NEXT_DATA__
(Relay 레코드)만 읽고, 내부 API·GraphQL 엔드포인트는 호출하지 않는다.

수집 방식 (docs/source-feasibility.md 참조)
- 검색 페이지는 정렬별로 첫 8개만 서버 렌더링된다. 페이지 넘김은 비허용 API 경로라 쓰지 않고,
  정렬 4종(정확도·낮은 가격·높은 가격·할인율)을 합쳐 검색어당 최대 32개까지 모은다.
- 각 상품의 상세 페이지(/goods/detail/<id>)에서 배송비 금액, 판매자 주문 마감·도착 정보, 적용 쿠폰 종류를 읽는다.
- 쿠폰: 표시 쿠폰가가 '상품 쿠폰'(누구나 다운로드, 최소 구매금액 0원)으로만 구성되면 적용 가능으로 본다.
  첫 구매·주문 금액 조건 쿠폰이 섞이거나 상세 정보를 못 읽으면 조건 미확인(None).
- 주문 마감은 '수집(탭 갱신) 시각' 기준: 판매자 마감 시각이 지났으면 '주문 마감'.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

from ..models import ListingObservation, ProviderCheck
from ..normalize import best_price, combine_pieces, combine_weight, parse_krw
from .base import AdapterError, PoliteHttpClient, SourceAdapter

BASE = "https://www.foodspring.co.kr"
SORTS = ("ACCURACY_DESC", "PRICE_ASC", "PRICE_DESC", "DISCOUNT_RATE_DESC")
KST = timezone(timedelta(hours=9))
WEEKDAY_KO = {"MON": "월", "TUE": "화", "WED": "수", "THU": "목", "FRI": "금", "SAT": "토", "SUN": "일"}
_NEXT_DATA_RE = re.compile(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', re.S)


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


def _refs(recs: dict, obj: object) -> list[dict]:
    if isinstance(obj, dict) and "__refs" in obj:
        return [recs[r] for r in obj["__refs"] if r in recs]
    return []


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


def _hhmm(h: object, m: object) -> str | None:
    if not isinstance(h, int):
        return None
    return f"{h:02d}:{(m if isinstance(m, int) else 0):02d}"


def _delivery_info(recs: dict, vendor: dict, now_kst: datetime) -> dict:
    """판매자 배송 정보 → 주문 마감 시각, D+일수, 예상 배송 문구, 마감 여부."""
    delivery = _ref(recs, vendor.get("delivery")) or {}
    due = _ref(recs, delivery.get("orderDue"))
    out: dict = {"cutoff": None, "lead": None, "note": None, "closed": False}
    if not due:
        return out
    cutoff = _hhmm(due.get("hour"), due.get("minute"))
    lead = due.get("day") if isinstance(due.get("day"), int) else None
    parts: list[str] = []
    if lead is not None:
        parts.append("당일" if lead == 0 else f"D+{lead}")
    arrival = _ref(recs, delivery.get("possibleArrivalTime")) or {}
    order = list(WEEKDAY_KO)
    idx = sorted(order.index(d) for d in arrival.get("weekDay") or [] if d in order)
    if len(idx) == 7:
        parts.append("매일 도착")
    elif len(idx) >= 3 and idx == list(range(idx[0], idx[-1] + 1)):
        parts.append(f"{WEEKDAY_KO[order[idx[0]]]}~{WEEKDAY_KO[order[idx[-1]]]} 도착")
    elif idx:
        parts.append("·".join(WEEKDAY_KO[order[i]] for i in idx) + " 도착")
    prob = _ref(recs, arrival.get("probability")) or {}
    st, et = _ref(recs, prob.get("startTime")), _ref(recs, prob.get("endTime"))
    if st and et and prob.get("percentage"):
        parts.append(f"{_hhmm(st.get('hour'), st.get('minute'))}~{_hhmm(et.get('hour'), et.get('minute'))} 도착 {prob['percentage']}%")
    if delivery.get("estimatedArrivalTime"):
        parts.append(f"도착 예정 {str(delivery['estimatedArrivalTime'])[5:].replace('-', '/')}")
    out.update(cutoff=cutoff, lead=lead, note=" · ".join(parts) or None)
    if cutoff:
        h, m = map(int, cutoff.split(":"))
        out["closed"] = (now_kst.hour, now_kst.minute) >= (h, m)
    return out


def _coupon_eligibility(recs: dict, applied: dict | None) -> tuple[bool | None, str | None]:
    """표시 쿠폰가를 이루는 쿠폰이 모두 '누구나 받는 상품 쿠폰(최소 구매 0원)'이면 적용 가능."""
    if not applied:
        return None, None
    coupons = _refs(recs, applied.get("couponList"))
    if not coupons:
        return None, "식봄 표시 쿠폰가 — 쿠폰 조건 미확인"
    names = [c.get("displayName") or "쿠폰" for c in coupons]
    for c in coupons:
        if c.get("__typename") != "GoodsCoupon" or c.get("issueStatus") not in (None, "ISSUE_OPEN"):
            return None, f"{', '.join(names)} — 주문/조건부 쿠폰 포함, 적용 조건 확인 필요"
        cond = _ref(recs, c.get("condition")) or {}
        min_amount = cond.get("minimumPurchaseAmount")
        if min_amount not in (None, 0) or str(cond.get("conditionValue", "0")) not in ("0", ""):
            return None, f"{', '.join(names)} — 최소 구매금액 조건 있음"
    return True, f"{', '.join(names)} (상품 쿠폰 · 다운로드 후 적용)"


def listing_from_goods(recs: dict, goods: dict, observed_at: str, now_kst: datetime | None = None, detailed: bool = False) -> ListingObservation:
    now_kst = now_kst or datetime.now(KST)
    nid = str(goods.get("nid"))
    title = (goods.get("name") or "").strip()
    price = _ref(recs, goods.get("price")) or {}
    regular = parse_krw(price.get("originalPrice"))
    sale = parse_krw(price.get("salePrice"))
    applied = _ref(recs, price.get("appliedCoupon"))
    coupon = parse_krw(applied.get("price")) if applied else None
    coupon_eligible, coupon_conditions = _coupon_eligibility(recs, applied) if detailed else (None, "식봄 표시 쿠폰가 — 상세 정보 미수집, 조건 미확인" if coupon is not None else None)
    vendor = _ref(recs, goods.get("vendor")) or {}

    shipping_status, shipping_price, free_threshold = "unknown", None, None
    fee_note: str | None = None
    if goods.get("isFreeDelivery") is True:
        shipping_status = "free"
    else:
        fee = _ref(recs, goods.get("deliveryFee"))
        fee_type = (fee or {}).get("__typename", "")
        if "Free" in fee_type:
            shipping_status = "free"
        elif fee:
            # ConditionalDeliveryFee(금액 이상 무료) · QuantityDeliveryFee(수량별 부과) 등. 금액은 상세 페이지에만 있음
            shipping_status = "paid"
            shipping_price = parse_krw(fee.get("price"))
            free_threshold = parse_krw(fee.get("condition"))
            if fee_type == "QuantityDeliveryFee" and fee.get("unitQuantity"):
                fee_note = f"배송비 {fee['unitQuantity']}개마다 부과"

    stock = _ref(recs, goods.get("stock")) or {}
    non_purchasable = _refs(recs, goods.get("nonPurchasableReason")) or goods.get("nonPurchasableReason", {}).get("__refs", [])
    delivery = _delivery_info(recs, vendor, now_kst) if detailed else {"cutoff": None, "lead": None, "note": None, "closed": False}
    if non_purchasable or goods.get("isUse") is False:
        availability, order_status, reason = "out_of_stock", "discontinued", "판매 중단"
    elif stock.get("quantity") == 0:
        availability, order_status, reason = "out_of_stock", "sold_out", "품절"
    else:
        availability = "in_stock" if isinstance(stock.get("quantity"), int) and stock["quantity"] > 0 else "unknown"
        if delivery["closed"]:
            order_status, reason = "closed", f"주문 마감({delivery['cutoff']}, 갱신 시각 기준)"
        elif availability == "in_stock":
            order_status, reason = "orderable", None
        else:
            order_status, reason = "unknown", None

    standard, unit = goods.get("standard"), goods.get("unit")
    weight_kg, weight_text, notes = combine_weight(standard, title)
    pieces, piece_label = combine_pieces(standard, title)
    bp = best_price(regular, sale, coupon, coupon_eligible)
    if "sale_gt_regular" in bp.warnings:
        notes.append("할인가가 정상가보다 높게 표기됨")
    if bp.price is None:
        notes.append("가격 정보 없음")
    if goods.get("isForFirstBuyUser"):
        notes.append("첫 구매 고객 전용 상품")
    if fee_note:
        notes.append(fee_note)
    needs_review = weight_kg is None and pieces is None or bp.price is None or "sale_gt_regular" in bp.warnings

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
        coupon_eligible=coupon_eligible,
        coupon_conditions=coupon_conditions,
        shipping_status=shipping_status,  # type: ignore[arg-type]
        shipping_price_krw=shipping_price,
        availability=availability,  # type: ignore[arg-type]
        observed_at=observed_at,
        extraction_status="needs_review" if needs_review else "verified",
        review_notes=notes,
        parse_confidence=0.6 if needs_review else 0.9,
        piece_count=pieces,
        piece_label=piece_label,
        order_status=order_status,  # type: ignore[arg-type]
        order_status_reason=reason,
        order_cutoff=delivery["cutoff"],
        delivery_lead_days=delivery["lead"],
        delivery_note=delivery["note"],
        shipping_free_threshold_krw=free_threshold,
    )


def parse_search_html(html: str, observed_at: str, now_kst: datetime | None = None) -> list[ListingObservation]:
    recs = _records(parse_next_data(html))
    ids = _search_goods_ids(recs)
    return [listing_from_goods(recs, recs[i], observed_at, now_kst) for i in ids if i in recs]


def parse_detail_html(html: str, goods_nid: str, observed_at: str, now_kst: datetime | None = None) -> ListingObservation | None:
    recs = _records(parse_next_data(html))
    goods = recs.get(f"goods_{goods_nid}")
    if not goods or goods.get("__typename") != "Goods":
        return None
    return listing_from_goods(recs, goods, observed_at, now_kst, detailed=True)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class FoodspringAdapter(SourceAdapter):
    source = "foodspring"

    def __init__(self, http: PoliteHttpClient, max_details: int = 40):
        self.http = http
        self.max_details = max_details
        self._detail_cache: dict[str, ListingObservation | None] = {}

    def check(self) -> ProviderCheck:
        try:
            ok = self.http.allowed(f"{BASE}/search/all?key=test")
        except AdapterError as e:
            return ProviderCheck("foodspring", "temporary_error", str(e))
        if not ok:
            return ProviderCheck("foodspring", "restricted", "robots.txt 가 검색 페이지 수집을 허용하지 않음")
        return ProviderCheck("foodspring", "available",
                             "공개 검색(정렬 4종, 검색어당 최대 32개)·상세 페이지 수집 · 쿠폰·배송비·주문 마감 포함")

    def search_basic(self, keyword: str) -> list[ListingObservation]:
        """정렬 4종 검색 결과 합집합(상품 ID 기준 중복 제거). 상세 정보 없음."""
        seen: dict[str, ListingObservation] = {}
        errors: list[str] = []
        for sort in SORTS:
            try:
                html = self.http.get_text(f"{BASE}/search/all?key={quote(keyword)}&sort={sort}")
            except AdapterError as e:
                if e.kind in ("blocked", "robots"):
                    raise
                errors.append(f"{sort}: {e}")
                continue
            for item in parse_search_html(html, _now()):
                seen.setdefault(item.source_product_id or item.source_url, item)
        if not seen and errors:
            raise AdapterError("http", "; ".join(errors))
        return list(seen.values())

    def enrich(self, item: ListingObservation) -> ListingObservation:
        """상세 페이지로 배송비·주문 마감·배송·쿠폰 조건 보강. 실패하면 검색 결과 그대로(메모 추가)."""
        nid = item.source_product_id
        if not nid:
            return item
        if nid not in self._detail_cache:
            if len(self._detail_cache) >= self.max_details:
                item.review_notes.append("상세 정보 수집 한도 초과 — 배송·마감 정보 없음")
                return item
            try:
                html = self.http.get_text(f"{BASE}/goods/detail/{nid}")
                self._detail_cache[nid] = parse_detail_html(html, nid, _now())
            except AdapterError as e:
                if e.kind in ("blocked", "robots"):
                    raise
                self._detail_cache[nid] = None
                item.review_notes.append(f"상세 페이지 수집 실패({e.kind})")
        detailed = self._detail_cache.get(nid)
        return detailed or item

    def reset_budget(self) -> None:
        """품목(탭)마다 상세 수집 한도를 새로 적용. 같은 실행 안에서 이미 받은 상세는 재사용."""
        self.max_details = len(self._detail_cache) + 40

    def search(self, keyword: str) -> list[ListingObservation]:
        return [self.enrich(i) for i in self.search_basic(keyword)]

    def fetch_url(self, url: str) -> ListingObservation | None:
        m = re.search(r"foodspring\.co\.kr/goods/detail/(\d+)", url)
        if not m:
            return None
        html = self.http.get_text(f"{BASE}/goods/detail/{m.group(1)}")
        return parse_detail_html(html, m.group(1), _now())
