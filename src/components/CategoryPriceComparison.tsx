import { LineChart as LineIcon, Table2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from 'recharts';
import type { Category, ChartPreferences, ProductRow, RangeKey } from '../types';
import { AXIS, krwTick, niceScale, seriesStyle } from '../lib/chartColors';
import { formatPct } from '../lib/domain/format';
import { formatUnit, unitOf, unitSuffix } from '../lib/domain/units';
import { buildComparison, defaultComparisonSelection, RANGE_LABEL, summarize } from '../lib/domain/history';
import { formatWeightKg } from '../lib/domain/weight';
import { useChartPrefs, useComparison, useMutations } from '../lib/queries';
import { Drawer, EmptyState, Segmented, SkeletonRows, SOURCE_LABEL, Toggle, cx } from './ui';

const RANGES: RangeKey[] = ['7d', '30d', '90d', '1y', 'all'];
const MAX = 10;

export function CategoryPriceComparison({ category, products, onClose }: { category: Category; products: ProductRow[]; onClose: () => void }) {
  const basis = category.unitBasis;
  const formatUnitPrice = (v: number | null | undefined) => formatUnit(v, basis, category.pieceLabel);
  const prefsQ = useChartPrefs(category.id);
  const { savePrefs } = useMutations();
  const [prefs, setPrefs] = useState<ChartPreferences | null>(null);
  const [asTable, setAsTable] = useState(false);
  const loaded = useRef(false);

  // 저장된 선택(DB) → 없으면 현재 최저 단가 상위 5개
  useEffect(() => {
    if (prefsQ.isLoading || loaded.current) return;
    loaded.current = true;
    const saved = prefsQ.data;
    const alive = new Set(products.map((p) => p.id));
    const selected = saved?.selectedProductIds.filter((id) => alive.has(id)) ?? [];
    setPrefs({
      categoryId: category.id,
      selectedProductIds: selected.length ? selected : defaultComparisonSelection(products.map((p) => ({ id: p.id, unitPriceKrwPerKg: unitOf(p, basis) }))),
      range: saved?.range ?? '30d',
      seriesVisibility: saved?.seriesVisibility ?? {},
      carryForward: saved?.carryForward ?? false,
    });
  }, [prefsQ.isLoading, prefsQ.data, products, category.id, basis]);

  // 변경 시 DB 에 저장 (로그아웃·다른 기기에서도 유지)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const update = (patch: Partial<ChartPreferences>) => {
    setPrefs((p) => {
      const next = { ...p!, ...patch };
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => savePrefs.mutate(next), 600);
      return next;
    });
  };

  const ids = useMemo(() => prefs?.selectedProductIds ?? [], [prefs?.selectedProductIds]);
  const range = prefs?.range ?? '30d';
  const comp = useComparison(category.id, ids, range);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const { rows, insufficient } = useMemo(() => buildComparison(comp.data ?? {}, range, Date.now(), 'effective', basis), [comp.data, range, basis]);
  const visible = (id: string) => prefs?.seriesVisibility[id] !== false;

  const chartData = useMemo(
    () =>
      rows.map((r) => {
        const o: Record<string, number | string | null> = { day: r.day };
        for (const id of ids) {
          o[`v_${id}`] = r.values[id] ?? null;
          o[`e_${id}`] = r.estimated[id] ?? null;
        }
        return o;
      }),
    [rows, ids],
  );

  const changeOf = (id: string) => summarize(rows.map((r) => ({ at: r.day, value: r.values[id] ?? null })));
  // 색은 상품(엔터티)에 고정: 선택을 해제해도 남은 시리즈의 색이 바뀌지 않도록 빈 슬롯을 재사용
  const slots = useRef<Map<string, number>>(new Map());
  for (const id of [...slots.current.keys()]) if (!ids.includes(id)) slots.current.delete(id);
  for (const id of ids) {
    if (slots.current.has(id)) continue;
    const used = new Set(slots.current.values());
    let i = 0;
    while (used.has(i)) i++;
    slots.current.set(id, i);
  }
  const colorIndex = (id: string) => slots.current.get(id) ?? 0;

  const toggleSelect = (id: string) => {
    if (ids.includes(id)) update({ selectedProductIds: ids.filter((x) => x !== id) });
    else if (ids.length < MAX) update({ selectedProductIds: [...ids, id] });
  };

  function CompareTooltip({ active, payload, label }: TooltipProps<number, string>) {
    if (!active || !payload?.length) return null;
    const row = rows.find((r) => r.day === label);
    if (!row) return null;
    return (
      <div className="num w-72 rounded-lg border border-slate-200 bg-white p-3 text-[12px] shadow-lg">
        <div className="mb-1.5 font-semibold">{label} (KST, 그날 마지막 관측)</div>
        <ul className="space-y-1">
          {ids.filter(visible).map((id) => {
            const p = byId.get(id);
            const v = row.values[id];
            const est = prefs?.carryForward && v == null ? row.estimated[id] : null;
            return (
              <li key={id} className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: seriesStyle(colorIndex(id)).color }} />
                  <span className="truncate text-slate-700">{p?.effective.title ?? id}</span>
                </span>
                <span className="shrink-0 font-medium">
                  {v != null ? formatUnitPrice(v) : est != null ? <span className="text-slate-400">{formatUnitPrice(est)} (추정)</span> : <span className="text-slate-400">관측 없음</span>}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <Drawer open onClose={onClose} width="max-w-5xl" title={`${category.name} · 상품 간 가격 추이 비교`} subtitle="모든 상품을 같은 단가 기준(배송비 제외)으로 비교합니다. 갱신에 성공할 때마다 기록이 쌓이고, 날짜별로 그날 마지막 기록을 씁니다. 옵션·중량이 서로 다를 수 있으니 범례를 확인하세요.">
      {!prefs ? (
        <SkeletonRows rows={6} />
      ) : products.length === 0 ? (
        <EmptyState icon={<LineIcon size={20} />} title="비교할 상품이 없습니다" />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Segmented label="기간" value={range} onChange={(r) => update({ range: r })} options={RANGES.map((r) => ({ value: r, label: RANGE_LABEL[r] }))} />
              <label className="flex items-center gap-2 text-[13px] text-slate-600">
                <Toggle checked={prefs.carryForward} onChange={(v) => update({ carryForward: v })} label="마지막 확인가 유지(추정)" />
                마지막 확인가 유지(추정)
              </label>
              <button className="btn-ghost btn-sm ml-auto" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>
                <Table2 size={14} /> {asTable ? '그래프로 보기' : '표로 보기'}
              </button>
            </div>

            {ids.length < 2 && <p className="rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-800">오른쪽 목록에서 비교할 상품을 2개 이상 선택하세요 (최대 {MAX}개).</p>}

            {comp.isLoading ? (
              <SkeletonRows rows={6} />
            ) : rows.length === 0 ? (
              <EmptyState icon={<LineIcon size={20} />} title="선택 기간에 관측 기록이 없습니다" />
            ) : asTable ? (
              <div className="max-h-[420px] overflow-auto rounded-lg border border-slate-200">
                <table className="num w-full text-[12px]">
                  <thead className="sticky top-0 bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-2.5 py-2 text-left">날짜(KST)</th>
                      {ids.map((id) => (
                        <th key={id} className="max-w-[140px] truncate px-2.5 py-2 text-right" title={byId.get(id)?.effective.title}>
                          {byId.get(id)?.effective.title ?? id}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {[...rows].reverse().map((r) => (
                      <tr key={r.day}>
                        <td className="px-2.5 py-1.5">{r.day}</td>
                        {ids.map((id) => (
                          <td key={id} className="px-2.5 py-1.5 text-right">
                            {formatUnitPrice(r.values[id])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div>
                <div className="mb-1 text-xs font-semibold text-slate-600">단가 · 단위 원/{unitSuffix(basis, category.pieceLabel)} (배송비 제외, 날짜는 KST)</div>
                <div className="h-[340px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke={AXIS.grid} vertical={false} />
                    <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5).replace('-', '/')} tick={{ fill: AXIS.tick, fontSize: AXIS.font }} axisLine={{ stroke: AXIS.grid }} tickLine={false} minTickGap={20} />
                    <YAxis
                      tickFormatter={krwTick}
                      tick={{ fill: AXIS.tick, fontSize: AXIS.font }}
                      axisLine={false}
                      tickLine={false}
                      width={56}
                      {...niceScale(rows.flatMap((r) => ids.filter(visible).map((id) => r.values[id] ?? (prefs.carryForward ? r.estimated[id] : null))))}
                                            allowDecimals={false}
                    />
                    <Tooltip content={<CompareTooltip />} cursor={{ stroke: '#94a3b8' }} wrapperStyle={{ outline: 'none', zIndex: 10 }} />
                    {prefs.carryForward &&
                      ids.filter(visible).map((id) => (
                        <Line key={`e_${id}`} dataKey={`e_${id}`} stroke={seriesStyle(colorIndex(id)).color} strokeOpacity={0.45} strokeWidth={1.5} strokeDasharray="6 4" dot={false} activeDot={false} isAnimationActive={false} legendType="none" />
                      ))}
                    {ids.filter(visible).map((id) => {
                      const st = seriesStyle(colorIndex(id));
                      return (
                        <Line
                          key={`v_${id}`}
                          dataKey={`v_${id}`}
                          name={byId.get(id)?.effective.title}
                          stroke={st.color}
                          strokeDasharray={st.dash}
                          strokeWidth={2}
                          connectNulls={false}
                          isAnimationActive={false}
                          dot={{ r: 4, fill: st.color, stroke: '#fff', strokeWidth: 1.5 }}
                          activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }}
                        />
                      );
                    })}
                  </LineChart>
                </ResponsiveContainer>
                </div>
              </div>
            )}
            <p className="text-[11px] leading-4 text-slate-500">
              날짜별 대표값은 그날 마지막 성공 관측입니다. 관측이 없는 날은 선이 끊기며 값을 보간하지 않습니다{prefs.carryForward ? ' — 흐린 점선은 ‘마지막 확인가 유지(추정)’ 값입니다' : ''}. 하루 중 여러 번 바뀐 내역은 상품별 ‘가격 이력’에서 확인하세요.
            </p>

            {ids.length > 0 && (
              <ul className="grid gap-1.5 sm:grid-cols-2" aria-label="범례">
                {ids.map((id) => {
                  const p = byId.get(id);
                  const st = seriesStyle(colorIndex(id));
                  const ch = changeOf(id);
                  const on = visible(id);
                  return (
                    <li key={id}>
                      <button
                        onClick={() => update({ seriesVisibility: { ...prefs.seriesVisibility, [id]: !on } })}
                        aria-pressed={on}
                        className={cx('flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left text-[12px]', on ? 'border-slate-200 bg-white' : 'border-slate-100 bg-slate-50 opacity-60')}
                      >
                        <svg width="18" height="10" className="mt-1 shrink-0" aria-hidden>
                          <line x1="1" y1="5" x2="17" y2="5" stroke={st.color} strokeWidth="2.5" strokeDasharray={st.dash} />
                        </svg>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-slate-800">{p?.effective.title ?? '삭제된 상품'}</span>
                          <span className="num block text-slate-500">
                            {p ? `${SOURCE_LABEL[p.source]} · ${p.effective.productOption ?? p.effective.rawWeightText ?? '-'} (${formatWeightKg(p.effective.weightKg)})` : ''}
                          </span>
                        </span>
                        <span className="num shrink-0 text-right">
                          {insufficient.includes(id) ? (
                            <span className="chip bg-amber-50 text-amber-700">데이터 부족</span>
                          ) : (
                            <>
                              <span className="block font-semibold">{formatUnitPrice(ch.last)}</span>
                              <span className="block text-slate-500">{formatPct(ch.pct)}</span>
                            </>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <aside>
            <h3 className="mb-2 text-[13px] font-semibold text-slate-700">
              비교 상품 선택 <span className="num font-normal text-slate-500">({ids.length}/{MAX})</span>
            </h3>
            <ul className="max-h-[560px] space-y-0.5 overflow-y-auto rounded-lg border border-slate-200 p-1.5">
              {products.map((p) => {
                const checked = ids.includes(p.id);
                return (
                  <li key={p.id}>
                    <label className={cx('flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-[12px] hover:bg-slate-50', !checked && ids.length >= MAX && 'cursor-not-allowed opacity-50')}>
                      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-accent-700" checked={checked} disabled={!checked && ids.length >= MAX} onChange={() => toggleSelect(p.id)} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-slate-800">{p.effective.title}</span>
                        <span className="num text-slate-500">
                          {SOURCE_LABEL[p.source]} · {formatUnitPrice(unitOf(p, basis))}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </aside>
        </div>
      )}
    </Drawer>
  );
}
