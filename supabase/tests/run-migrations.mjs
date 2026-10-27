// supabase/migrations/*.sql 을 PGlite(WASM Postgres)에 적용하고 핵심 시나리오를 검증한다.
// Supabase 의 auth 스키마/역할은 최소 스텁으로 흉내낸다. 실행: npm run test:sql
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'migrations');

const BOOTSTRAP = `
create schema auth;
create table auth.users (id uuid primary key, email text);
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
`;

const U1 = '11111111-1111-1111-1111-111111111111';
const U2 = '22222222-2222-2222-2222-222222222222';

const db = new PGlite();
await db.exec(BOOTSTRAP);
const fmtErr = (e) => [e.message, e.detail, e.where, e.position && `position ${e.position}`].filter(Boolean).join(' | ');
for (const f of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
  try {
    await db.exec(readFileSync(join(migrationsDir, f), 'utf8'));
  } catch (e) {
    console.error(`migration ${f} failed: ${fmtErr(e)}`);
    process.exit(1);
  }
  console.log(`applied ${f}`);
}
await db.exec(`insert into auth.users (id, email) values ('${U1}', 'a@example.invalid'), ('${U2}', 'b@example.invalid')`);

async function as(role, uid, sql, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec('reset role;');
  }
}
const user = (uid, sql, params) => as('authenticated', uid, sql, params);
const service = (sql, params) => as('service_role', null, sql, params);
const anon = (sql, params) => as('anon', null, sql, params);

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}\n    ${e.stack ?? e}`);
    process.exitCode = 1;
  }
}

const listing = (over = {}) => ({
  source: 'foodspring',
  source_product_id: '868118',
  source_option_id: null,
  source_url: 'https://www.foodspring.co.kr/goods/detail/868118',
  title: '테스트 깐마늘 1kg',
  seller: '테스트 판매자',
  product_option: null,
  raw_weight_text: '1KG',
  weight_kg: 1,
  regular_price_krw: 10000,
  sale_price_krw: 8000,
  coupon_price_krw: 7000,
  coupon_eligible: true,
  coupon_conditions: null,
  shipping_status: 'paid',
  shipping_price_krw: 3000,
  availability: 'in_stock',
  observed_at: '2026-10-27T00:00:00Z',
  extraction_status: 'verified',
  ...over,
});

let catId;
let productId;
let run1;
let run2;

console.log('scenarios');

await test('카테고리 생성 시 기본 예약 행이 함께 생성', async () => {
  const r = await user(U1, `insert into categories (name, keywords) values ('마늘', '{깐마늘,통마늘}') returning id`);
  catId = r.rows[0].id;
  const s = await user(U1, `select enabled, timezone from category_schedules where category_id = $1`, [catId]);
  assert.equal(s.rows.length, 1);
  assert.equal(s.rows[0].timezone, 'Asia/Seoul');
});

await test('다른 사용자의 owner_id 로 카테고리를 만들 수 없음', async () => {
  await assert.rejects(user(U2, `insert into categories (name, owner_id) values ('해킹', '${U1}')`));
});

await test('RLS: 다른 사용자·익명은 카테고리를 볼 수 없음', async () => {
  assert.equal((await user(U2, `select * from categories`)).rows.length, 0);
  await assert.rejects(anon(`select * from categories`));
});

await test('수집 반영: 쿠폰가 7,000 / 1kg → 7,000원/kg, 배송비 3,000 은 단가에 미포함', async () => {
  run1 = (await service(`insert into crawl_runs (owner_id, category_id, source) values ('${U1}', $1, 'foodspring') returning id`, [catId])).rows[0].id;
  const r = await service(`select fpr_ingest_listing($1, $2, $3::jsonb) as res`, [run1, catId, JSON.stringify(listing())]);
  assert.equal(r.rows[0].res.status, 'unchanged');
  productId = r.rows[0].res.product_id;
  const row = (await user(U1, `select * from product_rows where id = $1`, [productId])).rows[0];
  assert.equal(row.effective_price_krw, 7000);
  assert.equal(row.effective_price_kind, 'coupon');
  assert.equal(Number(row.unit_price_krw_per_kg), 7000);
  assert.equal(row.shipping_price_krw, 3000);
});

await test('같은 run 재시도는 관측 중복을 만들지 않음', async () => {
  const r = await service(`select fpr_ingest_listing($1, $2, $3::jsonb) as res`, [run1, catId, JSON.stringify(listing())]);
  assert.equal(r.rows[0].res.status, 'duplicate');
  const c = await user(U1, `select count(*)::int as n from price_observations where product_id = $1`, [productId]);
  assert.equal(c.rows[0].n, 1);
});

await test('다른 정상 갱신은 가격이 같아도 관측 기록 유지', async () => {
  run2 = (await service(`insert into crawl_runs (owner_id, category_id, source) values ('${U1}', $1, 'foodspring') returning id`, [catId])).rows[0].id;
  const r = await service(`select fpr_ingest_listing($1, $2, $3::jsonb) as res`, [run2, catId, JSON.stringify(listing({ observed_at: '2026-10-28T00:00:00Z' }))]);
  assert.equal(r.rows[0].res.status, 'unchanged');
  const c = await user(U1, `select count(*)::int as n from price_observations where product_id = $1`, [productId]);
  assert.equal(c.rows[0].n, 2);
});

await test('쿠폰 조건 미확인(null)이면 최저가에서 제외', async () => {
  const run = (await service(`insert into crawl_runs (owner_id, category_id, source) values ('${U1}', $1, 'foodspring') returning id`, [catId])).rows[0].id;
  await service(`select fpr_ingest_listing($1, $2, $3::jsonb)`, [run, catId, JSON.stringify(listing({ coupon_eligible: null, observed_at: '2026-10-28T01:00:00Z' }))]);
  const row = (await user(U1, `select effective_price_krw, effective_price_kind, price_warnings from product_rows where id = $1`, [productId])).rows[0];
  assert.equal(row.effective_price_krw, 8000);
  assert.equal(row.effective_price_kind, 'sale');
  assert.deepEqual(row.price_warnings, ['coupon_excluded']);
  const ev = await user(U1, `select event_type from change_events where product_id = $1 order by created_at`, [productId]);
  assert.ok(ev.rows.some((e) => e.event_type === 'price_up'));
});

await test('수동 수정 + 고정: 할인가 6,000 고정 → 수정 시점 manual_edit 관측 추가', async () => {
  const r = await user(U1, `select fpr_save_product_edit($1, $2::jsonb) as row`, [productId, JSON.stringify({ sale_price_krw: { value: 6000, locked: true } })]);
  assert.equal(r.rows[0].row.effective_price_krw, 6000);
  const o = await user(U1, `select origin, effective_best_price_krw, raw_best_price_krw from price_observations where product_id = $1 and origin = 'manual_edit' order by created_at desc limit 1`, [productId]);
  assert.equal(o.rows[0].origin, 'manual_edit');
  assert.equal(o.rows[0].effective_best_price_krw, 6000);
  assert.equal(o.rows[0].raw_best_price_krw, 8000);
});

await test('고정한 필드는 다음 자동 수집에서 덮어쓰지 않음 (raw 는 갱신)', async () => {
  const run = (await service(`insert into crawl_runs (owner_id, category_id, source) values ('${U1}', $1, 'foodspring') returning id`, [catId])).rows[0].id;
  await service(`select fpr_ingest_listing($1, $2, $3::jsonb)`, [run, catId, JSON.stringify(listing({ sale_price_krw: 8500, coupon_eligible: null, observed_at: '2026-10-29T00:00:00Z' }))]);
  const row = (await user(U1, `select sale_price_krw, raw_sale_price_krw from product_rows where id = $1`, [productId])).rows[0];
  assert.equal(row.sale_price_krw, 6000);
  assert.equal(row.raw_sale_price_krw, 8500);
});

await test('고정하지 않은 수정값은 다음 수집에서 수집값으로 대체', async () => {
  await user(U1, `select fpr_save_product_edit($1, $2::jsonb)`, [productId, JSON.stringify({ title: { value: '임시 이름', locked: false } })]);
  const run = (await service(`insert into crawl_runs (owner_id, category_id, source) values ('${U1}', $1, 'foodspring') returning id`, [catId])).rows[0].id;
  await service(`select fpr_ingest_listing($1, $2, $3::jsonb)`, [run, catId, JSON.stringify(listing({ sale_price_krw: 8500, coupon_eligible: null, observed_at: '2026-10-29T01:00:00Z' }))]);
  const row = (await user(U1, `select title, overrides from product_rows where id = $1`, [productId])).rows[0];
  assert.equal(row.title, '테스트 깐마늘 1kg');
  assert.ok(!('title' in row.overrides));
  assert.ok('sale_price_krw' in row.overrides);
});

await test('자동 값으로 복원', async () => {
  const r = await user(U1, `select fpr_save_product_edit($1, '{}'::jsonb, array['sale_price_krw']) as row`, [productId]);
  assert.equal(r.rows[0].row.sale_price_krw, 8500);
  assert.equal(r.rows[0].row.effective_price_krw, 8500);
});

await test('과거 관측의 단가는 당시 중량 기준 (소급 재계산 없음)', async () => {
  const run = (await service(`insert into crawl_runs (owner_id, category_id, source) values ('${U1}', $1, 'foodspring') returning id`, [catId])).rows[0].id;
  await service(`select fpr_ingest_listing($1, $2, $3::jsonb)`, [run, catId, JSON.stringify(listing({ weight_kg: 2, raw_weight_text: '2KG', sale_price_krw: 8500, coupon_eligible: null, observed_at: '2026-10-30T00:00:00Z' }))]);
  const o = await user(U1, `select effective_weight_kg, effective_unit_price_krw_per_kg from price_observations where product_id = $1 order by observed_at`, [productId]);
  assert.equal(Number(o.rows[0].effective_unit_price_krw_per_kg), 7000);
  assert.equal(Number(o.rows.at(-1).effective_unit_price_krw_per_kg), 4250);
  const ev = await user(U1, `select 1 from change_events where product_id = $1 and event_type = 'weight_changed'`, [productId]);
  assert.equal(ev.rows.length, 1);
});

await test('다른 사용자는 남의 상품을 수정·삭제할 수 없음', async () => {
  await assert.rejects(user(U2, `select fpr_save_product_edit($1, $2::jsonb)`, [productId, JSON.stringify({ title: { value: 'x' } })]));
  await assert.rejects(user(U2, `select fpr_delete_product($1)`, [productId]));
  assert.equal((await user(U2, `select * from product_rows`)).rows.length, 0);
  assert.equal((await user(U2, `select * from price_observations`)).rows.length, 0);
});

await test('로그인 사용자도 상품/가격 테이블에 직접 쓸 수 없음 (RPC 전용)', async () => {
  await assert.rejects(user(U1, `update current_prices set unit_price_krw_per_kg = 1 where product_id = $1`, [productId]).then((r) => {
    if (r.affectedRows === 0) throw new Error('no rows');
  }));
  await assert.rejects(user(U1, `insert into price_observations (owner_id, product_id, category_id, observed_at, origin, idempotency_key) values ('${U1}', $1, $2, now(), 'crawl', 'x')`, [productId, catId]));
});

await test('삭제한 상품은 다음 수집에서 부활하지 않고, 복구하면 다시 수집', async () => {
  await user(U1, `select fpr_delete_product($1)`, [productId]);
  const run = (await service(`insert into crawl_runs (owner_id, category_id, source) values ('${U1}', $1, 'foodspring') returning id`, [catId])).rows[0].id;
  const r = await service(`select fpr_ingest_listing($1, $2, $3::jsonb) as res`, [run, catId, JSON.stringify(listing({ observed_at: '2026-10-31T00:00:00Z' }))]);
  assert.equal(r.rows[0].res.status, 'blocked');
  const live = await user(U1, `select count(*)::int as n from products where category_id = $1 and deleted_at is null`, [catId]);
  assert.equal(live.rows[0].n, 0);
  await user(U1, `select fpr_restore_product($1)`, [productId]);
  const r2 = await service(`select fpr_ingest_listing($1, $2, $3::jsonb) as res`, [run, catId, JSON.stringify(listing({ observed_at: '2026-10-31T00:00:00Z' }))]);
  assert.notEqual(r2.rows[0].res.status, 'blocked');
});

await test('수집 실패 표시는 값 보존 + stale 상태 (0원/삭제 아님)', async () => {
  const before = (await user(U1, `select effective_price_krw from product_rows where id = $1`, [productId])).rows[0];
  await service(`select fpr_mark_source_stale($1, 'foodspring')`, [catId]);
  const after = (await user(U1, `select effective_price_krw, source_status, deleted_at from product_rows where id = $1`, [productId])).rows[0];
  assert.equal(after.effective_price_krw, before.effective_price_krw);
  assert.equal(after.source_status, 'stale');
  assert.equal(after.deleted_at, null);
});

await test('수동 상품 추가: 중량 미확인이면 단가 null', async () => {
  const r = await user(U1, `select fpr_add_manual_product($1, 'naver', $2::jsonb) as id`, [
    catId,
    JSON.stringify({ title: '네이버 마늘', source_url: 'https://example.invalid/n/1', regular_price_krw: 3900, weight_kg: null, shipping_status: 'unknown' }),
  ]);
  const row = (await user(U1, `select * from product_rows where id = $1`, [r.rows[0].id])).rows[0];
  assert.equal(row.is_manual, true);
  assert.equal(row.effective_price_krw, 3900);
  assert.equal(row.unit_price_krw_per_kg, null);
  const o = await user(U1, `select origin from price_observations where product_id = $1`, [r.rows[0].id]);
  assert.deepEqual(o.rows.map((x) => x.origin), ['manual_edit']);
});

await test('수동 갱신 요청은 탭별 대기열에 하나만', async () => {
  const a = await user(U1, `select (fpr_enqueue_refresh($1)).id`, [catId]);
  const b = await user(U1, `select (fpr_enqueue_refresh($1)).id`, [catId]);
  assert.equal(a.rows[0].id, b.rows[0].id);
  const all = await user(U1, `select (fpr_enqueue_refresh(null)).reason`);
  assert.equal(all.rows[0].reason, 'manual_all');
  await assert.rejects(user(U2, `select fpr_enqueue_refresh($1)`, [catId]));
  await assert.rejects(anon(`select fpr_enqueue_refresh(null)`));
});

await test('예약을 켜거나 바꾸면 그 이전에 지난 슬롯은 따라잡지 않음', async () => {
  const before = Date.now();
  await user(U1, `update category_schedules set enabled = true, frequency = 'daily', times_of_day = '{08:30}' where category_id = $1`, [catId]);
  const s = (await user(U1, `select last_enqueued_slot from category_schedules where category_id = $1`, [catId])).rows[0];
  assert.ok(new Date(s.last_enqueued_slot).getTime() >= before - 5000);
  // 수집기의 큐잉 기록 갱신(설정 변경 아님)은 가드에 걸리지 않는다
  await service(`update category_schedules set next_due_at = now() where category_id = $1`, [catId]);
  const s2 = (await user(U1, `select last_enqueued_slot from category_schedules where category_id = $1`, [catId])).rows[0];
  assert.equal(new Date(s2.last_enqueued_slot).getTime(), new Date(s.last_enqueued_slot).getTime());
});

await test('예약 슬롯은 같은 slot_key 로 한 번만 큐에 들어감', async () => {
  const slot = '2026-10-27T23:30:00Z';
  const a = await service(`select fpr_enqueue_scheduled($1, $2, $3) as id`, [catId, slot, '2026-10-28T23:30:00Z']);
  const b = await service(`select fpr_enqueue_scheduled($1, $2, $3) as id`, [catId, slot, '2026-10-28T23:30:00Z']);
  assert.ok(a.rows[0].id);
  assert.equal(b.rows[0].id, null);
});

await test('작업 claim 은 잠금 후 재claim 되지 않고, 완료 시 예약 슬롯 기록', async () => {
  const c1 = await service(`select id, reason from fpr_claim_jobs('w1', 10, 30)`);
  assert.ok(c1.rows.length >= 3);
  const c2 = await service(`select id from fpr_claim_jobs('w2', 10, 30)`);
  assert.equal(c2.rows.length, 0);
  for (const j of c1.rows) await service(`select fpr_finish_job($1, 'success')`, [j.id]);
  const s = await user(U1, `select last_completed_slot from category_schedules where category_id = $1`, [catId]);
  assert.equal(new Date(s.rows[0].last_completed_slot).toISOString(), '2026-10-27T23:30:00.000Z');
});

await test('만료된 락은 재시도 대상이 되고 3회 초과 시 실패 처리', async () => {
  const j = (await user(U1, `select (fpr_enqueue_refresh($1)).id`, [catId])).rows[0].id;
  for (let i = 0; i < 3; i++) {
    const c = await service(`select id from fpr_claim_jobs('w', 10, 30)`);
    assert.deepEqual(c.rows.map((r) => r.id), [j]);
    await service(`update refresh_jobs set locked_until = now() - interval '1 minute' where id = $1`, [j]);
  }
  await service(`select * from fpr_claim_jobs('w', 10, 30)`);
  const st = await user(U1, `select status from refresh_jobs where id = $1`, [j]);
  assert.equal(st.rows[0].status, 'failed');
});

await test('탭 소프트 삭제는 이력 보존, 명시적 purge 에서만 이력 삭제', async () => {
  const c2 = (await user(U1, `insert into categories (name) values ('배추') returning id`)).rows[0].id;
  await user(U1, `select fpr_add_manual_product($1, 'manual', $2::jsonb)`, [c2, JSON.stringify({ title: '배추', source_url: 'https://example.invalid/c', regular_price_krw: 5000, weight_kg: 8 })]);
  await user(U1, `select fpr_delete_category($1, false)`, [c2]);
  const kept = await user(U1, `select count(*)::int as n from price_observations where category_id = $1`, [c2]);
  assert.equal(kept.rows[0].n, 1);
  await user(U1, `select fpr_restore_category($1)`, [c2]);
  await user(U1, `select fpr_delete_category($1, true)`, [c2]);
  const purged = await user(U1, `select count(*)::int as n from price_observations where category_id = $1`, [c2]);
  assert.equal(purged.rows[0].n, 0);
});

await test('감사 로그에 수정 전/후 값 기록', async () => {
  const r = await user(U1, `select action, before_json, after_json from audit_logs where entity_type = 'product' and action = 'edit' order by id limit 1`);
  assert.equal(r.rows[0].before_json.sale_price_krw, 8000);
  assert.equal(r.rows[0].after_json.sale_price_krw, 6000);
});

await test('category_overview: 마지막 성공 시각과 작업 상태', async () => {
  const r = await user(U1, `select name, last_success_at, last_job_status from category_overview where id = $1`, [catId]);
  assert.ok(r.rows[0].last_success_at);
});

console.log(`\n${passed} passed${process.exitCode ? ', some failed' : ''}`);
await db.close();
