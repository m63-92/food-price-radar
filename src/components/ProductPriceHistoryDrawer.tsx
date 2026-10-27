import { ExternalLink, History, Table2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ProductRow, RangeKey } from '../types';
import { formatKrw, formatKst, formatUnitPrice, shippingLabel } from '../lib/domain/format';
import { buildHistoryPoints, downsample, getPriceChangeSummary, RANGE_LABEL, type SeriesKey, type SnapshotMode } from '../lib/domain/history';
import { formatWeightKg } from '../lib/domain/weight';
import { useChangeEvents, useHistory } from '../lib/queries';
import type { OriginFilter } from '../lib/repo/types';
import { HistorySeriesToggle } from './HistorySeriesToggle';
import { PriceChangeSummary } from './PriceChangeSummary';
import { PriceHistoryChart, type HistoryDisplayMode } from './PriceHistoryChart';
import { Drawer, EmptyState, Segmented, SkeletonRows, SourceBadge } from './ui';

const RANGES: RangeKey[] = ['7d', '30d', '90d', '1y', 'all'];
const RANGE_STORE = 'fpr-history-range';
const EVENT_LABEL: Record<string, string> = {
  price_down: '가격 인하',
  price_up: '가격 인상',
  coupon_changed: '쿠폰 변동',
  weight_changed: '중량 변경',
  shipping_changed: '배송비 변경',
  out_of_stock: '품절',
  restocked: '재입고',
  first_seen: '최초 수집',
};

function readRange(): RangeKey {
  try {
    const v = localStorage.getItem(RANGE_STORE) as RangeKey | null;
    return v && RANGES.includes(v) ? v : '30d';
  } catch {
    return '30d';
  }
}

