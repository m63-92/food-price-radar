# 제공처별 수집 가능성 조사 (2026-10-27)

수집 전 각 제공처의 공식 API·robots.txt·접근 구조를 직접 확인한 결과다. **허용되거나 승인된 경로만** 자동 수집하고, 나머지는 `연동 제한`으로 표시한 뒤 상품 URL 수동 등록·관리자 가격 기록·CSV 가져오기로 관리한다.

| 제공처 | 자동 수집 | 앱 표시 상태 | 근거 |
|---|---|---|---|
| 식봄 | **가능(제한적)** | 사용 가능 | robots.txt 가 `/search/all`, `/goods/detail/` 을 모든 User-agent 에 Allow |
| 네이버 쇼핑 | **불가** | 연동 제한 | 쇼핑 검색 Open API 종료(2026-07-31), 쇼핑 도메인 robots.txt 전체 Disallow |
| 쿠팡 | **불가**(파트너스 승인 시 선택) | 연동 제한 / 설정 시 사용 가능 | 구매자용 공식 API 없음, www.coupang.com robots.txt 요청도 403 |

## 1. 식봄 (https://www.foodspring.co.kr)

### 확인한 것
- `GET /robots.txt` → 200. `User-agent: *` 그룹(최종 수정 2026-10-25 표기)
  - Disallow: `/main/ /signup/ /mypage/ /cart /order/ /service/ /payment /API/ /f/ /application/ /_next/`
  - Allow: `/login /plan /category/goods_detail/ /search/all /seller/ /goods/detail/`
- `GET /search/all?key=깐마늘` → 200, Next.js 페이지. 응답 HTML 의 `<script id="__NEXT_DATA__">` 안 `props.pageProps.initialRecords` 에 서버 렌더링된 Relay 레코드가 있다.
  - `Goods`: `nid`(상품 ID), `name`, `standard`(규격, 예 `1KG`/`900g`/`약 8kg`), `unit`, `isFreeDelivery`, `vendor`, `price`, `deliveryFee`, `stock`
  - `GoodsPrice`: `originalPrice`(정상가), `salePrice`(할인가), `appliedCoupon.price`(쿠폰 적용가), `discountRate`
  - `ConditionalDeliveryFee`: `condition`(무료배송 기준 금액), 상세 페이지에서는 `price`(배송비)까지 포함
  - `GoodsStock.quantity`, `Vendor.name`
- `GET /goods/detail/868118` → 200, 같은 구조로 단일 상품 + 배송비 금액 제공.
- 검색 결과는 **키워드당 첫 8개만** 서버 렌더링된다. 다음 페이지는 클라이언트가 내부 API/GraphQL 로 가져오는데 `/API/`·`/_next/` 는 Disallow 이므로 호출하지 않는다 → 검색어를 여러 개 등록하거나 상세 URL 을 추적 목록에 추가해서 범위를 넓힌다.
- 실제 실행 결과(2026-10-27 21:58 KST, 수집기 `dry-run 깐마늘`): robots 확인 1회 + 검색 1회 요청으로 8개 상품 정규화 성공. 예) `깐마늘 900g` 정상가=할인가 ₩9,090 → ₩10,100/kg.

