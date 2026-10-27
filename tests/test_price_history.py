from crawler.reconcile import ObservationLog, Override, apply_overrides, detect_changes, observation_key, snapshot

BASE = {"regular_price_krw": 12000, "sale_price_krw": 10000, "coupon_price_krw": None, "coupon_eligible": None,
        "weight_kg": 1, "shipping_status": "paid", "shipping_price_krw": 3000, "availability": "in_stock"}


def test_every_successful_crawl_appends_even_if_unchanged():
    log = ObservationLog()
    assert log.append(observation_key("crawl", "run1", "A"), "2026-10-01T00:00:00Z", snapshot(BASE), "crawl")
    assert log.append(observation_key("crawl", "run2", "A"), "2026-10-02T00:00:00Z", snapshot(BASE), "crawl")
    assert len(log.rows) == 2


def test_same_run_retry_is_idempotent():
    log = ObservationLog()
    k = observation_key("crawl", "run1", "A")
    assert log.append(k, "2026-10-01T00:00:00Z", snapshot(BASE), "crawl")
    assert not log.append(k, "2026-10-01T00:00:05Z", snapshot(BASE), "crawl")
    assert len(log.rows) == 1


def test_manual_edit_creates_distinct_observation_with_origin():
    log = ObservationLog()
    log.append(observation_key("crawl", "run1", "A"), "2026-10-01T00:00:00Z", snapshot(BASE), "crawl")
    eff = apply_overrides(BASE, {"sale_price_krw": Override(9000, True)})
    log.append(observation_key("manual_edit", None, "A", "n1"), "2026-10-01T03:00:00Z", snapshot(eff), "manual_edit")
    assert [r["origin"] for r in log.rows] == ["crawl", "manual_edit"]
    assert log.rows[-1]["best_price_krw"] == 9000


def test_change_events():
    prev = snapshot(BASE)
    assert detect_changes(None, prev) == ["first_seen"]
    assert detect_changes(prev, snapshot({**BASE, "sale_price_krw": 9000})) == ["price_down"]
    assert detect_changes(prev, snapshot({**BASE, "sale_price_krw": 11000})) == ["price_up"]
    assert detect_changes(prev, snapshot({**BASE, "coupon_price_krw": 8000, "coupon_eligible": True})) == ["price_down", "coupon_changed"]
    assert detect_changes(prev, snapshot({**BASE, "weight_kg": 2})) == ["weight_changed"]
    assert detect_changes(prev, snapshot({**BASE, "shipping_status": "free", "shipping_price_krw": None})) == ["shipping_changed"]
    oos = snapshot({**BASE, "availability": "out_of_stock"})
    assert detect_changes(prev, oos) == ["out_of_stock"]
    assert detect_changes(oos, prev) == ["restocked"]
    assert detect_changes(prev, snapshot(BASE)) == []


def test_unit_price_uses_weight_at_observation_time():
    a = snapshot(BASE)
    b = snapshot({**BASE, "weight_kg": 2})
    assert (a["unit_price_krw_per_kg"], b["unit_price_krw_per_kg"]) == (10000, 5000)


def test_missing_price_is_null_not_zero():
    s = snapshot({**BASE, "regular_price_krw": None, "sale_price_krw": None})
    assert s["best_price_krw"] is None and s["unit_price_krw_per_kg"] is None
