# 식자재 가격 레이더 (Food Price Radar)

식봄·네이버·쿠팡 식자재 상품을 품목 탭별로 모아 **1kg당 실효 최저가(배송비 제외)** 로 비교하고, 예약/수동 갱신·수정값 고정·삭제 복구·가격 이력 그래프를 제공하는 웹앱입니다.

- 프론트엔드: Vite + React + TypeScript + Tailwind + Recharts → GitHub Pages(정적)
- DB/인증: Supabase PostgreSQL + Auth + RLS (`supabase/migrations`)
- 수집기: Python 3.12 (`crawler/`) → GitHub Actions (`.github/workflows/crawl.yml`, 5분 cron)
- 수동 갱신: Supabase Edge Function `request-refresh` → GitHub `workflow_dispatch`
- 제공처 조사 결과: [docs/source-feasibility.md](docs/source-feasibility.md) · 구조: [docs/architecture.md](docs/architecture.md)

> **제공처 현황(2026-10-27 확인)** — 식봄: 공개 검색/상세 페이지에서 자동 수집(키워드당 상위 8개, 쿠폰가는 조건 미확인 참고값). 네이버: 쇼핑 검색 API 종료·robots 차단으로 **연동 제한**. 쿠팡: 구매자용 API 없음·웹 403으로 **연동 제한**(파트너스 승인 키가 있으면 선택적으로 사용, 미검증). 연동 제한 제공처는 상품 수동 추가/CSV 가져오기로 관리합니다.

---

## 1. 로컬 실행

```bash
npm install
npm run dev            # http://localhost:5173
```

`.env.local` 이 없으면 첫 화면에서 **데모 모드**(명세의 가상 데이터, 이 브라우저에만 저장)로 둘러볼 수 있습니다. 실제 운영 데이터는 Supabase 에만 저장됩니다.

```bash
cp .env.example .env.local   # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY 입력
npm run dev
```

검증 명령:

```bash
npm run lint
npm run typecheck
npm test                 # 단가·중량·정렬·이력/그래프 집계·스케줄 (vitest)
npm run test:sql         # 마이그레이션을 PGlite 에 적용해 RLS·RPC·멱등성 시나리오 검증
npm run build

python -m venv .venv
.venv/Scripts/pip install -r crawler/requirements.txt   # macOS/Linux: .venv/bin/pip
.venv/Scripts/python -m pytest
.venv/Scripts/python -m crawler.main dry-run 깐마늘      # DB 없이 식봄 실수집 1회(정규화 결과 출력)
```

## 2. Supabase 설정

1. https://supabase.com 에서 프로젝트 생성 (Free 플랜 가능 — 7일 비활성 시 일시 중지될 수 있음).
2. 마이그레이션 적용:
   ```bash
   npx supabase login
   npx supabase link --project-ref <프로젝트 ref>
   npx supabase db push            # supabase/migrations/*.sql 적용
   ```
   (또는 대시보드 SQL Editor 에 `supabase/migrations/20261027000000_init.sql` 내용을 붙여 실행)
3. 관리자 계정: Authentication → Users → **Add user**(이메일/비밀번호). 그다음 Authentication → Sign In / Providers → Email 에서 **Allow new users to sign up 끄기** — 공개 URL 을 알아도 가입·열람할 수 없게 합니다.
4. RLS 확인: Table Editor 에서 모든 테이블에 `RLS enabled` 표시가 있는지, SQL Editor 에서 아래가 0 행인지 확인.
   ```sql
   select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
   ```
5. Settings → API 에서 `Project URL`, `anon public` 키(브라우저용), `service_role` 키(수집기용, 절대 공개 금지)를 확인.

## 3. Secrets 설정

GitHub 저장소(Settings → Secrets and variables → Actions):

```bash
gh secret set SUPABASE_URL --body "https://<ref>.supabase.co"
gh secret set SUPABASE_SERVICE_ROLE_KEY --body "<service_role key>"
gh variable set VITE_SUPABASE_URL --body "https://<ref>.supabase.co"      # 공개값 → variable
gh variable set VITE_SUPABASE_ANON_KEY --body "<anon key>"
# 선택: 승인된 쿠팡 파트너스 키가 있을 때만
gh secret set COUPANG_PARTNERS_ACCESS_KEY --body "..."
gh secret set COUPANG_PARTNERS_SECRET_KEY --body "..."
```

수동 갱신용 GitHub 토큰: GitHub → Settings → Developer settings → Fine-grained token → 이 저장소만, **Actions: Read and write** 권한만 부여.

Supabase Edge Function:

```bash
npx supabase functions deploy request-refresh
npx supabase secrets set GITHUB_OWNER=<owner> GITHUB_REPO=<repo> GITHUB_WORKFLOW_FILE=crawl.yml GITHUB_DISPATCH_TOKEN=<fine-grained token>
```

(`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` 는 Edge Function 런타임에 자동 주입됩니다.) 함수를 배포하지 않아도 앱은 동작하며, 이 경우 수동 갱신 요청은 큐에만 쌓였다가 다음 정기 실행(5분 간격)에서 처리됩니다.

## 4. GitHub Actions · Pages 배포