### 구현 방식과 한계
- `crawler/adapters/foodspring.py`: 허용 경로의 HTML 만 요청, `__NEXT_DATA__` 파싱. 요청 간격 3초, 타임아웃 20초, 429/5xx 지수 백오프(최대 3회), 401/403 은 우회 없이 즉시 실패.
- **쿠폰가**: 비로그인 상태 표시값이며 발급 조건(첫 구매·회원 등급·최소 금액 등)을 확인할 수 없다 → `coupon_eligible = null` 로 저장, 표에는 `조건 미확인·제외`로 표시하고 **최저가/단가 계산에서 제외**. 관리자가 조건을 확인했다면 수정 화면에서 `적용 가능 확인됨`으로 고정할 수 있다.
- **배송비**: 대부분 판매자 묶음 조건부(예: ₩100,000 이상 무료). 검색 페이지에는 금액이 없어 `유료 (금액 미확인)`, 상세 페이지 추적 상품은 금액까지 기록. 단가에는 절대 포함하지 않는다.
- **지역/로그인 가격**: 응답의 `areaId` 는 비로그인 기본 지역이다. 사업자 지역·로그인 회원가와 다를 수 있으므로 화면에 수집 시각·원본 링크를 함께 둔다. 계정 정보를 수집 코드에 저장하지 않는다.
- **중량**: `standard` 와 상품명을 함께 검증. `약`·`내외`·`~`·`±` 표기나 두 값이 다르면 단가를 계산하지 않고 `검토 필요`.
- 페이지 구조가 바뀌면 `AdapterError(parse)` 로 실패 기록 → 이전 정상값 유지, 상품 상태 `수집 실패`.
- **이용약관**: robots.txt 외에 식봄 이용약관의 자동화 수집 조항은 로그인 없이 열람 가능한 공개 문서를 찾지 못해 확인하지 못했다. 운영 전에 운영자가 약관을 직접 확인하고, 필요하면 식봄에 문의할 것. 요청량은 탭당 `검색어 수 + 추적 URL 수` 회/갱신으로 낮게 유지된다.

## 2. 네이버 쇼핑

- NAVER Developers 쇼핑 검색 Open API(`openapi.naver.com/v1/search/shop.json`)는 **2026-07-31 종료**, NAVER API HUB 에 동일 대체 API 없음(명세 3.3, 공지 32564·32530).
- `https://shopping.naver.com/robots.txt` → `User-agent: *` 에 `Disallow: /`, AI·RAG 목적 접근 금지 명시.
- `https://search.shopping.naver.com/robots.txt` → `User-agent: *` 에 `Disallow: /`.
- 결론: 자동 수집 경로 없음. `NaverAdapter` 는 항상 `restricted` 를 보고하고 요청을 보내지 않는다. 사용자는 **상품 수동 추가(제공처=네이버)** 또는 **CSV 가져오기**로 등록하고 관리자가 확인한 가격을 기록한다.

## 3. 쿠팡

- 쿠팡 Open API(developers.coupang.com)는 판매자(Wing) 상품·주문 관리용으로, 일반 구매자용 전체 상품 검색·쿠폰가 조회 기능이 아니다.
- `https://www.coupang.com/robots.txt` 요청 자체가 **403 Access Denied**(Akamai) → 웹 페이지 수집 시도하지 않음.
- 쿠팡 파트너스(제휴 마케팅) 승인 계정은 상품 검색 API 를 쓸 수 있다. `CoupangAdapter` 에 HMAC 서명 호출을 구현해 두었으나 **키가 없어 실데이터로 검증하지 못했다(미검증)**. `COUPANG_PARTNERS_ACCESS_KEY`/`COUPANG_PARTNERS_SECRET_KEY` 를 설정하지 않으면 요청하지 않는다.
  - 파트너스 API 의 가격은 현재 판매가 1종(로켓·와우·카드·쿠폰 할인 미반영) → 정상가 열에만 기록.
  - 파트너스 약관(대가성 문구 표기, 링크 사용 조건, 호출 한도)이 이 용도(내부 구매 단가 비교)에 맞는지 운영자가 직접 확인해야 한다.
- 그 외에는 네이버와 같이 수동 등록/CSV 가져오기 사용.

## 4. 공통 정책 (구현됨)
- CAPTCHA 회피·프록시/IP 회전·비인가 로그인 자동화·비공개 API 호출 없음.
- 한 제공처 실패가 다른 제공처 결과를 지우지 않음(제공처별 `crawl_runs`).
- 실패한 수집은 가격 관측으로 기록하지 않음 → 그래프에 0원/가짜 점이 생기지 않음.
- 모든 실행은 `crawl_runs` 에 시작·종료 시각, 수집/변경/실패 건수, 오류 내용을 남긴다.
