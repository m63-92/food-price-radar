"""제공처 어댑터 공통 인터페이스와 정중한(polite) HTTP 클라이언트.

- robots.txt 를 확인하고 허용 경로만 요청한다.
- 호스트별 최소 요청 간격, 타임아웃, 지수 백오프(429/5xx/네트워크 오류), 동시성 1.
- CAPTCHA·차단(403) 응답은 우회하지 않고 즉시 실패로 보고한다.
"""

from __future__ import annotations

import logging
import time
import urllib.robotparser
from abc import ABC, abstractmethod
from urllib.parse import urlparse

import httpx

from ..models import CrawlSource, ListingObservation, ProviderCheck

log = logging.getLogger(__name__)

USER_AGENT = "FoodPriceRadarBot/0.1 (+https://github.com/; price monitoring for own purchasing; contact via repository)"


class AdapterError(Exception):
    """kind: blocked | http | parse | not_configured | restricted | robots"""

    def __init__(self, kind: str, message: str):
        super().__init__(message)
        self.kind = kind


class PoliteHttpClient:
    def __init__(self, min_interval_s: float = 1.5, timeout_s: float = 20.0, max_retries: int = 3,
                 transport: httpx.BaseTransport | None = None, sleep=time.sleep):
        self._client = httpx.Client(
            headers={"User-Agent": USER_AGENT, "Accept-Language": "ko-KR,ko;q=0.9"},
            timeout=timeout_s,
            follow_redirects=True,
            transport=transport,
        )
        self._min_interval = min_interval_s
        self._max_retries = max_retries
        self._last_request: dict[str, float] = {}
        self._robots: dict[str, urllib.robotparser.RobotFileParser] = {}
        self._sleep = sleep

    def close(self) -> None:
        self._client.close()

    def _throttle(self, host: str) -> None:
        last = self._last_request.get(host)
        if last is not None:
            wait = self._min_interval - (time.monotonic() - last)
            if wait > 0:
                self._sleep(wait)
        self._last_request[host] = time.monotonic()

    def allowed(self, url: str) -> bool:
        parts = urlparse(url)
        base = f"{parts.scheme}://{parts.netloc}"
        rp = self._robots.get(base)
        if rp is None:
            rp = urllib.robotparser.RobotFileParser()
            try:
                self._throttle(parts.netloc)
                res = self._client.get(f"{base}/robots.txt")
                if res.status_code >= 400:
                    # robots.txt 를 읽을 수 없으면 보수적으로 차단으로 본다
                    rp.parse(["User-agent: *", "Disallow: /"])
                else:
                    rp.parse(res.text.splitlines())
            except httpx.HTTPError as e:
                raise AdapterError("http", f"robots.txt 확인 실패: {e}") from e
            self._robots[base] = rp
        return rp.can_fetch(USER_AGENT, url)

    def get_text(self, url: str) -> str:
        if not self.allowed(url):
            raise AdapterError("robots", f"robots.txt 가 허용하지 않는 경로: {url}")
        host = urlparse(url).netloc
        delay = 2.0
        for attempt in range(1, self._max_retries + 1):
            self._throttle(host)
            try:
                res = self._client.get(url)
            except httpx.HTTPError as e:
                if attempt == self._max_retries:
                    raise AdapterError("http", f"네트워크 오류: {e}") from e
                self._sleep(delay)
                delay *= 2
                continue
            if res.status_code == 200:
                return res.text
            if res.status_code in (401, 403):
                raise AdapterError("blocked", f"접근 거부(HTTP {res.status_code}) — 우회하지 않음")
            if res.status_code in (429, 500, 502, 503, 504) and attempt < self._max_retries:
                retry_after = res.headers.get("Retry-After")
                self._sleep(float(retry_after) if retry_after and retry_after.isdigit() else delay)
                delay *= 2
                continue
            raise AdapterError("http", f"HTTP {res.status_code}: {url}")
        raise AdapterError("http", "재시도 한도 초과")


class SourceAdapter(ABC):
    source: CrawlSource

    @abstractmethod
    def check(self) -> ProviderCheck:
        """설정/권한 상태. 실제 수집 가능 여부와 사유."""

    @abstractmethod
    def search(self, keyword: str) -> list[ListingObservation]:
        """검색어로 상품 목록 수집. 실패 시 AdapterError."""

    def fetch_url(self, url: str) -> ListingObservation | None:
        """관리자가 등록한 상품 URL 1건 수집. 지원하지 않으면 None."""
        return None
