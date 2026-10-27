from crawler.reconcile import (
    Override,
    apply_overrides,
    is_tombstoned,
    merge_crawl_overrides,
    natural_key,
    snapshot,
)

RAW = {"title": "깐마늘 1kg", "regular_price_krw": 10000, "sale_price_krw": 8000, "coupon_price_krw": None,
       "coupon_eligible": None, "weight_kg": 1, "shipping_status": "paid", "shipping_price_krw": 3000}


def test_locked_override_survives_crawl_and_unlocked_is_replaced():
    ov = {"sale_price_krw": Override(6000, True), "title": Override("임시", False)}
    kept = merge_crawl_overrides(ov)
    assert set(kept) == {"sale_price_krw"}
    eff = apply_overrides({**RAW, "sale_price_krw": 8500}, kept)
    assert eff["sale_price_krw"] == 6000
    assert eff["title"] == "깐마늘 1kg"


def test_revert_to_auto_value():
    eff = apply_overrides(RAW, {})
    assert eff == RAW


def test_effective_unit_price_recomputed_after_edit_and_shipping_excluded():
    eff = apply_overrides(RAW, {"sale_price_krw": Override(6000, True)})
    s = snapshot(eff)
    assert s["best_price_krw"] == 6000
    assert s["unit_price_krw_per_kg"] == 6000  # 배송비 3,000 미포함


def test_tombstone_blocks_rediscovered_product():
    listing = {"source": "foodspring", "source_product_id": "868118", "source_option_id": None,
               "source_url": "https://www.foodspring.co.kr/goods/detail/868118"}
    tomb = {natural_key("foodspring", "868118", None, listing["source_url"])}
    assert is_tombstoned(tomb, listing)
    assert not is_tombstoned(tomb, {**listing, "source_product_id": "999"})


def test_natural_key_does_not_merge_different_options_or_sources():
    a = natural_key("foodspring", "1", "opt-a", "u")
    b = natural_key("foodspring", "1", "opt-b", "u")
    c = natural_key("coupang", "1", "opt-a", "u")
    assert len({a, b, c}) == 3


def test_url_fallback_key_ignores_query_string():
    k1 = natural_key("naver", None, None, "https://example.invalid/p/1?utm=a")
    k2 = natural_key("naver", None, None, "https://example.invalid/p/1")
    assert k1 == k2
