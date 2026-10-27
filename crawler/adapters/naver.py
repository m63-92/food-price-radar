"""네이버 쇼핑 어댑터 — 자동 수집 비활성(연동 제한).

- NAVER Developers 쇼핑 검색 Open API(openapi.naver.com/v1/search/shop.json)는 2026-07-31 종료,
  NAVER API HUB 에 동일한 대체 API 없음(명세 3.3).
- shopping.naver.com / search.shopping.naver.com robots.txt 는 일반 User-agent 에 Disallow: / (2026-10-27 확인).
따라서 우회 크롤링을 하지 않고, 상품 URL 수동 등록·관리자 가격 기록·CSV 가져오기만 지원한다.
허용된 제휴 데이터 경로를 확보하면 이 클래스의 search() 를 해당 계약에 맞게 구현한다.
"""

from __future__ import annotations

from ..models import ListingObservation, ProviderCheck
from .base import AdapterError, SourceAdapter


class NaverAdapter(SourceAdapter):
    source = "naver"

    def check(self) -> ProviderCheck:
        return ProviderCheck(
            "naver", "restricted",
            "쇼핑 검색 Open API 종료(2026-07-31)·robots.txt 전체 차단 → 자동 수집 없음. 수동 등록/CSV 가져오기 사용",
        )

    def search(self, keyword: str) -> list[ListingObservation]:
        raise AdapterError("restricted", "네이버 쇼핑은 허용된 자동 수집 경로가 없어 수집하지 않습니다.")
