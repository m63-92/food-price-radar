"""병합·override·변경 감지 규칙의 순수 함수 버전.

실제 DB 반영은 원자성을 위해 SQL(fpr_ingest_listing / fpr_apply_effective / fpr_append_observation)이
수행한다. 이 모듈은 같은 규칙을 Python 에서 검증·드라이런하기 위한 기준 구현이다
(tests/test_merge_and_override.py, tests/test_price_history.py).
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass

from .normalize import best_price, unit_price

PRICE_FIELDS = ("regular_price_krw", "sale_price_krw", "coupon_price_krw", "coupon_eligible")


@dataclass
class Override:
    value: object
    is_locked: bool


def url_fingerprint(url: str) -> str:
    return hashlib.md5(re.sub(r"[?#].*$", "", url or "").lower().encode()).hexdigest()


def natural_key(source: str, source_product_id: str | None, source_option_id: str | None, url: str) -> tuple[str, str, str]:
    """(source, source_key, option_key). 상품 ID 가 없을 때만 URL 지문을 대체키로 쓴다."""
    key = source_product_id or f"url:{url_fingerprint(url)}"
    return source, key, source_option_id or ""


def is_tombstoned(tombstones: set[tuple[str, str, str]], listing: dict) -> bool:
    return natural_key(listing["source"], listing.get("source_product_id"), listing.get("source_option_id"),
                       listing["source_url"]) in tombstones


def merge_crawl_overrides(overrides: dict[str, Override]) -> dict[str, Override]:
    """새 수집이 들어오면 고정되지 않은 수동값은 버리고 고정값만 유지."""
    return {k: o for k, o in overrides.items() if o.is_locked}


def apply_overrides(raw: dict, overrides: dict[str, Override]) -> dict:
    eff = dict(raw)
    for k, o in overrides.items():
        eff[k] = o.value
    return eff


def snapshot(fields: dict) -> dict:
    bp = best_price(fields.get("regular_price_krw"), fields.get("sale_price_krw"),
                    fields.get("coupon_price_krw"), fields.get("coupon_eligible"))
    return {
        **{k: fields.get(k) for k in PRICE_FIELDS},
        "weight_kg": fields.get("weight_kg"),
        "best_price_krw": bp.price,
        "best_price_kind": bp.kind,
        # 관측 당시 중량으로 계산해 저장 — 나중에 중량이 바뀌어도 과거 단가를 재계산하지 않는다
        "unit_price_krw_per_kg": unit_price(bp.price, fields.get("weight_kg")),
        "shipping_status": fields.get("shipping_status", "unknown"),
        "shipping_price_krw": fields.get("shipping_price_krw"),
        "availability": fields.get("availability", "unknown"),
    }


def observation_key(origin: str, run_id: str | None, product_id: str, nonce: str | None = None) -> str:
    if origin == "crawl":
        return f"crawl:{run_id}:{product_id}"
    return f"manual:{nonce}"


def detect_changes(prev: dict | None, new: dict) -> list[str]:
    """SQL fpr_append_observation 과 같은 이벤트 규칙."""
    if prev is None:
        return ["first_seen"]
    events: list[str] = []
    pb, nb = prev.get("best_price_krw"), new.get("best_price_krw")
    if pb is not None and nb is not None and pb != nb:
        events.append("price_down" if nb < pb else "price_up")
    if prev.get("coupon_price_krw") != new.get("coupon_price_krw") or prev.get("coupon_eligible") != new.get("coupon_eligible"):
        events.append("coupon_changed")
    if prev.get("weight_kg") != new.get("weight_kg"):
        events.append("weight_changed")
    if prev.get("shipping_status") != new.get("shipping_status") or prev.get("shipping_price_krw") != new.get("shipping_price_krw"):
        events.append("shipping_changed")
    if new.get("availability") == "out_of_stock" and prev.get("availability") != "out_of_stock":
        events.append("out_of_stock")
    elif new.get("availability") == "in_stock" and prev.get("availability") == "out_of_stock":
        events.append("restocked")
    return events


class ObservationLog:
    """append-only 관측 로그의 메모리 구현(테스트·드라이런용). idempotency key 로 중복 방지."""

    def __init__(self) -> None:
        self.rows: list[dict] = []
        self._keys: set[str] = set()

    def append(self, key: str, observed_at: str, snap: dict, origin: str) -> bool:
        if key in self._keys:
            return False
        self._keys.add(key)
        self.rows.append({"key": key, "observed_at": observed_at, "origin": origin, **snap})
        return True
