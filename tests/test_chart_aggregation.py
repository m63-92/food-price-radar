"""명세 8.4 그래프 수용 기준 (계산 검증용 가상 데이터, 실제 수집값 아님)."""

from datetime import datetime, timedelta, timezone

from crawler.analytics import build_comparison, daily_representative, price_change_summary

KST = timezone(timedelta(hours=9))


def ob(id_, day, best, weight):
    return {"id": id_, "observed_at": f"{day}T09:00:00+09:00", "best_price_krw": best,
            "unit_price_krw_per_kg": None if best is None or not weight else best / weight}


A = [ob("a1", "2026-10-01", 10000, 1), ob("a2", "2026-10-05", 9000, 1), ob("a3", "2026-10-10", 8000, 1)]
B = [ob("b1", "2026-10-10", 5500, 0.5)]
NOW = datetime(2026, 10, 11, 12, tzinfo=KST)


def test_change_rate_minus_20_percent():
    s = price_change_summary(A, "30d", NOW)["unit"]
    assert s["first"] == 10000 and s["last"] == 8000
    assert s["delta"] == -2000
    assert s["pct"] == -20


def test_comparison_values_and_gaps():
    rows, insufficient = build_comparison({"A": A, "B": B}, "30d", NOW)
    by_day = {r["day"]: r["values"] for r in rows}
    assert by_day["2026-10-10"] == {"A": 8000, "B": 11000}
    for d in ("2026-10-02", "2026-10-03", "2026-10-04"):
        assert by_day[d]["A"] is None  # 관측 없는 날 가짜 값 없음
    assert by_day["2026-10-11"]["A"] is None  # 10/11 크롤링 실패 → 0원 아님
    assert insufficient == []
    assert all(v != 0 for r in rows for v in r["values"].values() if v is not None)


def test_daily_representative_is_last_observation_of_kst_day():
    obs = [{"id": "1", "observed_at": "2026-10-09T16:00:00Z", "unit_price_krw_per_kg": 9000},  # KST 10/10 01:00
           {"id": "2", "observed_at": "2026-10-10T10:00:00Z", "unit_price_krw_per_kg": 8500}]  # KST 10/10 19:00
    assert daily_representative(obs) == {"2026-10-10": 8500}


def test_zero_first_value_rate_is_none():
    z = [ob("z1", "2026-10-01", 0, 1), ob("z2", "2026-10-02", 100, 1)]
    assert price_change_summary(z, "all", NOW)["price"]["pct"] is None


def test_product_without_history_is_insufficient():
    _, insufficient = build_comparison({"A": A, "C": []}, "30d", NOW)
    assert insufficient == ["C"]
