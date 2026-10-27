"""쿠팡 어댑터.

- 쿠팡 Open API(developers.coupang.com)는 판매자(Wing) 상품·주문 관리용이며 구매자용 전체 상품 검색이 아니다.
- www.coupang.com 은 robots.txt 조차 403(Access Denied) 으로 응답한다(2026-10-27 확인) → 웹 페이지 수집 안 함.
- 승인된 쿠팡 파트너스 계정이 있는 경우에만 파트너스 상품 검색 API 를 사용할 수 있다.
  COUPANG_PARTNERS_ACCESS_KEY / COUPANG_PARTNERS_SECRET_KEY 가 없으면 '설정 필요' 상태로 수집하지 않는다.
  파트너스 약관(대가성 문구 표기, 링크 사용 조건, 호출 한도)을 반드시 직접 확인할 것.
  ⚠ 이 경로는 키가 없어 실데이터로 검증하지 못했다(미검증). 응답 필드: productId, productName,
    productPrice, productUrl, isRocket, isFreeShipping.
- productPrice 는 '현재 판매가'로 정상가 열에 기록하고, 로켓/와우/카드 할인·쿠폰은 확인 불가로 비워 둔다.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import time
from datetime import datetime, timezone
from urllib.parse import urlencode

import httpx

from ..models import ListingObservation, ProviderCheck
from ..normalize import parse_krw, parse_weight
from .base import USER_AGENT, AdapterError, SourceAdapter

API_HOST = "https://api-gateway.coupang.com"
SEARCH_PATH = "/v2/providers/affiliate_open_api/apis/openapi/products/search"


def partners_authorization(method: str, path: str, query: str, access_key: str, secret_key: str,
                           now: float | None = None) -> str:
    signed_date = time.strftime("%y%m%dT%H%M%SZ", time.gmtime(now if now is not None else time.time()))
    message = signed_date + method + path + query
    signature = hmac.new(secret_key.encode(), message.encode(), hashlib.sha256).hexdigest()
    return f"CEA algorithm=HmacSHA256, access-key={access_key}, signed-date={signed_date}, signature={signature}"


def parse_partners_products(payload: dict, observed_at: str) -> list[ListingObservation]:
    if str(payload.get("rCode")) != "0":
        raise AdapterError("http", f"쿠팡 파트너스 응답 오류: {payload.get('rMessage')}")
    items = (payload.get("data") or {}).get("productData") or []
    out: list[ListingObservation] = []
    for it in items:
        title = str(it.get("productName") or "").strip()
        w = parse_weight(title)
        price = parse_krw(it.get("productPrice"))
        notes = ["쿠팡 파트너스 productPrice(현재 판매가) — 회원·카드·쿠폰 할인 미반영"]
        if w.kg is None:
            notes.append("상품명에서 중량을 확정할 수 없음")
        out.append(ListingObservation(
            source="coupang",
            source_product_id=str(it.get("productId")) if it.get("productId") is not None else None,
            source_option_id=None,
            source_url=str(it.get("productUrl") or ""),
            title=title or "쿠팡 상품",
            seller=None,
            product_option="로켓배송" if it.get("isRocket") else None,
            raw_weight_text=title if w.kg is not None else None,
            weight_kg=w.kg,
            regular_price_krw=price,
            sale_price_krw=None,
            coupon_price_krw=None,
            coupon_eligible=None,
            coupon_conditions=None,
            shipping_status="free" if it.get("isFreeShipping") is True else "unknown",
            shipping_price_krw=None,
            availability="unknown",
            observed_at=observed_at,
            extraction_status="verified" if (w.kg is not None and price is not None) else "needs_review",
            review_notes=notes,
            parse_confidence=0.7,
        ))
    return out


class CoupangAdapter(SourceAdapter):
    source = "coupang"

    def __init__(self, access_key: str | None = None, secret_key: str | None = None,
                 transport: httpx.BaseTransport | None = None):
        self.access_key = access_key if access_key is not None else os.environ.get("COUPANG_PARTNERS_ACCESS_KEY")
        self.secret_key = secret_key if secret_key is not None else os.environ.get("COUPANG_PARTNERS_SECRET_KEY")
        self._transport = transport

    @property
    def configured(self) -> bool:
        return bool(self.access_key and self.secret_key)

    def check(self) -> ProviderCheck:
        if not self.configured:
            return ProviderCheck(
                "coupang", "restricted",
                "구매자용 공식 상품 API 없음 · 웹은 접근 거부(403). 쿠팡 파트너스 승인 키 설정 시에만 수집(미검증). 수동 등록/CSV 사용",
            )
        return ProviderCheck("coupang", "available", "쿠팡 파트너스 상품 검색 API(현재 판매가만, 쿠폰/회원가 제외)")

    def search(self, keyword: str) -> list[ListingObservation]:
        if not self.configured:
            raise AdapterError("not_configured", "쿠팡 파트너스 키가 설정되지 않아 수집하지 않습니다.")
        query = urlencode({"keyword": keyword, "limit": 10})
        auth = partners_authorization("GET", SEARCH_PATH, query, self.access_key or "", self.secret_key or "")
        with httpx.Client(timeout=20, transport=self._transport, headers={"User-Agent": USER_AGENT}) as c:
            try:
                res = c.get(f"{API_HOST}{SEARCH_PATH}?{query}", headers={"Authorization": auth})
            except httpx.HTTPError as e:
                raise AdapterError("http", f"쿠팡 파트너스 네트워크 오류: {e}") from e
        if res.status_code in (401, 403):
            raise AdapterError("blocked", f"쿠팡 파트너스 인증 실패(HTTP {res.status_code})")
        if res.status_code != 200:
            raise AdapterError("http", f"쿠팡 파트너스 HTTP {res.status_code}")
        return parse_partners_products(res.json(), datetime.now(timezone.utc).isoformat(timespec="seconds"))
