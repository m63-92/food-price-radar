# 아키텍처

```text
[GitHub Pages: Vite+React 정적 앱] ──(anon key + 사용자 JWT, RLS)──▶ [Supabase PostgreSQL]
        │  수동 갱신                                                    ▲
        ▼                                                               │ service_role (Actions Secret)
[Edge Function request-refresh] ─ 작업 큐 생성 ─▶ refresh_jobs          │
        │ workflow_dispatch (GITHUB_DISPATCH_TOKEN)                     │
        ▼                                                               │
[GitHub Actions crawl.yml: 5분 cron + dispatch] ── python -m crawler.main run
```

## 데이터 흐름
1. **예약**: `crawl.yml` 이 5분마다 실행 → `scheduler.py` 가 탭별 예약(KST)에서 도래한 최신 슬롯을 `fpr_enqueue_scheduled` 로 큐에 넣음. `slot_key` 유니크 제약으로 같은 슬롯은 한 번만.
2. **수동**: 웹 → Edge Function(사용자 JWT 로 `fpr_enqueue_refresh` 호출, 소유권 검사) → GitHub `workflow_dispatch`. 호출 실패 시에도 큐는 남아 다음 정기 실행에서 처리.
3. **처리**: `fpr_claim_jobs` 가 `FOR UPDATE SKIP LOCKED` + 30분 락으로 작업을 가져감(만료 시 재시도, 최대 3회). Actions `concurrency: crawl` 로 동시 실행도 막음.
4. **반영**: 상품 1건마다 `fpr_ingest_listing` 이 한 트랜잭션에서 tombstone 확인 → 상품 upsert → raw 갱신 → 고정 안 된 override 제거 → effective 재계산 → 관측 append(`crawl:<run>:<product>` 멱등 키) → 변경 이벤트 생성.
5. **실패**: 제공처 오류 시 `fpr_mark_source_stale` 로 상태만 `stale`, 값·이력은 그대로.
6. **화면**: React Query 가 작업 상태를 15초마다 확인하고, 작업이 실제로 `success/partial/failed` 로 바뀐 순간에만 표·그래프 캐시를 무효화.

## 값 계층
| 계층 | 위치 | 설명 |
|---|---|---|
| raw | `products.raw_meta`, `current_prices.raw_*` | 마지막 수집 원본 |
| override | `product_overrides` | 필드별 관리자 값 + `is_locked` |
| effective | `products.*`, `current_prices.*` | raw ⊕ override, 표에 표시되는 값 |
| 이력 | `price_observations` | raw·effective 스냅샷을 모두 저장, origin=`crawl`/`manual_edit` |

단가 계산 규칙은 SQL(`fpr_best_price`), TypeScript(`src/lib/domain/pricing.ts`), Python(`crawler/normalize.py`) 세 곳에 있고, `tests/vectors/*.json` 공유 벡터로 같은 결과를 내는지 검증한다.

## 보안
- 브라우저 번들에는 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` 만. 배포 워크플로가 빌드 산출물에서 비밀값 패턴을 검사한다.
- 모든 테이블 RLS(`owner_id = auth.uid()`), 익명(anon) 권한 전부 회수. 상품/가격/이력 테이블은 로그인 사용자도 직접 쓰기 불가 — security definer RPC 만 허용.
- `service_role` 키는 GitHub Actions Secret, `GITHUB_DISPATCH_TOKEN` 은 Edge Function Secret 에만 둔다.
