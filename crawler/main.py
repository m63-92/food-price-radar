"""수집기 진입점 (GitHub Actions 에서 실행).

  python -m crawler.main run                  # 예약 슬롯 큐잉 → 대기 작업 처리
  python -m crawler.main dry-run 깐마늘         # DB 없이 식봄 검색 결과 정규화만 출력

한 제공처의 실패는 다른 제공처 결과에 영향을 주지 않으며, 실패 시 이전 정상값을 보존하고
상품 상태만 stale 로 표시한다. 실패한 수집은 관측(가격 이력)으로 기록하지 않는다.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import socket
import sys
from datetime import datetime, timezone

from .adapters.base import AdapterError, PoliteHttpClient, SourceAdapter
from .adapters.coupang import CoupangAdapter
from .adapters.foodspring import FoodspringAdapter
from .adapters.naver import NaverAdapter
from .persistence import Supabase
from .scheduler import Schedule, due_slot, next_slot_after

log = logging.getLogger("crawler")


def build_adapters(http: PoliteHttpClient) -> dict[str, SourceAdapter]:
    return {"foodspring": FoodspringAdapter(http), "naver": NaverAdapter(), "coupang": CoupangAdapter()}


def _parse_ts(v: str | None) -> datetime | None:
    return datetime.fromisoformat(v.replace("Z", "+00:00")) if v else None


def enqueue_due_schedules(db: Supabase, now: datetime) -> int:
    rows = db.select("category_schedules", {"select": "*,categories!inner(deleted_at)", "enabled": "eq.true",
                                            "categories.deleted_at": "is.null"})
    n = 0
    for r in rows:
        s = Schedule(True, r["frequency"], r.get("days_of_week") or [], r.get("times_of_day") or [], r.get("interval_hours"))
        slot = due_slot(s, now, _parse_ts(r.get("last_enqueued_slot")))
        nxt = next_slot_after(s, now)
        if slot is None:
            if nxt and r.get("next_due_at") != nxt.isoformat():
                db.update("category_schedules", {"id": f"eq.{r['id']}"}, {"next_due_at": nxt.isoformat()})
            continue
        job = db.rpc("fpr_enqueue_scheduled", {"p_category_id": r["category_id"], "p_slot": slot.isoformat(),
                                               "p_next_due": nxt.isoformat() if nxt else None})
        if job:
            n += 1
            delay = (now - slot).total_seconds() / 60
            log.info("예약 큐잉 category=%s slot=%s (지연 %.1f분)", r["category_id"], slot.isoformat(), delay)
    return n


def is_excluded(title: str, exclude: list[str]) -> bool:
    """SQL fpr_is_excluded 와 같은 규칙: 상품명에 제외 키워드가 하나라도 있으면 제외(대소문자 무시)."""
    t = (title or "").lower()
    return any(k in t for k in exclude)


def process_category(db: Supabase, adapters: dict[str, SourceAdapter], job: dict, cat: dict) -> tuple[int, int]:
    """반환: (성공 제공처 수, 실패 제공처 수)"""
    ok = failed = 0
    for source in cat.get("enabled_sources") or []:
        adapter = adapters.get(source)
        if adapter is None:
            continue
        run = db.insert("crawl_runs", {"owner_id": cat["owner_id"], "refresh_job_id": job["id"],
                                       "category_id": cat["id"], "source": source, "status": "running"})
        collected = changed = item_failed = excluded = 0
        errors: list[str] = []
        exclude = [k.strip().lower() for k in cat.get("exclude_keywords") or [] if k.strip()]
        try:
            listings = []
            if isinstance(adapter, FoodspringAdapter):
                # 검색 결과에서 제외 키워드를 먼저 걸러 상세 페이지 요청을 줄인다
                adapter.reset_budget()
                for kw in cat.get("keywords") or [cat["name"]]:
                    for item in adapter.search_basic(kw):
                        if is_excluded(item.title, exclude):
                            excluded += 1
                            continue
                        listings.append(adapter.enrich(item))
            else:
                for kw in cat.get("keywords") or [cat["name"]]:
                    listings.extend(adapter.search(kw))
            for url in cat.get("tracked_urls") or []:
                try:
                    one = adapter.fetch_url(url)
                    if one:
                        listings.append(one)
                except AdapterError as e:
                    item_failed += 1
                    errors.append(f"{url}: {e}")
            seen: set[tuple] = set()
            for item in listings:
                key = (item.source_product_id, item.source_option_id, item.source_url)
                if key in seen:
                    continue
                seen.add(key)
                try:
                    res = db.rpc("fpr_ingest_listing", {"p_run_id": run["id"], "p_category_id": cat["id"], "p_obs": item.to_rpc()})
                    status = (res or {}).get("status")
                    if status in ("changed", "unchanged", "duplicate"):
                        collected += 1
                        changed += status == "changed"
                    elif status == "excluded":
                        excluded += 1
                except Exception as e:  # 한 건 실패가 나머지를 막지 않도록
                    item_failed += 1
                    errors.append(f"{item.source_url}: {e}")
            run_status = "success" if item_failed == 0 else ("partial" if collected else "failed")
        except AdapterError as e:
            errors.append(f"[{e.kind}] {e}")
            run_status = "failed"
            if e.kind not in ("restricted", "not_configured"):
                db.rpc("fpr_mark_source_stale", {"p_category_id": cat["id"], "p_source": source})
        db.update("crawl_runs", {"id": f"eq.{run['id']}"}, {
            "status": run_status, "finished_at": datetime.now(timezone.utc).isoformat(),
            "collected_count": collected, "changed_count": changed, "failed_count": item_failed,
            "error_detail": "\n".join(errors + ([f"제외 키워드로 {excluded}개 제외"] if excluded else []))[:4000] or None,
        })
        if run_status == "failed":
            failed += 1
        else:
            ok += 1
    return ok, failed


def run(db: Supabase) -> int:
    now = datetime.now(timezone.utc)
    worker = f"gha-{os.environ.get('GITHUB_RUN_ID', socket.gethostname())}"
    queued = enqueue_due_schedules(db, now)
    log.info("예약 슬롯 %d건 큐잉", queued)

    http = PoliteHttpClient()
    adapters = build_adapters(http)
    for a in adapters.values():
        c = a.check()
        db.upsert("provider_status", {"source": c.source, "state": c.state, "detail": c.detail,
                                      "updated_at": now.isoformat()}, "source")

    jobs = db.rpc("fpr_claim_jobs", {"p_worker": worker, "p_limit": 20, "p_lock_minutes": 60}) or []
    log.info("처리할 작업 %d건", len(jobs))
    for job in jobs:
        try:
            params = {"select": "*", "owner_id": f"eq.{job['owner_id']}", "deleted_at": "is.null", "order": "sort_order"}
            if job.get("category_id"):
                params["id"] = f"eq.{job['category_id']}"
            cats = db.select("categories", params)
            ok = failed = 0
            for cat in cats:
                o, f = process_category(db, adapters, job, cat)
                ok, failed = ok + o, failed + f
            status = "success" if failed == 0 else ("partial" if ok else "failed")
            db.rpc("fpr_finish_job", {"p_job_id": job["id"], "p_status": status,
                                      "p_error": None if failed == 0 else f"{failed}개 제공처 수집 실패(수집 로그 참조)"})
        except Exception as e:
            log.exception("작업 실패 %s", job["id"])
            db.rpc("fpr_finish_job", {"p_job_id": job["id"], "p_status": "failed", "p_error": str(e)[:500]})
    http.close()
    return 0


def dry_run(keyword: str) -> int:
    http = PoliteHttpClient()
    try:
        items = FoodspringAdapter(http).search(keyword)
    except AdapterError as e:
        print(f"수집 실패 [{e.kind}]: {e}", file=sys.stderr)
        return 1
    finally:
        http.close()
    out = json.dumps([i.to_rpc() for i in items], ensure_ascii=False, indent=2)
    # Windows 콘솔(cp949)에서도 깨지지 않도록 UTF-8 바이트로 출력
    sys.stdout.buffer.write((out + "\n").encode("utf-8"))
    return 0


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    p = argparse.ArgumentParser(prog="crawler")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("run")
    d = sub.add_parser("dry-run")
    d.add_argument("keyword")
    args = p.parse_args(argv)
    if args.cmd == "dry-run":
        return dry_run(args.keyword)
    db = Supabase()
    try:
        return run(db)
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
