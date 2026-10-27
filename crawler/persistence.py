"""Supabase(PostgREST) 접근. service_role 키는 GitHub Actions Secret 으로만 주입된다."""

from __future__ import annotations

import os
from typing import Any

import httpx


class SupabaseError(RuntimeError):
    pass


class Supabase:
    def __init__(self, url: str | None = None, service_key: str | None = None, transport: httpx.BaseTransport | None = None):
        url = url or os.environ.get("SUPABASE_URL")
        key = service_key or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            raise SupabaseError("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다.")
        self._c = httpx.Client(
            base_url=url.rstrip("/") + "/rest/v1",
            headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            timeout=30,
            transport=transport,
        )

    def close(self) -> None:
        self._c.close()

    def _check(self, res: httpx.Response) -> Any:
        if res.status_code >= 400:
            raise SupabaseError(f"{res.request.method} {res.request.url.path} → {res.status_code}: {res.text[:500]}")
        return res.json() if res.content else None

    def rpc(self, fn: str, params: dict) -> Any:
        return self._check(self._c.post(f"/rpc/{fn}", json=params))

    def select(self, table: str, params: dict[str, str]) -> list[dict]:
        return self._check(self._c.get(f"/{table}", params=params))

    def insert(self, table: str, row: dict) -> dict:
        res = self._check(self._c.post(f"/{table}", json=row, headers={"Prefer": "return=representation"}))
        return res[0]

    def update(self, table: str, filters: dict[str, str], body: dict) -> None:
        self._check(self._c.patch(f"/{table}", params=filters, json=body))

    def upsert(self, table: str, row: dict, on_conflict: str) -> None:
        self._check(self._c.post(f"/{table}", params={"on_conflict": on_conflict}, json=row,
                                 headers={"Prefer": "resolution=merge-duplicates"}))