```bash
git init && git add . && git commit -m "Food Price Radar"
git branch -M main
git remote add origin https://github.com/<owner>/<repo>.git
git push -u origin main
```

1. Settings → Pages → Source: **GitHub Actions**.
2. `deploy.yml` 이 push 마다 린트·타입검사·TS/SQL/Python 테스트 → 빌드(`VITE_BASE_PATH=/<repo>/`) → 번들 비밀값 검사 → Pages 배포.
3. Actions 탭에서 `crawl` 워크플로가 활성화되어 있는지 확인(포크/비활성 저장소는 수동 활성화 필요).

**예약 실행의 한계**: GitHub Actions `schedule` 은 정시를 보장하지 않으며 부하 시 수 분~수십 분 지연되거나 누락될 수 있습니다. 앱은 예약 시각 이후 가능한 첫 실행에서 처리하고, 예약 시각·실제 시작 시각·지연을 수집 로그에 남깁니다. 또한 **공개 저장소에서 60일간 활동(커밋)이 없으면 예약 워크플로가 자동 비활성화**되므로 주기적으로 확인하세요.

## 5. 제공처 설정·수집 테스트

- 식봄: 별도 설정 불필요. `python -m crawler.main dry-run 깐마늘` 로 실수집 결과를 확인할 수 있습니다. 운영 전 식봄 이용약관을 직접 확인하세요.
- 네이버: 자동 수집 경로 없음 → 탭의 `+ 상품 추가`(제공처=네이버) 또는 `⋯ → CSV 가져오기`.
- 쿠팡: 기본은 네이버와 동일. 파트너스 승인 키를 Secret 으로 넣으면 다음 실행부터 `사용 가능`으로 바뀌고 수집합니다(약관 확인 필수, 미검증 경로).
- 앱 상단 `수집 로그`에서 제공처별 상태(사용 가능 / 인증 또는 권한 설정 필요 / 일시 오류 / 연동 제한)와 실행 기록을 확인합니다.

## 6. 사용 흐름

1. 로그인 → `+ 품목 추가` → 이름·검색어(예: 깐마늘, 통마늘, 마늘 1kg)·제공처·추적 URL 입력
2. `자동 갱신` → 매일/선택 요일/N시간 간격, 시각 여러 개(예: 08:30, 18:00) 설정
3. `이 탭 갱신`(또는 상단 `전체 갱신`) → 상태가 `대기 중 → 수집 중 → 성공/일부 실패/실패`로 바뀌며, 완료 시 표·그래프가 자동 갱신
4. 표: 기본 정렬은 가격/kg 낮은 순, 단가를 계산할 수 없는 상품은 맨 아래. 판매처·상태 필터, 상품명 검색, 원/100g 보기
5. 행의 `이력` → 상품별 시계열(정상가·할인가·쿠폰가·최저가·원/kg, 7일~전체, 표시 가격/수집 원본, 표 보기)
6. `가격 추이 비교` → 같은 탭 상품 2~10개 원/kg 비교(선택·기간은 DB 에 저장되어 다른 기기에서도 유지)
7. 연필 아이콘 → 필드별 수정, `수동 값 고정`(다음 수집에서 유지) / `자동 값으로 복원`
8. 휴지통 → 숨김(다음 수집에서 부활하지 않음), 설정 → `삭제한 항목 복구`

## 7. 오류 해결 · 백업/복원

| 증상 | 확인할 것 |
|---|---|
| 갱신 요청 후 계속 `대기 중` | Actions 탭에서 `crawl` 실행 여부, `SUPABASE_*` Secret, 워크플로 비활성화 여부 |
| 수집 로그에 `[blocked]`/`[robots]` | 제공처가 접근을 막음 — 우회하지 않습니다. 해당 제공처는 수동 등록 사용 |
| 수집 로그에 `[parse]` | 제공처 페이지 구조 변경. `crawler/adapters/foodspring.py` 갱신 필요, 이전 값은 유지됨 |
| 로그인 후 빈 화면/권한 오류 | 마이그레이션 적용 여부, anon key 가 같은 프로젝트인지 |
| 수동 갱신 비고에 `Actions 요청 실패` | `GITHUB_DISPATCH_TOKEN` 권한(Actions write)·만료, `GITHUB_OWNER/REPO` |

- **백업**: 설정 → `전체 백업 내려받기 (JSON)` (관리자 본인 데이터 전 테이블, 비밀값 없음). 탭별 `⋯ → 이 탭 CSV 내보내기`. DB 전체는 `npx supabase db dump --data-only > backup.sql`.
- **복원**: `psql "<connection string>" -f backup.sql`, 또는 CSV 가져오기로 상품을 수동 재등록.

## 폴더 구조

```text
src/            React 앱 (components, pages, lib/domain = 계산 규칙, lib/repo = Supabase/데모 저장소)
crawler/        Python 수집기 (adapters/, normalize, scheduler, reconcile, analytics, persistence, main)
supabase/       migrations/(SQL), functions/request-refresh/(Edge Function), tests/(PGlite 시나리오)
tests/          Python 테스트 + TS/Python 공유 벡터(vectors/) + 식봄 응답 픽스처(fixtures/)
docs/           제공처 조사, 아키텍처
```
