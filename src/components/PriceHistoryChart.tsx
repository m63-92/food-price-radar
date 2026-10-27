import { Brush, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from 'recharts';
import { AXIS, HISTORY_COLORS, krwTick, niceScale } from '../lib/chartColors';
import { formatKrw, formatKst, formatKstShort, formatSignedKrw, formatUnitPrice, shippingLabel } from '../lib/domain/format';
import { SERIES_LABEL, type HistoryPoint, type SeriesKey } from '../lib/domain/history';
import { PRICE_KIND_LABEL } from '../lib/domain/pricing';

const PRICE_KEYS: SeriesKey[] = ['regular', 'sale', 'coupon', 'best'];

function HistoryTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as HistoryPoint;
  const o = p.observation;
  const snap = o.effective;
  const couponNote = snap.couponPriceKrw != null && snap.couponEligible !== true ? ' (조건 미확인·최저가 제외)' : '';
  return (
    <div className="num w-64 rounded-lg border border-slate-200 bg-white p-3 text-[12px] shadow-lg">
      <div className="font-semibold text-slate-900">{formatKst(o.observedAt)} KST</div>
      <div className="mb-2 text-slate-500">
        {o.origin === 'manual_edit' ? '수동 수정' : '자동 수집'}
        {o.productOption ? ` · ${o.productOption}` : ''}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        <dt className="text-slate-500">정상가</dt>
        <dd className="text-right">{formatKrw(p.regular)}</dd>
        <dt className="text-slate-500">할인가</dt>
        <dd className="text-right">{formatKrw(p.sale)}</dd>
        <dt className="text-slate-500">쿠폰가</dt>
        <dd className="text-right">
          {formatKrw(p.coupon)}
          <span className="text-slate-400">{couponNote}</span>
        </dd>
        <dt className="font-medium text-slate-700">최저 유효가</dt>
        <dd className="text-right font-medium">
          {formatKrw(p.best)}
          {snap.bestPriceKind ? <span className="text-slate-400"> ({PRICE_KIND_LABEL[snap.bestPriceKind]})</span> : null}
        </dd>
        <dt className="font-medium text-slate-700">가격/중량</dt>
        <dd className="text-right font-semibold">{formatUnitPrice(p.unit)}</dd>
        <dt className="text-slate-500">당시 중량</dt>
        <dd className="text-right">{snap.weightKg != null ? `${snap.weightKg}kg` : '-'}</dd>
        <dt className="text-slate-500">택배비(별도)</dt>
        <dd className="text-right">{shippingLabel(o.shippingStatus, o.shippingPriceKrw)}</dd>
      </dl>
      {p.bestDelta != null && p.bestDelta !== 0 && (
        <div className="mt-2 border-t border-slate-100 pt-1.5 font-medium">
          직전 대비 {p.bestDelta < 0 ? '▼' : '▲'} {formatSignedKrw(p.bestDelta)}
        </div>
      )}
    </div>
  );
}

/** 변동 지점은 큰 마커, 그 외 관측점은 작은 점 — 점이 없는 구간 = 수집 기록 없음 */
function ChangeDot(props: { cx?: number; cy?: number; payload?: HistoryPoint; stroke?: string; dataKey?: string; value?: number | null }) {
  const { cx, cy, payload, stroke, dataKey, value } = props;
  if (cx == null || cy == null || value == null || !payload) return <g />;
  const delta = dataKey === 'unit' ? payload.unitDelta : payload.bestDelta;
  const changed = (dataKey === 'best' || dataKey === 'unit') && delta != null && delta !== 0;
  const manual = payload.observation.origin === 'manual_edit';
  if (changed) {
    return <circle cx={cx} cy={cy} r={5} fill={stroke} stroke="#fff" strokeWidth={2} />;
  }
  return manual ? (
    <rect x={cx - 3.5} y={cy - 3.5} width={7} height={7} fill="#fff" stroke={stroke} strokeWidth={2} />
  ) : (
    <circle cx={cx} cy={cy} r={2.5} fill={stroke} stroke="#fff" strokeWidth={1} />
  );
}

