-- Food Price Radar — 초기 스키마
-- 원칙
--  * 가격은 KRW 정수, 중량·단가는 numeric. null(미확인)과 0 을 구분한다.
--  * 단가 = 최저 유효 상품가 / 총중량. 배송비는 절대 더하지 않는다.
--  * 가격 관측(price_observations)은 append-only. 실패한 수집은 기록하지 않는다(0원/가짜 점 금지).
--  * 모든 행은 owner_id = auth.uid() 기반 RLS. 상품/가격 쓰기는 security definer RPC 로만 한다.

-- gen_random_uuid()·md5() 는 Postgres 13+ 내장 함수만 사용 (확장 불필요)

-- ───────────────────────────── helpers ─────────────────────────────

create or replace function public.fpr_valid_times(p text[]) returns boolean
language sql immutable as $$
  select coalesce(bool_and(t ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'), true) from unnest(p) as t
$$;

create or replace function public.fpr_url_fingerprint(p_url text) returns text
language sql immutable as $$
  select md5(lower(regexp_replace(coalesce(p_url, ''), '[?#].*$', '')))
$$;

-- 최저 유효 상품가 (명세 5.2). src/lib/domain/pricing.ts · crawler/normalize.py 와 동일 규칙.
-- 쿠폰가는 coupon_eligible = true 일 때만 포함. 동률이면 정상가 → 할인가 → 쿠폰가.
create or replace function public.fpr_best_price(
  p_regular int, p_sale int, p_coupon int, p_coupon_eligible boolean,
  out price int, out kind text, out warnings text[]
) language plpgsql immutable as $$
begin
  price := null; kind := null; warnings := '{}';
  if p_regular is not null and p_regular >= 0 then price := p_regular; kind := 'regular'; end if;
  if p_sale is not null and p_sale >= 0 and (price is null or p_sale < price) then price := p_sale; kind := 'sale'; end if;
  if p_coupon is not null and p_coupon >= 0 then
    if p_coupon_eligible is true then
      if price is null or p_coupon < price then price := p_coupon; kind := 'coupon'; end if;
    else
      warnings := warnings || 'coupon_excluded'::text;
    end if;
  end if;
  if p_regular is not null and p_sale is not null and p_regular >= 0 and p_sale > p_regular then
    warnings := warnings || 'sale_gt_regular'::text;
  end if;
end $$;

create or replace function public.fpr_unit_price(p_price int, p_weight numeric) returns numeric
language sql immutable as $$
  select case when p_price is null or p_weight is null or p_weight <= 0 then null
              else round(p_price::numeric / p_weight, 2) end
$$;

create or replace function public.fpr_touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;

-- ───────────────────────────── tables ─────────────────────────────

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  sort_order int not null default 0,
  keywords text[] not null default '{}' check (cardinality(keywords) <= 20),
  enabled_sources text[] not null default '{foodspring}'
    check (enabled_sources <@ array['foodspring', 'naver', 'coupang']),
  -- 관리자가 등록한 상품 URL (식봄 상세 페이지 추적용)
  tracked_urls text[] not null default '{}' check (cardinality(tracked_urls) <= 50),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index categories_owner_name_uq on public.categories (owner_id, name) where deleted_at is null;
create index categories_owner_sort_idx on public.categories (owner_id, sort_order);
create trigger categories_touch before update on public.categories for each row execute function public.fpr_touch_updated_at();

create table public.category_schedules (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null unique references public.categories (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  timezone text not null default 'Asia/Seoul' check (timezone = 'Asia/Seoul'),
  frequency text not null default 'daily' check (frequency in ('daily', 'weekly', 'interval')),
  days_of_week smallint[] not null default '{}' check (days_of_week <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]),
  times_of_day text[] not null default '{}' check (public.fpr_valid_times(times_of_day) and cardinality(times_of_day) <= 12),
  interval_hours int check (interval_hours between 1 and 168),
  next_due_at timestamptz,
  last_enqueued_slot timestamptz,
  last_completed_slot timestamptz,
  updated_at timestamptz not null default now()
);
create trigger category_schedules_touch before update on public.category_schedules for each row execute function public.fpr_touch_updated_at();

create table public.refresh_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid references public.categories (id) on delete cascade, -- null = 전체 갱신
  reason text not null check (reason in ('manual_category', 'manual_all', 'schedule')),
  slot_key text unique, -- 예약 실행 중복 방지 'sched:<category>:<slot>'
  scheduled_for timestamptz,
  status text not null default 'queued' check (status in ('queued', 'running', 'success', 'partial', 'failed', 'cancelled')),
  requested_by uuid,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  locked_until timestamptz,
  locked_by text,
  attempt_count int not null default 0,
  error_summary text,
  dispatch_status text not null default 'pending' check (dispatch_status in ('pending', 'sent', 'failed', 'not_configured', 'scheduled')),
  dispatch_error text
);
create index refresh_jobs_status_idx on public.refresh_jobs (status, requested_at);
create index refresh_jobs_owner_idx on public.refresh_jobs (owner_id, requested_at desc);
-- 같은 탭(또는 전체)의 수동 요청은 대기열에 하나만
create unique index refresh_jobs_one_queued_manual on public.refresh_jobs
  (owner_id, coalesce(category_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'queued' and reason <> 'schedule';

create table public.crawl_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  refresh_job_id uuid references public.refresh_jobs (id) on delete set null,
  category_id uuid references public.categories (id) on delete cascade,
  source text not null check (source in ('foodspring', 'naver', 'coupang')),
  status text not null default 'running' check (status in ('running', 'success', 'partial', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  collected_count int not null default 0,
  changed_count int not null default 0,
  failed_count int not null default 0,
  error_detail text
);
create index crawl_runs_owner_idx on public.crawl_runs (owner_id, started_at desc);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  source text not null check (source in ('foodspring', 'naver', 'coupang', 'manual')),
  source_product_id text,
  source_option_id text,
  source_key text not null,          -- source_product_id, 없으면 'url:'||fingerprint, 수동은 'manual:'||id
  option_key text not null default '',
  url_fingerprint text not null,
  -- 아래 7개는 최종(effective) 값. 수집 원본은 raw_meta 에 보관
  source_url text not null,
  title text not null,
  seller text,
  product_option text,
  raw_weight_text text,
  weight_kg numeric(12, 6) check (weight_kg is null or weight_kg > 0),
  availability text not null default 'unknown' check (availability in ('in_stock', 'out_of_stock', 'unknown')),
  raw_meta jsonb not null default '{}',
  source_status text not null default 'ok' check (source_status in ('ok', 'stale', 'needs_review', 'manual')),
  extraction_status text not null default 'verified' check (extraction_status in ('verified', 'needs_review', 'unavailable')),
  review_notes text[] not null default '{}',
  parse_confidence numeric(3, 2),
  is_manual boolean not null default false,
  last_success_at timestamptz,
  last_seen_run_id uuid,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- 품목 탭 범위 내 자연키 (명세 9)
create unique index products_natural_key on public.products (category_id, source, source_key, option_key);
create index products_category_idx on public.products (category_id) where deleted_at is null;
create trigger products_touch before update on public.products for each row execute function public.fpr_touch_updated_at();

create table public.current_prices (
  product_id uuid primary key references public.products (id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  -- 수집 원본
  raw_regular_price_krw int check (raw_regular_price_krw >= 0),
  raw_sale_price_krw int check (raw_sale_price_krw >= 0),
  raw_coupon_price_krw int check (raw_coupon_price_krw >= 0),
  raw_coupon_eligible boolean,
  raw_coupon_conditions text,
  raw_shipping_status text not null default 'unknown' check (raw_shipping_status in ('free', 'paid', 'unknown')),
  raw_shipping_price_krw int check (raw_shipping_price_krw >= 0),
  raw_best_price_krw int,
  raw_unit_price_krw_per_kg numeric(14, 2),
  -- 최종(effective) 값
  regular_price_krw int check (regular_price_krw >= 0),
  sale_price_krw int check (sale_price_krw >= 0),
  coupon_price_krw int check (coupon_price_krw >= 0),
  coupon_eligible boolean,
  coupon_conditions text,
  shipping_status text not null default 'unknown' check (shipping_status in ('free', 'paid', 'unknown')),
  shipping_price_krw int check (shipping_price_krw >= 0),
  effective_price_krw int,
  effective_price_kind text check (effective_price_kind in ('regular', 'sale', 'coupon')),
  unit_price_krw_per_kg numeric(14, 2),
  price_warnings text[] not null default '{}',
  observed_at timestamptz,
  updated_at timestamptz not null default now()
);
create index current_prices_unit_idx on public.current_prices (owner_id, unit_price_krw_per_kg);

create table public.product_overrides (
  product_id uuid not null references public.products (id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  field_name text not null check (field_name in (
    'title', 'seller', 'product_option', 'source_url', 'raw_weight_text', 'weight_kg', 'availability',
    'regular_price_krw', 'sale_price_krw', 'coupon_price_krw', 'coupon_eligible', 'coupon_conditions',
    'shipping_status', 'shipping_price_krw')),
  override_value jsonb not null,  -- JSON null 은 "관리자가 값 없음(-)으로 확정"
  is_locked boolean not null default true,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (product_id, field_name)
);

create table public.price_observations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  run_id uuid references public.crawl_runs (id) on delete set null,
  observed_at timestamptz not null,
  origin text not null check (origin in ('crawl', 'manual_edit')),
  raw_regular_price_krw int,
  raw_sale_price_krw int,
  raw_coupon_price_krw int,
  raw_coupon_eligible boolean,
  regular_price_krw int,
  sale_price_krw int,
  coupon_price_krw int,
  coupon_eligible boolean,
  raw_weight_kg numeric(12, 6),
  effective_weight_kg numeric(12, 6),
  raw_best_price_krw int,
  raw_best_price_kind text,
  effective_best_price_krw int,
  effective_best_price_kind text,
  raw_unit_price_krw_per_kg numeric(14, 2),
  effective_unit_price_krw_per_kg numeric(14, 2),
  shipping_status text not null default 'unknown',
  shipping_price_krw int, -- 단가와 무관한 별도 값
  availability text not null default 'unknown',
  product_option text,
  source_product_id text,
  source_option_id text,
  extraction_status text,
  parse_confidence numeric(3, 2),
  idempotency_key text not null unique, -- 'crawl:<run>:<product>' | 'manual:<uuid>'
  created_at timestamptz not null default now()
);
create index price_observations_product_time on public.price_observations (product_id, observed_at desc, id);
create index price_observations_category_time on public.price_observations (category_id, observed_at);

create table public.change_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  observation_id uuid references public.price_observations (id) on delete cascade,
  event_type text not null check (event_type in (
    'price_down', 'price_up', 'coupon_changed', 'weight_changed', 'shipping_changed', 'out_of_stock', 'restocked', 'first_seen')),
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);
create index change_events_product_idx on public.change_events (product_id, created_at desc);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  owner_id uuid references auth.users(id) on delete cascade,
  actor_id uuid,
  entity_type text not null,
  entity_id text not null,
  action text not null,
  before_json jsonb,
  after_json jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_owner_idx on public.audit_logs (owner_id, created_at desc);

-- 삭제한 상품이 다음 수집에서 부활하지 않도록 (tombstone)
create table public.deleted_source_keys (
  owner_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  source text not null,
  source_key text not null,
  option_key text not null default '',
  source_product_id text,
  source_option_id text,
  url_fingerprint text,
  deleted_at timestamptz not null default now(),
  primary key (category_id, source, source_key, option_key)
);

create table public.category_chart_preferences (
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  selected_product_ids uuid[] not null default '{}' check (cardinality(selected_product_ids) <= 10),
  range text not null default '30d' check (range in ('7d', '30d', '90d', '1y', 'all')),
  series_visibility jsonb not null default '{}',
  carry_forward boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (owner_id, category_id)
);
create trigger chart_prefs_touch before update on public.category_chart_preferences for each row execute function public.fpr_touch_updated_at();

-- 제공처 연동 상태 (수집기가 매 실행 시 갱신). 계정 무관 전역 정보.
create table public.provider_status (
  source text primary key check (source in ('foodspring', 'naver', 'coupang')),
  state text not null check (state in ('available', 'needs_setup', 'temporary_error', 'restricted')),
  detail text not null default '',
  updated_at timestamptz not null default now()
);
insert into public.provider_status (source, state, detail) values
  ('foodspring', 'needs_setup', '수집기가 아직 실행되지 않았습니다.'),
  ('naver', 'restricted', '네이버 쇼핑 검색 Open API 종료(2026-07-31). 수동 등록·CSV 가져오기를 사용하세요.'),
  ('coupang', 'restricted', '구매자용 상품 데이터 공식 API 없음. 쿠팡 파트너스 승인 시 설정 가능. 수동 등록·CSV 가져오기를 사용하세요.');

-- ───────────────────────────── views ─────────────────────────────

create view public.product_rows with (security_invoker = true) as
select
  p.id, p.owner_id, p.category_id, p.source, p.source_product_id, p.source_option_id, p.is_manual,
  p.source_url, p.title, p.seller, p.product_option, p.raw_weight_text, p.weight_kg, p.availability,
  p.raw_meta, p.source_status, p.extraction_status, p.review_notes, p.last_success_at, p.deleted_at, p.updated_at,
  cp.raw_regular_price_krw, cp.raw_sale_price_krw, cp.raw_coupon_price_krw, cp.raw_coupon_eligible,
  cp.raw_coupon_conditions, cp.raw_shipping_status, cp.raw_shipping_price_krw,
  cp.regular_price_krw, cp.sale_price_krw, cp.coupon_price_krw, cp.coupon_eligible, cp.coupon_conditions,
  cp.shipping_status, cp.shipping_price_krw, cp.effective_price_krw, cp.effective_price_kind,
  cp.unit_price_krw_per_kg, cp.price_warnings, cp.observed_at,
  coalesce((
    select jsonb_object_agg(o.field_name, jsonb_build_object('value', o.override_value, 'is_locked', o.is_locked, 'updated_at', o.updated_at))
    from public.product_overrides o where o.product_id = p.id
  ), '{}'::jsonb) as overrides
from public.products p
left join public.current_prices cp on cp.product_id = p.id;

create view public.category_overview with (security_invoker = true) as
select
  c.*,
  (select max(j.finished_at) from public.refresh_jobs j
    where j.owner_id = c.owner_id and (j.category_id = c.id or j.category_id is null)
      and j.status in ('success', 'partial')) as last_success_at,
  lj.status as last_job_status,
  lj.requested_at as last_job_requested_at
from public.categories c
left join lateral (
  select j.status, j.requested_at from public.refresh_jobs j
  where j.owner_id = c.owner_id and (j.category_id = c.id or j.category_id is null)
  order by j.requested_at desc limit 1
) lj on true;

-- ───────────────────────────── core functions ─────────────────────────────

-- raw + override → effective 재계산 (단일 진실 공급원)
create or replace function public.fpr_apply_effective(p_product_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  ov jsonb;
  p public.products;
  cp public.current_prices;
  m jsonb;
  v_reg int; v_sale int; v_coupon int; v_elig boolean; v_weight numeric;
  bp record; rbp record;
begin
  select * into p from public.products where id = p_product_id;
  select * into cp from public.current_prices where product_id = p_product_id;
  select coalesce(jsonb_object_agg(field_name, override_value), '{}'::jsonb) into ov
    from public.product_overrides where product_id = p_product_id;
  m := p.raw_meta;

  v_weight := case when ov ? 'weight_kg' then (ov->>'weight_kg')::numeric else (m->>'weight_kg')::numeric end;
  update public.products set
    title = coalesce(case when ov ? 'title' then ov->>'title' else m->>'title' end, title),
    seller = case when ov ? 'seller' then ov->>'seller' else m->>'seller' end,
    product_option = case when ov ? 'product_option' then ov->>'product_option' else m->>'product_option' end,
    source_url = coalesce(case when ov ? 'source_url' then ov->>'source_url' else m->>'source_url' end, source_url),
    raw_weight_text = case when ov ? 'raw_weight_text' then ov->>'raw_weight_text' else m->>'raw_weight_text' end,
    weight_kg = v_weight,
    availability = coalesce(case when ov ? 'availability' then ov->>'availability' else m->>'availability' end, 'unknown')
  where id = p_product_id;

  v_reg := case when ov ? 'regular_price_krw' then (ov->>'regular_price_krw')::int else cp.raw_regular_price_krw end;
  v_sale := case when ov ? 'sale_price_krw' then (ov->>'sale_price_krw')::int else cp.raw_sale_price_krw end;
  v_coupon := case when ov ? 'coupon_price_krw' then (ov->>'coupon_price_krw')::int else cp.raw_coupon_price_krw end;
  v_elig := case when ov ? 'coupon_eligible' then (ov->>'coupon_eligible')::boolean else cp.raw_coupon_eligible end;
  bp := public.fpr_best_price(v_reg, v_sale, v_coupon, v_elig);
  rbp := public.fpr_best_price(cp.raw_regular_price_krw, cp.raw_sale_price_krw, cp.raw_coupon_price_krw, cp.raw_coupon_eligible);

  update public.current_prices set
    regular_price_krw = v_reg,
    sale_price_krw = v_sale,
    coupon_price_krw = v_coupon,
    coupon_eligible = v_elig,
    coupon_conditions = case when ov ? 'coupon_conditions' then ov->>'coupon_conditions' else cp.raw_coupon_conditions end,
    shipping_status = coalesce(case when ov ? 'shipping_status' then ov->>'shipping_status' else cp.raw_shipping_status end, 'unknown'),
    shipping_price_krw = case when ov ? 'shipping_price_krw' then (ov->>'shipping_price_krw')::int else cp.raw_shipping_price_krw end,
    raw_best_price_krw = rbp.price,
    raw_unit_price_krw_per_kg = public.fpr_unit_price(rbp.price, (m->>'weight_kg')::numeric),
    effective_price_krw = bp.price,
    effective_price_kind = bp.kind,
    unit_price_krw_per_kg = public.fpr_unit_price(bp.price, v_weight),
    price_warnings = bp.warnings,
    updated_at = now()
  where product_id = p_product_id;
end $$;

-- 현재 상태를 관측 이력에 append + 변경 이벤트 생성. 중복 키면 null.
create or replace function public.fpr_append_observation(
  p_product_id uuid, p_run_id uuid, p_origin text, p_key text, p_observed_at timestamptz
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  p public.products;
  cp public.current_prices;
  prev public.price_observations;
  v_id uuid;
begin
  select * into p from public.products where id = p_product_id;
  select * into cp from public.current_prices where product_id = p_product_id;
  select * into prev from public.price_observations
    where product_id = p_product_id order by observed_at desc, id desc limit 1;

  insert into public.price_observations (
    owner_id, product_id, category_id, run_id, observed_at, origin,
    raw_regular_price_krw, raw_sale_price_krw, raw_coupon_price_krw, raw_coupon_eligible,
    regular_price_krw, sale_price_krw, coupon_price_krw, coupon_eligible,
    raw_weight_kg, effective_weight_kg,
    raw_best_price_krw, raw_best_price_kind, effective_best_price_krw, effective_best_price_kind,
    raw_unit_price_krw_per_kg, effective_unit_price_krw_per_kg,
    shipping_status, shipping_price_krw, availability, product_option,
    source_product_id, source_option_id, extraction_status, parse_confidence, idempotency_key
  ) values (
    p.owner_id, p.id, p.category_id, p_run_id, p_observed_at, p_origin,
    cp.raw_regular_price_krw, cp.raw_sale_price_krw, cp.raw_coupon_price_krw, cp.raw_coupon_eligible,
    cp.regular_price_krw, cp.sale_price_krw, cp.coupon_price_krw, cp.coupon_eligible,
    (p.raw_meta->>'weight_kg')::numeric, p.weight_kg,
    cp.raw_best_price_krw, (public.fpr_best_price(cp.raw_regular_price_krw, cp.raw_sale_price_krw, cp.raw_coupon_price_krw, cp.raw_coupon_eligible)).kind,
    cp.effective_price_krw, cp.effective_price_kind,
    cp.raw_unit_price_krw_per_kg, cp.unit_price_krw_per_kg,
    cp.shipping_status, cp.shipping_price_krw, p.availability, p.product_option,
    p.source_product_id, p.source_option_id, p.extraction_status, p.parse_confidence, p_key
  )
  on conflict (idempotency_key) do nothing
  returning id into v_id;

  if v_id is null then return null; end if;

  if prev.id is null then
    insert into public.change_events (owner_id, product_id, observation_id, event_type, new_value)
      values (p.owner_id, p.id, v_id, 'first_seen', to_jsonb(cp.effective_price_krw));
    return v_id;
  end if;

  if cp.effective_price_krw is not null and prev.effective_best_price_krw is not null
     and cp.effective_price_krw <> prev.effective_best_price_krw then
    insert into public.change_events (owner_id, product_id, observation_id, event_type, old_value, new_value)
      values (p.owner_id, p.id, v_id,
              case when cp.effective_price_krw < prev.effective_best_price_krw then 'price_down' else 'price_up' end,
              to_jsonb(prev.effective_best_price_krw), to_jsonb(cp.effective_price_krw));
  end if;
  if cp.coupon_price_krw is distinct from prev.coupon_price_krw or cp.coupon_eligible is distinct from prev.coupon_eligible then
    insert into public.change_events (owner_id, product_id, observation_id, event_type, old_value, new_value)
      values (p.owner_id, p.id, v_id, 'coupon_changed',
              jsonb_build_object('price', prev.coupon_price_krw, 'eligible', prev.coupon_eligible),
              jsonb_build_object('price', cp.coupon_price_krw, 'eligible', cp.coupon_eligible));
  end if;
  if p.weight_kg is distinct from prev.effective_weight_kg then
    insert into public.change_events (owner_id, product_id, observation_id, event_type, old_value, new_value)
      values (p.owner_id, p.id, v_id, 'weight_changed', to_jsonb(prev.effective_weight_kg), to_jsonb(p.weight_kg));
  end if;
  if cp.shipping_status is distinct from prev.shipping_status or cp.shipping_price_krw is distinct from prev.shipping_price_krw then
    insert into public.change_events (owner_id, product_id, observation_id, event_type, old_value, new_value)
      values (p.owner_id, p.id, v_id, 'shipping_changed',
              jsonb_build_object('status', prev.shipping_status, 'price', prev.shipping_price_krw),
              jsonb_build_object('status', cp.shipping_status, 'price', cp.shipping_price_krw));
  end if;
  if p.availability = 'out_of_stock' and prev.availability <> 'out_of_stock' then
    insert into public.change_events (owner_id, product_id, observation_id, event_type) values (p.owner_id, p.id, v_id, 'out_of_stock');
  elsif p.availability = 'in_stock' and prev.availability = 'out_of_stock' then
    insert into public.change_events (owner_id, product_id, observation_id, event_type) values (p.owner_id, p.id, v_id, 'restocked');
  end if;
  return v_id;
end $$;

-- raw 값 기록 (수집기 / 수동 상품 공용)
create or replace function public.fpr_write_raw(p_product_id uuid, p_values jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  meta_keys text[] := array['title', 'seller', 'product_option', 'source_url', 'raw_weight_text', 'weight_kg', 'availability'];
  meta jsonb;
begin
  select coalesce(jsonb_object_agg(k, p_values->k), '{}'::jsonb) into meta
    from unnest(meta_keys) k where p_values ? k;
  update public.products set raw_meta = raw_meta || meta where id = p_product_id;
  insert into public.current_prices (product_id, owner_id)
    select id, owner_id from public.products where id = p_product_id
    on conflict (product_id) do nothing;
  update public.current_prices cp set
    raw_regular_price_krw = case when p_values ? 'regular_price_krw' then (p_values->>'regular_price_krw')::int else cp.raw_regular_price_krw end,
    raw_sale_price_krw = case when p_values ? 'sale_price_krw' then (p_values->>'sale_price_krw')::int else cp.raw_sale_price_krw end,
    raw_coupon_price_krw = case when p_values ? 'coupon_price_krw' then (p_values->>'coupon_price_krw')::int else cp.raw_coupon_price_krw end,
    raw_coupon_eligible = case when p_values ? 'coupon_eligible' then (p_values->>'coupon_eligible')::boolean else cp.raw_coupon_eligible end,
    raw_coupon_conditions = case when p_values ? 'coupon_conditions' then p_values->>'coupon_conditions' else cp.raw_coupon_conditions end,
    raw_shipping_status = case when p_values ? 'shipping_status' then coalesce(p_values->>'shipping_status', 'unknown') else cp.raw_shipping_status end,
    raw_shipping_price_krw = case when p_values ? 'shipping_price_krw' then (p_values->>'shipping_price_krw')::int else cp.raw_shipping_price_krw end
  where cp.product_id = p_product_id;
end $$;

create or replace function public.fpr_product_json(p_product_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(r) - 'raw_meta' from public.product_rows r where r.id = p_product_id
$$;

create or replace function public.fpr_require_user() returns uuid
language plpgsql stable as $$
declare v uuid := auth.uid();
begin
  if v is null then raise exception 'authentication required' using errcode = '42501'; end if;
  return v;
end $$;

-- ───────────────────────────── 수집기 전용 RPC (service_role) ─────────────────────────────

-- 정규화된 ListingObservation 1건을 원자적으로 반영:
-- tombstone 확인 → 상품 upsert → raw 갱신 → 고정 안 된 override 제거 → effective 재계산 → 관측 append → 변경 이벤트
create or replace function public.fpr_ingest_listing(p_run_id uuid, p_category_id uuid, p_obs jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c public.categories;
  v_source text := p_obs->>'source';
  v_url text := p_obs->>'source_url';
  v_fp text := public.fpr_url_fingerprint(p_obs->>'source_url');
  v_key text := coalesce(nullif(p_obs->>'source_product_id', ''), 'url:' || public.fpr_url_fingerprint(p_obs->>'source_url'));
  v_opt text := coalesce(p_obs->>'source_option_id', '');
  v_observed timestamptz := coalesce((p_obs->>'observed_at')::timestamptz, now());
  v_extraction text := coalesce(p_obs->>'extraction_status', 'verified');
  v_pid uuid;
  v_deleted timestamptz;
  v_obs_id uuid;
  v_changed int;
begin
  if v_source not in ('foodspring', 'naver', 'coupang') then raise exception 'invalid source %', v_source; end if;
  if v_extraction = 'unavailable' then return jsonb_build_object('status', 'skipped_unavailable'); end if;
  select * into c from public.categories where id = p_category_id;
  if c.id is null or c.deleted_at is not null then return jsonb_build_object('status', 'skipped_category'); end if;

  if exists (select 1 from public.deleted_source_keys d
             where d.category_id = p_category_id and d.source = v_source and d.source_key = v_key and d.option_key = v_opt) then
    return jsonb_build_object('status', 'blocked');
  end if;
  select id, deleted_at into v_pid, v_deleted from public.products
    where category_id = p_category_id and source = v_source and source_key = v_key and option_key = v_opt;
  if v_deleted is not null then return jsonb_build_object('status', 'blocked', 'product_id', v_pid); end if;

  if v_pid is null then
    insert into public.products (owner_id, category_id, source, source_product_id, source_option_id, source_key, option_key,
                                 url_fingerprint, source_url, title, source_status, extraction_status)
    values (c.owner_id, p_category_id, v_source, nullif(p_obs->>'source_product_id', ''), nullif(p_obs->>'source_option_id', ''),
            v_key, v_opt, v_fp, v_url, coalesce(p_obs->>'title', '(상품명 없음)'), 'ok', v_extraction)
    returning id into v_pid;
  end if;

  perform public.fpr_write_raw(v_pid, p_obs);
  delete from public.product_overrides where product_id = v_pid and not is_locked;
  update public.products set
    url_fingerprint = v_fp,
    last_seen_run_id = p_run_id,
    last_success_at = v_observed,
    extraction_status = v_extraction,
    source_status = case when v_extraction = 'needs_review' then 'needs_review' else 'ok' end,
    review_notes = coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_obs->'review_notes', '[]'::jsonb)) x), '{}'),
    parse_confidence = (p_obs->>'parse_confidence')::numeric
  where id = v_pid;
  perform public.fpr_apply_effective(v_pid);
  update public.current_prices set observed_at = v_observed where product_id = v_pid;

  v_obs_id := public.fpr_append_observation(v_pid, p_run_id, 'crawl', 'crawl:' || p_run_id || ':' || v_pid, v_observed);
  if v_obs_id is null then return jsonb_build_object('status', 'duplicate', 'product_id', v_pid); end if;
  select count(*) into v_changed from public.change_events
    where observation_id = v_obs_id and event_type not in ('first_seen');
  return jsonb_build_object('status', case when v_changed > 0 then 'changed' else 'unchanged' end,
                            'product_id', v_pid, 'observation_id', v_obs_id);
end $$;

-- 제공처 수집 실패: 값은 유지하고 상태만 stale 로 (0원/삭제 처리 금지)
create or replace function public.fpr_mark_source_stale(p_category_id uuid, p_source text) returns int
language sql security definer set search_path = public as $$
  with u as (
    update public.products set source_status = 'stale'
    where category_id = p_category_id and source = p_source and not is_manual and deleted_at is null
    returning 1)
  select count(*)::int from u
$$;

-- 작업 큐에서 처리할 작업을 잠금과 함께 가져온다 (락 만료 시 재시도, 최대 3회)
create or replace function public.fpr_claim_jobs(p_worker text, p_limit int default 20, p_lock_minutes int default 30)
returns setof public.refresh_jobs
language plpgsql security definer set search_path = public as $$
begin
  update public.refresh_jobs set status = 'failed', finished_at = now(), locked_until = null,
         error_summary = coalesce(error_summary || ' / ', '') || '재시도 한도 초과(락 만료)'
    where status = 'running' and locked_until < now() and attempt_count >= 3;
  return query
  with c as (
    select id from public.refresh_jobs
    where (status = 'queued' or (status = 'running' and locked_until < now())) and attempt_count < 3
    order by requested_at
    for update skip locked
    limit p_limit
  )
  update public.refresh_jobs j set
    status = 'running', started_at = coalesce(j.started_at, now()),
    locked_until = now() + make_interval(mins => p_lock_minutes), locked_by = p_worker,
    attempt_count = j.attempt_count + 1
  from c where j.id = c.id
  returning j.*;
end $$;

create or replace function public.fpr_finish_job(p_job_id uuid, p_status text, p_error text default null) returns void
language plpgsql security definer set search_path = public as $$
declare j public.refresh_jobs;
begin
  if p_status not in ('success', 'partial', 'failed') then raise exception 'invalid status %', p_status; end if;
  update public.refresh_jobs set status = p_status, finished_at = now(), locked_until = null, error_summary = p_error
    where id = p_job_id returning * into j;
  if j.reason = 'schedule' and j.category_id is not null and j.scheduled_for is not null then
    update public.category_schedules set last_completed_slot = greatest(coalesce(last_completed_slot, j.scheduled_for), j.scheduled_for)
      where category_id = j.category_id;
  end if;
end $$;

-- 예약 슬롯을 큐에 넣는다. 같은 slot_key 는 한 번만 (중복 실행 방지)
create or replace function public.fpr_enqueue_scheduled(p_category_id uuid, p_slot timestamptz, p_next_due timestamptz) returns uuid
language plpgsql security definer set search_path = public as $$
declare c public.categories; v_id uuid;
begin
  select * into c from public.categories where id = p_category_id and deleted_at is null;
  if c.id is null then return null; end if;
  insert into public.refresh_jobs (owner_id, category_id, reason, slot_key, scheduled_for, dispatch_status)
    values (c.owner_id, c.id, 'schedule', 'sched:' || c.id || ':' || to_char(p_slot at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'), p_slot, 'scheduled')
    on conflict (slot_key) do nothing
    returning id into v_id;
  update public.category_schedules set last_enqueued_slot = greatest(coalesce(last_enqueued_slot, p_slot), p_slot), next_due_at = p_next_due
    where category_id = p_category_id;
  return v_id;
end $$;

-- ───────────────────────────── 관리자(로그인 사용자) RPC ─────────────────────────────

create or replace function public.fpr_enqueue_refresh(p_category_id uuid default null) returns public.refresh_jobs
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.fpr_require_user(); j public.refresh_jobs;
begin
  if p_category_id is not null and not exists (
    select 1 from public.categories where id = p_category_id and owner_id = v_uid and deleted_at is null) then
    raise exception 'category not found' using errcode = '42501';
  end if;
  select * into j from public.refresh_jobs
    where owner_id = v_uid and category_id is not distinct from p_category_id and status = 'queued' and reason <> 'schedule';
  if j.id is not null then return j; end if;
  insert into public.refresh_jobs (owner_id, category_id, reason, requested_by)
    values (v_uid, p_category_id, case when p_category_id is null then 'manual_all' else 'manual_category' end, v_uid)
    returning * into j;
  return j;
end $$;

create or replace function public.fpr_add_manual_product(p_category_id uuid, p_source text, p_values jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.fpr_require_user(); v_id uuid := gen_random_uuid();
begin
  if not exists (select 1 from public.categories where id = p_category_id and owner_id = v_uid and deleted_at is null) then
    raise exception 'category not found' using errcode = '42501';
  end if;
  if p_source not in ('foodspring', 'naver', 'coupang', 'manual') then raise exception 'invalid source'; end if;
  if coalesce(btrim(p_values->>'title'), '') = '' or coalesce(btrim(p_values->>'source_url'), '') = '' then
    raise exception '상품명과 URL 은 필수입니다';
  end if;
  insert into public.products (id, owner_id, category_id, source, source_key, url_fingerprint, source_url, title,
                               is_manual, source_status, extraction_status, last_success_at)
    values (v_id, v_uid, p_category_id, p_source, 'manual:' || v_id, public.fpr_url_fingerprint(p_values->>'source_url'),
            p_values->>'source_url', p_values->>'title', true, 'manual', 'verified', now());
  perform public.fpr_write_raw(v_id, p_values);
  perform public.fpr_apply_effective(v_id);
  update public.current_prices set observed_at = now() where product_id = v_id;
  perform public.fpr_append_observation(v_id, null, 'manual_edit', 'manual:' || gen_random_uuid(), now());
  insert into public.audit_logs (owner_id, actor_id, entity_type, entity_id, action, after_json)
    values (v_uid, v_uid, 'product', v_id::text, 'create_manual', public.fpr_product_json(v_id));
  return v_id;
end $$;

-- p_changes: {"<field>": {"value": <json>, "locked": true|false}}, p_revert: 자동 값으로 복원할 필드
create or replace function public.fpr_save_product_edit(p_product_id uuid, p_changes jsonb, p_revert text[] default '{}')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.fpr_require_user();
  p public.products;
  v_before jsonb;
  k text;
  allowed text[] := array['title', 'seller', 'product_option', 'source_url', 'raw_weight_text', 'weight_kg', 'availability',
    'regular_price_krw', 'sale_price_krw', 'coupon_price_krw', 'coupon_eligible', 'coupon_conditions',
    'shipping_status', 'shipping_price_krw'];
  v_raw jsonb := '{}'::jsonb;
begin
  select * into p from public.products where id = p_product_id and owner_id = v_uid for update;
  if p.id is null then raise exception 'product not found' using errcode = '42501'; end if;
  v_before := public.fpr_product_json(p_product_id);

  for k in select jsonb_object_keys(coalesce(p_changes, '{}'::jsonb)) loop
    if not (k = any (allowed)) then raise exception 'invalid field %', k; end if;
    if p.is_manual then
      v_raw := v_raw || jsonb_build_object(k, p_changes->k->'value');
    else
      insert into public.product_overrides (product_id, owner_id, field_name, override_value, is_locked, updated_by)
        values (p.id, v_uid, k, coalesce(p_changes->k->'value', 'null'::jsonb), coalesce((p_changes->k->>'locked')::boolean, true), v_uid)
        on conflict (product_id, field_name) do update set
          override_value = excluded.override_value, is_locked = excluded.is_locked,
          updated_by = excluded.updated_by, updated_at = now();
    end if;
  end loop;
  if p.is_manual and v_raw <> '{}'::jsonb then perform public.fpr_write_raw(p.id, v_raw); end if;
  if cardinality(p_revert) > 0 then
    delete from public.product_overrides where product_id = p.id and field_name = any (p_revert);
  end if;

  perform public.fpr_apply_effective(p.id);
  update public.current_prices set observed_at = now() where product_id = p.id;
  perform public.fpr_append_observation(p.id, null, 'manual_edit', 'manual:' || gen_random_uuid(), now());
  insert into public.audit_logs (owner_id, actor_id, entity_type, entity_id, action, before_json, after_json)
    values (v_uid, v_uid, 'product', p.id::text, 'edit', v_before, public.fpr_product_json(p.id));
  return public.fpr_product_json(p.id);
end $$;

create or replace function public.fpr_delete_product(p_product_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.fpr_require_user(); p public.products;
begin
  select * into p from public.products where id = p_product_id and owner_id = v_uid for update;
  if p.id is null then raise exception 'product not found' using errcode = '42501'; end if;
  update public.products set deleted_at = now() where id = p.id;
  if not p.is_manual then
    insert into public.deleted_source_keys (owner_id, category_id, source, source_key, option_key, source_product_id, source_option_id, url_fingerprint)
      values (p.owner_id, p.category_id, p.source, p.source_key, p.option_key, p.source_product_id, p.source_option_id, p.url_fingerprint)
      on conflict do nothing;
  end if;
  insert into public.audit_logs (owner_id, actor_id, entity_type, entity_id, action, before_json)
    values (v_uid, v_uid, 'product', p.id::text, 'delete', public.fpr_product_json(p.id));
end $$;

create or replace function public.fpr_restore_product(p_product_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.fpr_require_user(); p public.products;
begin
  select * into p from public.products where id = p_product_id and owner_id = v_uid for update;
  if p.id is null then raise exception 'product not found' using errcode = '42501'; end if;
  update public.products set deleted_at = null where id = p.id;
  delete from public.deleted_source_keys
    where category_id = p.category_id and source = p.source and source_key = p.source_key and option_key = p.option_key;
  insert into public.audit_logs (owner_id, actor_id, entity_type, entity_id, action, after_json)
    values (v_uid, v_uid, 'product', p.id::text, 'restore', public.fpr_product_json(p.id));
end $$;

create or replace function public.fpr_reorder_categories(p_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.fpr_require_user(); i int;
begin
  for i in 1 .. coalesce(array_length(p_ids, 1), 0) loop
    update public.categories set sort_order = i where id = p_ids[i] and owner_id = v_uid;
  end loop;
end $$;

-- 탭 삭제: 소프트 삭제 + 예약 해제. 이력 삭제는 p_purge_history = true 로 명시해야만.
create or replace function public.fpr_delete_category(p_category_id uuid, p_purge_history boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.fpr_require_user(); c public.categories;
begin
  select * into c from public.categories where id = p_category_id and owner_id = v_uid for update;
  if c.id is null then raise exception 'category not found' using errcode = '42501'; end if;
  update public.categories set deleted_at = now() where id = c.id;
  update public.category_schedules set enabled = false where category_id = c.id;
  update public.refresh_jobs set status = 'cancelled', finished_at = now() where category_id = c.id and status = 'queued';
  if p_purge_history then
    delete from public.price_observations where category_id = c.id;
  end if;
  insert into public.audit_logs (owner_id, actor_id, entity_type, entity_id, action, before_json, after_json)
    values (v_uid, v_uid, 'category', c.id::text, case when p_purge_history then 'delete_purge_history' else 'delete' end,
            to_jsonb(c), jsonb_build_object('purge_history', p_purge_history));
end $$;

create or replace function public.fpr_restore_category(p_category_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.fpr_require_user();
begin
  update public.categories set deleted_at = null where id = p_category_id and owner_id = v_uid;
  if not found then raise exception 'category not found' using errcode = '42501'; end if;
  insert into public.audit_logs (owner_id, actor_id, entity_type, entity_id, action)
    values (v_uid, v_uid, 'category', p_category_id::text, 'restore');
end $$;

-- ───────────────────────────── triggers ─────────────────────────────

create or replace function public.fpr_category_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.category_schedules (category_id, owner_id) values (new.id, new.owner_id) on conflict do nothing;
  return new;
end $$;
create trigger categories_after_insert after insert on public.categories for each row execute function public.fpr_category_after_insert();

create or replace function public.fpr_audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_logs (owner_id, actor_id, entity_type, entity_id, action, before_json, after_json)
  values (coalesce(new.owner_id, old.owner_id), auth.uid(), tg_table_name, coalesce(new.id, old.id)::text, lower(tg_op),
          case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;
create trigger categories_audit after insert or update on public.categories for each row execute function public.fpr_audit_row();
create trigger category_schedules_audit after update on public.category_schedules for each row execute function public.fpr_audit_row();

-- ───────────────────────────── RLS ─────────────────────────────

alter table public.categories enable row level security;
alter table public.category_schedules enable row level security;
alter table public.refresh_jobs enable row level security;
alter table public.crawl_runs enable row level security;
alter table public.products enable row level security;
alter table public.current_prices enable row level security;
alter table public.product_overrides enable row level security;
alter table public.price_observations enable row level security;
alter table public.change_events enable row level security;
alter table public.audit_logs enable row level security;
alter table public.deleted_source_keys enable row level security;
alter table public.category_chart_preferences enable row level security;
alter table public.provider_status enable row level security;

create policy categories_select on public.categories for select to authenticated using (owner_id = auth.uid());
create policy categories_insert on public.categories for insert to authenticated with check (owner_id = auth.uid());
create policy categories_update on public.categories for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy schedules_select on public.category_schedules for select to authenticated using (owner_id = auth.uid());
create policy schedules_update on public.category_schedules for update to authenticated using (owner_id = auth.uid()) with check (
  owner_id = auth.uid() and exists (select 1 from public.categories c where c.id = category_id and c.owner_id = auth.uid()));

create policy chart_prefs_all on public.category_chart_preferences for all to authenticated using (owner_id = auth.uid()) with check (
  owner_id = auth.uid() and exists (select 1 from public.categories c where c.id = category_id and c.owner_id = auth.uid()));

-- 아래 테이블은 읽기만 허용. 쓰기는 security definer RPC 또는 service_role(수집기) 전용.
create policy products_select on public.products for select to authenticated using (owner_id = auth.uid());
create policy current_prices_select on public.current_prices for select to authenticated using (owner_id = auth.uid());
create policy overrides_select on public.product_overrides for select to authenticated using (owner_id = auth.uid());
create policy observations_select on public.price_observations for select to authenticated using (owner_id = auth.uid());
create policy change_events_select on public.change_events for select to authenticated using (owner_id = auth.uid());
create policy refresh_jobs_select on public.refresh_jobs for select to authenticated using (owner_id = auth.uid());
create policy crawl_runs_select on public.crawl_runs for select to authenticated using (owner_id = auth.uid());
create policy audit_logs_select on public.audit_logs for select to authenticated using (owner_id = auth.uid());
create policy deleted_keys_select on public.deleted_source_keys for select to authenticated using (owner_id = auth.uid());
create policy provider_status_select on public.provider_status for select to authenticated using (true);

-- ───────────────────────────── grants ─────────────────────────────
-- 익명(anon)은 아무것도 읽거나 쓸 수 없다.

revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from public, anon;

grant select on all tables in schema public to authenticated;
grant insert, update on public.categories to authenticated;
grant update on public.category_schedules to authenticated;
grant insert, update, delete on public.category_chart_preferences to authenticated;
grant all on all tables in schema public to service_role;

grant execute on function
  public.fpr_enqueue_refresh(uuid),
  public.fpr_add_manual_product(uuid, text, jsonb),
  public.fpr_save_product_edit(uuid, jsonb, text[]),
  public.fpr_delete_product(uuid),
  public.fpr_restore_product(uuid),
  public.fpr_reorder_categories(uuid[]),
  public.fpr_delete_category(uuid, boolean),
  public.fpr_restore_category(uuid),
  public.fpr_valid_times(text[]),
  public.fpr_best_price(int, int, int, boolean),
  public.fpr_unit_price(int, numeric),
  public.fpr_url_fingerprint(text),
  public.fpr_require_user()
to authenticated;

grant execute on all functions in schema public to service_role;
