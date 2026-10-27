"""수집기 입출력 계약 (명세 11장 ListingObservation)."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Literal

CrawlSource = Literal["foodspring", "naver", "coupang"]
ShippingStatus = Literal["free", "paid", "unknown"]
Availability = Literal["in_stock", "out_of_stock", "unknown"]
ExtractionStatus = Literal["verified", "needs_review", "unavailable"]
ProviderState = Literal["available", "needs_setup", "temporary_error", "restricted"]


@dataclass
class ListingObservation:
    source: CrawlSource
    source_product_id: str | None
    source_option_id: str | None
    source_url: str
    title: str
    seller: str | None
    product_option: str | None
    raw_weight_text: str | None
    weight_kg: float | None
    regular_price_krw: int | None
    sale_price_krw: int | None
    coupon_price_krw: int | None
    coupon_eligible: bool | None
    coupon_conditions: str | None
    shipping_status: ShippingStatus
    shipping_price_krw: int | None
    availability: Availability
    observed_at: str
    extraction_status: ExtractionStatus
    review_notes: list[str] = field(default_factory=list)
    parse_confidence: float | None = None

    def to_rpc(self) -> dict:
        """fpr_ingest_listing 이 받는 snake_case JSON."""
        return asdict(self)


@dataclass
class ProviderCheck:
    source: CrawlSource
    state: ProviderState
    detail: str
