import { ExternalLink, LineChart, Lock, Pencil, Trash2, TriangleAlert } from 'lucide-react';
import type { Category, OrderStatus, ProductRow, ProductSourceStatus } from '../types';
import { FIELD_LABEL } from '../lib/domain/effective';
import { formatKrw, type UnitView } from '../lib/domain/format';
import { formatUnit, unitOf } from '../lib/domain/units';
import { formatWeightKg } from '../lib/domain/weight';
import { PriceKindBadge, SourceBadge, cx } from './ui';

const STATUS: Record<ProductSourceStatus, { label: string; tone: string; title: string }> = {
  ok: { label: '성공', tone: 'bg-accent-50 text-accent-700', title: '마지막 수집에 성공했습니다.' },
  stale: { label: '수집 실패', tone: 'bg-red-50 text-red-700', title: '최근 수집이 실패해 마지막 정상값을 표시 중입니다.' },
  needs_review: { label: '검토 필요', tone: 'bg-amber-50 text-amber-700', title: '중량/가격 추출 신뢰도가 낮습니다.' },
  manual: { label: '수동', tone: 'bg-slate-100 text-slate-600', title: '관리자가 직접 입력한 상품입니다.' },
};

export const ORDER_LABEL: Record<OrderStatus, string> = {
  orderable: '가능',
  discontinued: '불가',
  sold_out: '불가',
  closed: '불가',
  unknown: '-',
};

export function isOrderable(r: ProductRow): boolean | null {
  if (r.orderStatus === 'orderable') return true;
  if (r.orderStatus === 'unknown') return null;
  return false;
}

export function deliveryLabel(days: number | null): string {
  if (days == null) return '-';
  return days === 0 ? '당일' : `D+${days}`;
}

function shippingCell(r: ProductRow) {
  const e = r.effective;
  if (e.shippingStatus === 'free') return <span>무료</span>;
  if (e.shippingStatus === 'unknown') return <span className="text-slate-400">-</span>;
  return (
    <>
      <div>{e.shippingPriceKrw != null ? formatKrw(e.shippingPriceKrw) : '유료(금액 미확인)'}</div>
      {r.shippingFreeThresholdKrw != null && (
        <div className="text-[11px] text-slate-500">{`${formatKrw(r.shippingFreeThresholdKrw)} 이상 무료`}</div>
      )}
    </>
  );
}

const th = 'px-3 py-2.5 text-left text-[12px] font-semibold text-slate-500 whitespace-nowrap';
const td = 'px-3 py-2.5 align-top whitespace-nowrap';