export function ProductPriceHistoryDrawer({ product, onClose }: { product: ProductRow; onClose: () => void }) {
  const [range, setRangeState] = useState<RangeKey>(readRange);
  const [mode, setMode] = useState<HistoryDisplayMode>('both');
  const [snapMode, setSnapMode] = useState<SnapshotMode>('effective');
  const [origin, setOrigin] = useState<OriginFilter>('all');
  const [asTable, setAsTable] = useState(false);
  const [visible, setVisible] = useState<Record<SeriesKey, boolean>>({ regular: false, sale: false, coupon: false, best: true, unit: true });
  const history = useHistory(product.id, range, origin);
  const events = useChangeEvents(product.id);

  const setRange = (r: RangeKey) => {
    setRangeState(r);
    try {
      localStorage.setItem(RANGE_STORE, r);
    } catch {
      /* 저장 불가 시 이번 화면에서만 유지 */
    }
  };

  const obs = useMemo(() => history.data ?? [], [history.data]);
  // 이미 기간으로 조회한 데이터이므로 요약은 'all' 로 계산
  const summary = useMemo(() => getPriceChangeSummary(obs, 'all', Date.now(), snapMode), [obs, snapMode]);
  const points = useMemo(() => downsample(buildHistoryPoints(obs, snapMode)), [obs, snapMode]);
  const e = product.effective;

  const seriesKeys: SeriesKey[] = mode === 'price' ? ['best', 'regular', 'sale', 'coupon'] : mode === 'unit' ? ['unit'] : ['unit', 'best', 'regular', 'sale', 'coupon'];

  return (
    <Drawer
      open
      onClose={onClose}
      width="max-w-4xl"
      title={
        <span className="flex flex-wrap items-center gap-2">
          {e.title}
          <SourceBadge source={product.source} />
        </span>
      }
      subtitle={
        <span className="num flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>
            중량 {e.rawWeightText ?? '-'} ({formatWeightKg(e.weightKg)})
          </span>
          {e.productOption && <span>옵션 {e.productOption}</span>}
          <span>현재 {formatUnitPrice(product.unitPriceKrwPerKg)}</span>
          <span>택배비 {shippingLabel(e.shippingStatus, e.shippingPriceKrw)} (단가 미포함)</span>
          <a href={e.sourceUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 text-accent-700 hover:underline">
            원본 상품 <ExternalLink size={12} />
          </a>
        </span>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented label="기간" value={range} onChange={setRange} options={RANGES.map((r) => ({ value: r, label: RANGE_LABEL[r] }))} />
        <Segmented<HistoryDisplayMode>
          label="표시 모드"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'price', label: '상품 가격(원)' },
            { value: 'unit', label: '단가(원/kg)' },
            { value: 'both', label: '둘 다' },
          ]}
        />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented<SnapshotMode>
          size="xs"
          label="값 기준"
          value={snapMode}
          onChange={setSnapMode}
          options={[
            { value: 'effective', label: '표시 가격(수정 반영)' },
            { value: 'raw', label: '수집 원본' },
          ]}
        />
        <Segmented<OriginFilter>
          size="xs"
          label="관측 출처"
          value={origin}
          onChange={setOrigin}
          options={[
            { value: 'all', label: '전체' },
            { value: 'crawl', label: '자동 수집' },
            { value: 'manual_edit', label: '수동 수정' },
          ]}
        />
        <button className="btn-ghost btn-sm ml-auto" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>
          <Table2 size={14} /> {asTable ? '그래프로 보기' : '표로 보기'}
        </button>
      </div>

      {history.isLoading ? (
        <SkeletonRows rows={6} />
      ) : history.isError ? (
        <p role="alert" className="text-sm text-red-600">
          이력을 불러오지 못했습니다: {(history.error as Error).message}
        </p>
      ) : obs.length === 0 ? (
        <EmptyState icon={<History size={20} />} title="가격 이력이 아직 없습니다">
          선택한 기간({RANGE_LABEL[range]})에 성공한 수집·수동 수정 기록이 없습니다. 수집에 성공하면 이 그래프가 자동으로 갱신됩니다.
        </EmptyState>
      ) : (
        <div className="space-y-4">
          <PriceChangeSummary price={summary.price} unit={summary.unit} />
          {obs.length === 1 && <p className="text-[13px] text-slate-500">관측 기록이 1건뿐이라 단일 지점만 표시합니다.</p>}
          <HistorySeriesToggle keys={seriesKeys} visible={visible} onChange={setVisible} />
          {asTable ? (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="num w-full min-w-[640px] text-[12px]">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    {['관측 시각(KST)', '출처', '정상가', '할인가', '쿠폰가', '최저가', '당시 중량', '가격/중량', '택배비'].map((h) => (
                      <th key={h} className="px-2.5 py-2 text-left font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[...obs].reverse().map((o) => {
                    const s = o[snapMode];
                    return (
                      <tr key={o.id}>
                        <td className="px-2.5 py-1.5">{formatKst(o.observedAt)}</td>
                        <td className="px-2.5 py-1.5">{o.origin === 'manual_edit' ? '수동 수정' : '자동 수집'}</td>
                        <td className="px-2.5 py-1.5">{formatKrw(s.regularPriceKrw)}</td>
                        <td className="px-2.5 py-1.5">{formatKrw(s.salePriceKrw)}</td>
                        <td className="px-2.5 py-1.5">
                          {formatKrw(s.couponPriceKrw)}
                          {s.couponPriceKrw != null && s.couponEligible !== true && <span className="text-slate-400"> (제외)</span>}
                        </td>
                        <td className="px-2.5 py-1.5 font-medium">{formatKrw(s.bestPriceKrw)}</td>
                        <td className="px-2.5 py-1.5">{formatWeightKg(s.weightKg)}</td>
                        <td className="px-2.5 py-1.5 font-semibold">{formatUnitPrice(s.unitPriceKrwPerKg)}</td>
                        <td className="px-2.5 py-1.5">{shippingLabel(o.shippingStatus, o.shippingPriceKrw)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <PriceHistoryChart points={points} mode={mode} visible={visible} />
          )}
        </div>
      )}

      <section className="mt-6">
        <h3 className="mb-2 text-[13px] font-semibold text-slate-700">변경 이벤트</h3>
        {(events.data ?? []).length === 0 ? (
          <p className="text-[13px] text-slate-500">기록된 변경 이벤트가 없습니다.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-[13px]">
            {events.data!.slice(0, 20).map((ev) => (
              <li key={ev.id} className="num flex items-center justify-between gap-3 px-3 py-2">
                <span className="font-medium">{EVENT_LABEL[ev.eventType] ?? ev.eventType}</span>
                <span className="text-slate-600">
                  {typeof ev.oldValue === 'number' || typeof ev.newValue === 'number'
                    ? `${formatKrw(ev.oldValue as number | null)} → ${formatKrw(ev.newValue as number | null)}`
                    : ''}
                </span>
                <span className="text-slate-500">{formatKst(ev.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Drawer>
  );
}
