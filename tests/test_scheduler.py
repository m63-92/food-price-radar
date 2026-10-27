from datetime import datetime, timedelta, timezone

from crawler.scheduler import Schedule, due_slot, latest_slot_at_or_before, next_slot_after, slot_key

KST = timezone(timedelta(hours=9))


def kst(s: str) -> datetime:
    return datetime.fromisoformat(s).replace(tzinfo=KST)


def daily(*times: str) -> Schedule:
    return Schedule(True, "daily", [], list(times), None)


def test_two_tabs_independent_daily_slots():
    now = kst("2026-10-27T12:00:00")
    garlic, cabbage = daily("08:30"), daily("19:00")
    assert latest_slot_at_or_before(garlic, now) == kst("2026-10-27T08:30:00")
    assert latest_slot_at_or_before(cabbage, now) == kst("2026-10-26T19:00:00")
    assert next_slot_after(cabbage, now) == kst("2026-10-27T19:00:00")


def test_multiple_times_per_day():
    s = daily("18:00", "08:30")
    assert next_slot_after(s, kst("2026-10-27T09:00:00")) == kst("2026-10-27T18:00:00")
    assert next_slot_after(s, kst("2026-10-27T18:00:00")) == kst("2026-10-28T08:30:00")


def test_weekly_monday_only():
    s = Schedule(True, "weekly", [1], ["07:00"], None)  # 1 = 월
    assert latest_slot_at_or_before(s, kst("2026-10-27T12:00:00")) == kst("2026-10-26T07:00:00")
    assert next_slot_after(s, kst("2026-10-27T12:00:00")) == kst("2026-11-02T07:00:00")


def test_interval_hours():
    s = Schedule(True, "interval", [], ["00:00"], 6)
    assert latest_slot_at_or_before(s, kst("2026-10-27T13:10:00")) == kst("2026-10-27T12:00:00")
    assert next_slot_after(s, kst("2026-10-27T13:10:00")) == kst("2026-10-27T18:00:00")


def test_due_slot_once_and_catch_up_single():
    s = daily("08:30")
    now = kst("2026-10-27T09:02:00")  # Actions 지연 32분
    assert due_slot(s, now, None) == kst("2026-10-27T08:30:00")
    assert due_slot(s, now, kst("2026-10-27T08:30:00")) is None
    assert due_slot(s, now, kst("2026-10-24T08:30:00")) == kst("2026-10-27T08:30:00")


def test_disabled_schedule():
    assert latest_slot_at_or_before(Schedule(False, "daily", [], ["08:30"]), kst("2026-10-27T12:00:00")) is None


def test_slot_key_matches_sql_format():
    assert slot_key("cat", kst("2026-10-28T08:30:00")) == "sched:cat:2026-10-27T23:30Z"