export function ProductTable({
  rows,
  category,
  view,
  onHistory,
  onEdit,
  onDelete,
}: {
  rows: ProductRow[];
  category: Category;
  view: UnitView;
  onHistory: (p: ProductRow) => void;
  onEdit: (p: ProductRow) => void;
  onDelete: (p: ProductRow) => void;
}) {
  const basis = category.unitBasis;
  const showPieces = basis === 'piece' || category.showPieceCount;
  const unitHeader = basis === 'piece' ? `가격/${category.pieceLabel}` : view === '100g' ? '가격/100g' : '가격/kg';
  const fmtUnit = (r: ProductRow) => formatUnit(unitOf(r, basis), basis, category.pieceLabel, view);
  const bestId = rows.find((r) => unitOf(r, basis) != null)?.id;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1240px] border-collapse text-sm">
        <caption className="sr-only">상품 목록 — 단가는 배송비를 제외한 최저 유효 상품가 기준</caption>
        <thead className="border-b border-slate-200 bg-slate-50/80">
          <tr>
            <th scope="col" className={cx(th, 'sticky left-0 z-10 min-w-[170px] bg-slate-50 md:min-w-[240px]')}>
              상품명
            </th>
            <th scope="col" className={th}>주문</th>
            <th scope="col" className={th} title="판매자 주문 마감 시각 (KST)">주문 마감</th>
            <th scope="col" className={th}>예상 배송</th>
            <th scope="col" className={th}>중량</th>
            {showPieces && <th scope="col" className={th}>개수</th>}
            <th scope="col" className={cx(th, 'text-right')}>정상가</th>
            <th scope="col" className={cx(th, 'text-right')}>할인가</th>
            <th scope="col" className={cx(th, 'text-right')}>쿠폰가</th>
            <th scope="col" className={cx(th, 'bg-accent-50/70 text-right text-accent-800')} title="정상가·할인가·적용 가능 쿠폰가 중 최저가 ÷ 중량(또는 개수). 배송비 제외.">
              {unitHeader}*
            </th>
            <th scope="col" className={th}>배송비</th>
            <th scope="col" className={th}>상태</th>
            <th scope="col" className={cx(th, 'text-right')}>작업</th>
            <th scope="col" className={th}>판매처</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => {
            const e = r.effective;
            const locked = (Object.entries(r.overrides) as Array<[keyof typeof FIELD_LABEL, { isLocked: boolean }]>).filter(([, o]) => o);
            const couponUnverified = e.couponPriceKrw != null && e.couponEligible !== true;
            const isBest = r.id === bestId;
            const st = STATUS[r.sourceStatus];
            const orderable = isOrderable(r);
            const unit = unitOf(r, basis);
            return (
              <tr key={r.id} className={cx('group', isBest ? 'bg-accent-50/40' : 'hover:bg-slate-50/70')}>
                <td className={cx(td, 'sticky left-0 z-[1] max-w-[180px] whitespace-normal md:max-w-[320px]', isBest ? 'bg-[#f3fbf7]' : 'bg-white group-hover:bg-slate-50')}>
                  <a href={e.sourceUrl} target="_blank" rel="noreferrer noopener" className="font-medium leading-5 text-slate-900 hover:text-accent-700 hover:underline">
                    {e.title}
                  </a>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {e.productOption && <span className="text-xs text-slate-500">{e.productOption}</span>}
                    <span className={cx('chip', r.isManual ? 'bg-violet-50 text-violet-700' : 'bg-slate-100 text-slate-600')}>{r.isManual ? '수동 등록' : '자동 수집'}</span>
                    {locked.length > 0 && (
                      <span className="chip bg-slate-800 text-white" title={`관리자 수정값: ${locked.map(([f, o]) => `${FIELD_LABEL[f]}${o.isLocked ? '(고정)' : ''}`).join(', ')}`}>
                        <Lock size={10} /> 수정 {locked.length}
                      </span>
                    )}
                    {isBest && <span className="chip bg-accent-100 text-accent-800">최저 단가</span>}
                  </div>
                  {/* 좁은 화면에서는 단가 열이 가로 스크롤 밖에 있으므로 고정된 상품명 칸에도 표시 */}
                  <div className="num mt-1.5 text-[13px] font-semibold text-accent-800 md:hidden">
                    {unitHeader} {fmtUnit(r)}
                  </div>
                </td>
                <td className={td}>
                  {orderable == null ? (
                    <span className="text-slate-400">-</span>
                  ) : (
                    <span className={cx('chip', orderable ? 'bg-accent-50 text-accent-700' : 'bg-red-50 text-red-700')}>{orderable ? '가능' : '불가'}</span>
                  )}
                  {r.orderStatusReason && <div className="mt-1 max-w-[120px] whitespace-normal text-[11px] leading-4 text-red-700">{r.orderStatusReason}</div>}
                </td>
                <td className={cx(td, 'num text-slate-700')}>{r.orderCutoff ?? '-'}</td>
                <td className={cx(td, 'max-w-[170px] whitespace-normal')}>
                  <div className="num font-medium text-slate-800">{deliveryLabel(r.deliveryLeadDays)}</div>
                  {r.deliveryNote && (
                    <div className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-slate-500" title={r.deliveryNote}>
                      {r.deliveryNote.replace(/^(당일|D\+\d+)\s*·\s*/, '')}
                    </div>
                  )}
                </td>
                <td className={cx(td, 'num')}>
                  <div className="max-w-[120px] truncate" title={e.rawWeightText ?? undefined}>
                    {e.rawWeightText ?? '-'}
                  </div>
                  <div className={cx('text-xs', e.weightKg == null && basis === 'kg' ? 'text-amber-700' : 'text-slate-500')}>
                    {e.weightKg == null ? (basis === 'kg' ? '총중량 확인 필요' : '-') : `= ${formatWeightKg(e.weightKg)}`}
                  </div>
                </td>
                {showPieces && (
                  <td className={cx(td, 'num')}>
                    {e.pieceCount != null ? (
                      `${e.pieceCount}${r.pieceLabel ?? category.pieceLabel}`
                    ) : (
                      <span className={basis === 'piece' ? 'text-amber-700' : 'text-slate-400'}>{basis === 'piece' ? '개수 확인 필요' : '-'}</span>
                    )}
                  </td>
                )}
                <td className={cx(td, 'num text-right text-slate-700')}>{formatKrw(e.regularPriceKrw)}</td>
                <td className={cx(td, 'num text-right text-slate-700')}>{formatKrw(e.salePriceKrw)}</td>
                <td className={cx(td, 'num text-right text-slate-700')}>
                  {formatKrw(e.couponPriceKrw)}
                  {couponUnverified && (
                    <div className="mt-0.5 text-right">
                      <span className="chip bg-slate-100 text-slate-500" title={e.couponConditions ?? '쿠폰 적용 조건 미확인 — 단가 계산에는 넣지 않음'}>
                        조건 확인
                      </span>
                    </div>
                  )}
                </td>
                <td className={cx(td, 'num bg-accent-50/50 text-right')}>
                  <div className={cx('text-[15px] font-semibold', unit == null ? 'text-slate-400' : 'text-slate-900')}>{fmtUnit(r)}</div>
                  <div className="mt-0.5 flex justify-end">
                    <PriceKindBadge kind={unit != null ? r.effectivePriceKind : null} />
                  </div>
                </td>
                <td className={cx(td, 'num text-slate-700')}>{shippingCell(r)}</td>
                <td className={td}>
                  <span className={cx('chip', st.tone)} title={st.title}>
                    {r.sourceStatus === 'stale' && <TriangleAlert size={11} />}
                    {st.label}
                  </span>
                  {r.reviewNotes.length > 0 && (
                    <div className="mt-1 max-w-[150px] truncate text-[11px] text-slate-500" title={r.reviewNotes.join('\n')}>
                      {r.reviewNotes[0]}
                    </div>
                  )}
                </td>
                <td className={cx(td, 'text-right')}>
                  <div className="flex justify-end gap-0.5">
                    <button className="btn-ghost btn-sm" onClick={() => onHistory(r)} aria-label={`${e.title} 가격 이력`} title="가격 이력">
                      <LineChart size={15} />
                      <span className="hidden xl:inline">이력</span>
                    </button>
                    <button className="btn-ghost btn-sm" onClick={() => onEdit(r)} aria-label={`${e.title} 수정`} title="수정">
                      <Pencil size={15} />
                    </button>
                    <a className="btn-ghost btn-sm" href={e.sourceUrl} target="_blank" rel="noreferrer noopener" aria-label={`${e.title} 원본 보기`} title="원본 보기">
                      <ExternalLink size={15} />
                    </a>
                    <button className="btn-ghost btn-sm hover:text-red-600" onClick={() => onDelete(r)} aria-label={`${e.title} 삭제`} title="삭제">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </td>
                <td className={td}>
                  <SourceBadge source={r.source} />
                  {e.seller && (
                    <div className="mt-1 max-w-[120px] truncate text-xs text-slate-500" title={e.seller}>
                      {e.seller}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