function Chart({
  data,
  keys,
  height,
  syncId,
  showBrush,
}: {
  data: HistoryPoint[];
  keys: SeriesKey[];
  height: number;
  syncId: string;
  showBrush: boolean;
}) {
  const t0 = data[0]?.t ?? 0;
  const t1 = data[data.length - 1]?.t ?? 0;
  const pad = data.length === 1 ? 86_400_000 : 0;
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} syncId={syncId} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={AXIS.grid} strokeDasharray="0" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={[t0 - pad, t1 + pad]}
            tickFormatter={(t: number) => formatKstShort(new Date(t).toISOString()).slice(0, 5)}
            tick={{ fill: AXIS.tick, fontSize: AXIS.font }}
            axisLine={{ stroke: AXIS.grid }}
            tickLine={false}
            minTickGap={24}
          />
          <YAxis
            tickFormatter={krwTick}
            tick={{ fill: AXIS.tick, fontSize: AXIS.font }}
            axisLine={false}
            tickLine={false}
            width={56}
            {...niceScale(data.flatMap((d) => keys.map((k) => d[k])))}
                        allowDecimals={false}
          />
          <Tooltip content={<HistoryTooltip />} cursor={{ stroke: '#94a3b8', strokeWidth: 1 }} wrapperStyle={{ outline: 'none', zIndex: 10 }} />
          {keys.map((k) => (
            <Line
              key={k}
              dataKey={k}
              name={SERIES_LABEL[k]}
              stroke={HISTORY_COLORS[k]}
              strokeWidth={k === 'best' || k === 'unit' ? 2.5 : 2}
              strokeDasharray={k === 'coupon' ? '5 4' : undefined}
              connectNulls={false}
              isAnimationActive={false}
              dot={<ChangeDot />}
              activeDot={{ r: 6, stroke: '#fff', strokeWidth: 2 }}
            />
          ))}
          {showBrush && data.length > 8 && (
            <Brush dataKey="t" height={22} stroke="#94a3b8" travellerWidth={8} tickFormatter={(t: number) => formatKstShort(new Date(t).toISOString()).slice(0, 5)} />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export type HistoryDisplayMode = 'price' | 'unit' | 'both';

/**
 * 상품별 가격 이력 차트. 원(상품가)과 원/kg(단가)은 단위가 달라 한 축에 섞지 않는다:
 * '둘 다' 모드는 X축(시간)을 공유하는 두 개의 차트로 나눠 그린다.
 */
export function PriceHistoryChart({
  points,
  mode,
  visible,
}: {
  points: HistoryPoint[];
  mode: HistoryDisplayMode;
  visible: Record<SeriesKey, boolean>;
}) {
  const priceKeys = PRICE_KEYS.filter((k) => visible[k]);
  const showPrice = mode !== 'unit' && priceKeys.length > 0;
  const showUnit = mode !== 'price' && visible.unit;
  const both = showPrice && showUnit;
  return (
    <div className="space-y-3">
      {showUnit && (
        <div>
          <div className="mb-1 text-xs font-semibold text-slate-600">가격/중량 · 단위 원/kg (배송비 제외)</div>
          <Chart data={points} keys={['unit']} height={both ? 200 : 280} syncId="ph" showBrush={!both} />
        </div>
      )}
      {showPrice && (
        <div>
          <div className="mb-1 text-xs font-semibold text-slate-600">상품 가격 · 단위 원</div>
          <Chart data={points} keys={priceKeys} height={both ? 220 : 300} syncId="ph" showBrush />
        </div>
      )}
      {!showPrice && !showUnit && <p className="py-10 text-center text-sm text-slate-500">표시할 시리즈를 선택하세요.</p>}
      <p className="text-[11px] text-slate-500">
        ● 관측(자동 수집) · ■ 수동 수정 · 큰 점 = 직전 대비 가격 변동 · 쿠폰가 점선 = 참고값(조건 미확인이면 최저가 제외). 점이 없는 기간은 수집 기록이 없으며 값을 추정하지 않습니다.
      </p>
    </div>
  );
}
