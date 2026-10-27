"""가격 그래프 집계 규칙 (src/lib/domain/history.ts 와 동일). 보간·0원 대체 금지."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))
RANGE_DAYS = {"7d": 7, "30d": 30, "90d": 90, "1y": 365}


def _ts(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


def kst_day(iso: str) -> str:
    return _ts(iso).astimezone(KST).date().isoformat()


def filter_range(obs: list[dict], range_key: str, now: datetime) -> list[dict]:
    start = None if range_key == "all" else now - timedelta(days=RANGE_DAYS[range_key])
    rows = [o for o in obs if start is None or _ts(o["observed_at"]) >= start]
    return sorted(rows, key=lambda o: (_ts(o["observed_at"]), o["id"]))


def summarize(values: list[float | None]) -> dict:
    valid = [v for v in values if v is not None]
    if not valid:
        return {"first": None, "last": None, "min": None, "max": None, "delta": None, "pct": None}
    first, last = valid[0], valid[-1]
    delta = last - first
    return {
        "first": first, "last": last, "min": min(valid), "max": max(valid), "delta": delta,
        "pct": None if first == 0 else delta / first * 100,
    }


def price_change_summary(obs: list[dict], range_key: str, now: datetime) -> dict:
    rows = filter_range(obs, range_key, now)
    return {
        "price": summarize([o.get("best_price_krw") for o in rows]),
        "unit": summarize([o.get("unit_price_krw_per_kg") for o in rows]),
    }


def daily_representative(obs: list[dict]) -> dict[str, float | None]:
    """KST 날짜별 그날 마지막 성공 관측의 원/kg. 관측 없는 날은 키 없음."""
    out: dict[str, float | None] = {}
    for o in sorted(obs, key=lambda o: (_ts(o["observed_at"]), o["id"])):
        out[kst_day(o["observed_at"])] = o.get("unit_price_krw_per_kg")
    return out


def build_comparison(obs_by_product: dict[str, list[dict]], range_key: str, now: datetime) -> tuple[list[dict], list[str]]:
    daily = {pid: daily_representative(filter_range(o, range_key, now)) for pid, o in obs_by_product.items()}
    insufficient = [pid for pid, d in daily.items() if not any(v is not None for v in d.values())]
    all_days = [d for rep in daily.values() for d in rep]
    if not all_days:
        return [], insufficient
    start = date.fromisoformat(min(all_days))
    end = max(start, now.astimezone(KST).date())
    rows = []
    cur = start
    while cur <= end:
        key = cur.isoformat()
        rows.append({"day": key, "values": {pid: rep.get(key) for pid, rep in daily.items()}})
        cur += timedelta(days=1)
    return rows, insufficient
