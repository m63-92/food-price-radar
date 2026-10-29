-- 고객 피드백 v2
--  Q1  품목별 제외 키워드 (수집 시 제외 + 화면 숨김)
--  Q4~6 주문 가능/불가(사유), 주문 마감 시각, 예상 배송
--  Q9  배송비 무료 기준 금액
--  Q12 품목별 단가 기준(kg / 개수) · 개수 열 (계란: 원/알, 배추: 중량·개수 분리)

-- ───────── categories ─────────
alter table public.categories
  add column exclude_keywords text[] not null default '{}' check (cardinality(exclude_keywords) <= 30),
  add column unit_basis text not null default 'kg' check (unit_basis in ('kg', 'piece')),
  add column piece_label text not null default '개' check (char_length(piece_label) between 1 and 4),
  add column show_piece_count boolean not null default false;

-- ───────── products ─────────
alter table public.products
  add column piece_count numeric(10, 2) check (piece_count is null or piece_count > 0),
  add column piece_label text,
  add column order_status text not null default 'unknown'
    check (order_status in ('orderable', 'discontinued', 'sold_out', 'closed', 'unknown')),
  add column order_status_reason text,
  add column order_cutoff text check (order_cutoff is null or order_cutoff ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  add column delivery_lead_days int check (delivery_lead_days is null or delivery_lead_days between 0 and 30),
  add column delivery_note text;

alter table public.current_prices
  add column shipping_free_threshold_krw int check (shipping_free_threshold_krw >= 0),
  add column raw_unit_price_krw_per_piece numeric(14, 2),
  add column unit_price_krw_per_piece numeric(14, 2);

alter table public.price_observations
  add column raw_piece_count numeric(10, 2),
  add column effective_piece_count numeric(10, 2),
  add column raw_unit_price_krw_per_piece numeric(14, 2),
  add column effective_unit_price_krw_per_piece numeric(14, 2),
  add column order_status text;

alter table public.product_overrides drop constraint product_overrides_field_name_check;
alter table public.product_overrides add constraint product_overrides_field_name_check check (field_name in (
  'title', 'seller', 'product_option', 'source_url', 'raw_weight_text', 'weight_kg', 'availability', 'piece_count',
  'regular_price_krw', 'sale_price_krw', 'coupon_price_krw', 'coupon_eligible', 'coupon_conditions',
  'shipping_status', 'shipping_price_krw'));

-- ───────── views (새 컬럼 포함하도록 재생성) ─────────
drop view public.product_rows;
create view public.product_rows with (security_invoker = true) as
select
  p.id, p.owner_id, p.category_id, p.source, p.source_product_id, p.source_option_id, p.is_manual,
  p.source_url, p.title, p.seller, p.product_option, p.raw_weight_text, p.weight_kg, p.piece_count, p.piece_label,
  p.availability, p.order_status, p.order_status_reason, p.order_cutoff, p.delivery_lead_days, p.delivery_note,
  p.raw_meta, p.source_status, p.extraction_status, p.review_notes, p.last_success_at, p.deleted_at, p.updated_at,
  cp.raw_regular_price_krw, cp.raw_sale_price_krw, cp.raw_coupon_price_krw, cp.raw_coupon_eligible,
  cp.raw_coupon_conditions, cp.raw_shipping_status, cp.raw_shipping_price_krw,
  cp.regular_price_krw, cp.sale_price_krw, cp.coupon_price_krw, cp.coupon_eligible, cp.coupon_conditions,
  cp.shipping_status, cp.shipping_price_krw, cp.shipping_free_threshold_krw,
  cp.effective_price_krw, cp.effective_price_kind,
  cp.unit_price_krw_per_kg, cp.unit_price_krw_per_piece, cp.price_warnings, cp.observed_at,
  coalesce((
    select jsonb_object_agg(o.field_name, jsonb_build_object('value', o.override_value, 'is_locked', o.is_locked, 'updated_at', o.updated_at))
    from public.product_overrides o where o.product_id = p.id
  ), '{}'::jsonb) as overrides
from public.products p
left join public.current_prices cp on cp.product_id = p.id;

drop view public.category_overview;
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

revoke all on public.product_rows, public.category_overview from anon;
grant select on public.product_rows, public.category_overview to authenticated, service_role;

-- ───────── functions ─────────
create or replace function public.fpr_apply_effective(p_product_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  ov jsonb;
  p public.products;
  cp public.current_prices;
  m jsonb;
  v_reg int; v_sale int; v_coupon int; v_elig boolean; v_weight numeric; v_piece numeric;
  bp record; rbp record;
begin
  select * into p from public.products where id = p_product_id;
  select * into cp from public.current_prices where product_id = p_product_id;
  select coalesce(jsonb_object_agg(field_name, override_value), '{}'::jsonb) into ov
    from public.product_overrides where product_id = p_product_id;
  m := p.raw_meta;

  v_weight := case when ov ? 'weight_kg' then (ov->>'weight_kg')::numeric else (m->>'weight_kg')::numeric end;
  v_piece := case when ov ? 'piece_count' then (ov->>'piece_count')::numeric else (m->>'piece_count')::numeric end;
  update public.products set
    title = coalesce(case when ov ? 'title' then ov->>'title' else m->>'title' end, title),
    seller = case when ov ? 'seller' then ov->>'seller' else m->>'seller' end,
    product_option = case when ov ? 'product_option' then ov->>'product_option' else m->>'product_option' end,
    source_url = coalesce(case when ov ? 'source_url' then ov->>'source_url' else m->>'source_url' end, source_url),
    raw_weight_text = case when ov ? 'raw_weight_text' then ov->>'raw_weight_text' else m->>'raw_weight_text' end,
    weight_kg = v_weight,
    piece_count = v_piece,
    piece_label = coalesce(m->>'piece_label', piece_label),
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
    raw_unit_price_krw_per_piece = public.fpr_unit_price(rbp.price, (m->>'piece_count')::numeric),
    effective_price_krw = bp.price,
    effective_price_kind = bp.kind,
    unit_price_krw_per_kg = public.fpr_unit_price(bp.price, v_weight),
    unit_price_krw_per_piece = public.fpr_unit_price(bp.price, v_piece),
    price_warnings = bp.warnings,
    updated_at = now()
  where product_id = p_product_id;
end $$;

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
    raw_weight_kg, effective_weight_kg, raw_piece_count, effective_piece_count,
    raw_best_price_krw, raw_best_price_kind, effective_best_price_krw, effective_best_price_kind,
    raw_unit_price_krw_per_kg, effective_unit_price_krw_per_kg,
    raw_unit_price_krw_per_piece, effective_unit_price_krw_per_piece,
    shipping_status, shipping_price_krw, availability, order_status, product_option,
    source_product_id, source_option_id, extraction_status, parse_confidence, idempotency_key
  ) values (
    p.owner_id, p.id, p.category_id, p_run_id, p_observed_at, p_origin,
    cp.raw_regular_price_krw, cp.raw_sale_price_krw, cp.raw_coupon_price_krw, cp.raw_coupon_eligible,
    cp.regular_price_krw, cp.sale_price_krw, cp.coupon_price_krw, cp.coupon_eligible,
    (p.raw_meta->>'weight_kg')::numeric, p.weight_kg, (p.raw_meta->>'piece_count')::numeric, p.piece_count,
    cp.raw_best_price_krw, (public.fpr_best_price(cp.raw_regular_price_krw, cp.raw_sale_price_krw, cp.raw_coupon_price_krw, cp.raw_coupon_eligible)).kind,
    cp.effective_price_krw, cp.effective_price_kind,
    cp.raw_unit_price_krw_per_kg, cp.unit_price_krw_per_kg,
    cp.raw_unit_price_krw_per_piece, cp.unit_price_krw_per_piece,
    cp.shipping_status, cp.shipping_price_krw, p.availability, p.order_status, p.product_option,
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

create or replace function public.fpr_write_raw(p_product_id uuid, p_values jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  meta_keys text[] := array['title', 'seller', 'product_option', 'source_url', 'raw_weight_text', 'weight_kg', 'availability',
                            'piece_count', 'piece_label'];
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
    raw_shipping_price_krw = case when p_values ? 'shipping_price_krw' then (p_values->>'shipping_price_krw')::int else cp.raw_shipping_price_krw end,
    shipping_free_threshold_krw = case when p_values ? 'shipping_free_threshold_krw' then (p_values->>'shipping_free_threshold_krw')::int else cp.shipping_free_threshold_krw end
  where cp.product_id = p_product_id;
end $$;

-- 제외 키워드: 상품명에 하나라도 포함되면 true (대소문자 무시)
create or replace function public.fpr_is_excluded(p_keywords text[], p_title text) returns boolean
language sql immutable as $$
  select exists (
    select 1 from unnest(coalesce(p_keywords, '{}')) k
    where btrim(k) <> '' and position(lower(btrim(k)) in lower(coalesce(p_title, ''))) > 0)
$$;

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
  if public.fpr_is_excluded(c.exclude_keywords, p_obs->>'title') then return jsonb_build_object('status', 'excluded'); end if;

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
    parse_confidence = (p_obs->>'parse_confidence')::numeric,
    order_status = coalesce(p_obs->>'order_status', 'unknown'),
    order_status_reason = p_obs->>'order_status_reason',
    order_cutoff = p_obs->>'order_cutoff',
    delivery_lead_days = (p_obs->>'delivery_lead_days')::int,
    delivery_note = p_obs->>'delivery_note'
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

create or replace function public.fpr_save_product_edit(p_product_id uuid, p_changes jsonb, p_revert text[] default '{}')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.fpr_require_user();
  p public.products;
  v_before jsonb;
  k text;
  allowed text[] := array['title', 'seller', 'product_option', 'source_url', 'raw_weight_text', 'weight_kg', 'availability', 'piece_count',
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

revoke all on function public.fpr_is_excluded(text[], text) from public, anon;
grant execute on function public.fpr_is_excluded(text[], text) to authenticated, service_role;

