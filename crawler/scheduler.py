"""탭별 예약 슬롯 계산 (Asia/Seoul). src/lib/domain/schedule.ts 와 같은 규칙.

GitHub Actions 의 cron 은 정시를 보장하지 않으므로, 슬롯 시각 이후 가능한 첫 실행에서
'마지막으로 큐에 넣은 슬롯 이후 도래한 가장 최근 슬롯' 하나만 큐에 넣는다(catch-up 1회).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))
INTERVAL_EPOCH = datetime(2026, 1, 1, tzinfo=KST)
_HHMM = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


@dataclass
class Schedule:
    enabled: bool
    frequency: str  # daily | weekly | interval
    days_of_week: list[int] = field(default_factory=list)  # 0=일
    times_of_day: list[str] = field(default_factory=list)
    interval_hours: int | None = None


def _minutes(times: list[str]) -> list[int]:
    out = set()
    for t in times:
        m = _HHMM.match(t.strip())
        if m:
            out.add(int(m.group(1)) * 60 + int(m.group(2)))
    return sorted(out)


def _js_weekday(d: datetime) -> int:
    return (d.weekday() + 1) % 7  # Python 월=0 → JS 일=0


def _day_slots(s: Schedule, day_start: datetime) -> list[datetime]:
    if s.frequency == "weekly" and _js_weekday(day_start) not in s.days_of_week:
        return []
    return [day_start + timedelta(minutes=m) for m in _minutes(s.times_of_day)]


def _interval(s: Schedule) -> tuple[datetime, timedelta] | None:
    h = s.interval_hours or 0
    if not 1 <= h <= 168:
        return None
    first = (_minutes(s.times_of_day) or [0])[0]
    return INTERVAL_EPOCH + timedelta(minutes=first), timedelta(hours=h)


def latest_slot_at_or_before(s: Schedule, now: datetime) -> datetime | None:
    if not s.enabled:
        return None
    now = now.astimezone(KST)
    if s.frequency == "interval":
        p = _interval(s)
        if p is None or now < p[0]:
            return None
        anchor, step = p
        return anchor + ((now - anchor) // step) * step
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    for i in range(8):
        slots = [t for t in _day_slots(s, today - timedelta(days=i)) if t <= now]
        if slots:
            return slots[-1]
    return None


def next_slot_after(s: Schedule, now: datetime) -> datetime | None:
    if not s.enabled:
        return None
    now = now.astimezone(KST)
    if s.frequency == "interval":
        p = _interval(s)
        if p is None:
            return None
        anchor, step = p
        if now < anchor:
            return anchor
        return anchor + ((now - anchor) // step + 1) * step
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    for i in range(8):
        for t in _day_slots(s, today + timedelta(days=i)):
            if t > now:
                return t
    return None


def due_slot(s: Schedule, now: datetime, last_enqueued_slot: datetime | None) -> datetime | None:
    latest = latest_slot_at_or_before(s, now)
    if latest is None:
        return None
    if last_enqueued_slot is not None and last_enqueued_slot >= latest:
        return None
    return latest


def slot_key(category_id: str, slot: datetime) -> str:
    """SQL fpr_enqueue_scheduled 와 같은 형식."""
    return f"sched:{category_id}:{slot.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%MZ')}"
