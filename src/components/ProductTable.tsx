import { ExternalLink, LineChart, Lock, Pencil, Trash2, TriangleAlert } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import type { Category, OrderStatus, ProductRow, ProductSourceStatus } from '../types';
import { clampWidth, DEFAULT_COLUMN_WIDTH, MIN_NAME_WIDTH, type ColumnKey, type ColumnWidths } from '../lib/columnWidths';
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

const th = 'relative overflow-hidden text-ellipsis whitespace-nowrap px-3 py-2.5 text-left text-[12px] font-semibold text-slate-500';
const td = 'overflow-hidden text-ellipsis whitespace-nowrap px-3 py-2.5 align-top';

interface Col {
  key: ColumnKey;
  label: ReactNode;
  /** 너비 조절 핸들·툴팁에 쓰는 이름 */
  name: string;
  className?: string;
  title?: string;
}

/** 열 오른쪽 경계의 너비 조절 핸들. 드래그, ←/→(Shift 는 크게), 더블클릭(기본값 복원) */
function ResizeHandle({
  name,
  width,
  onDrag,
  onCommit,
  onReset,
}: {
  name: string;
  width: number;
  onDrag: (w: number | null) => void;
  onCommit: (w: number) => void;
  onReset: () => void;
}) {
  const drag = useRef<{ x: number; w: number; last: number } | null>(null);
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, w: width, last: width };
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current.last = drag.current.w + e.clientX - drag.current.x;
    onDrag(drag.current.last);
  };
  const up = () => {
    if (!drag.current) return;
    const { w, last } = drag.current;
    drag.current = null;
    onDrag(null);
    if (Math.abs(last - w) >= 1) onCommit(last);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const step = e.shiftKey ? 48 : 12;
    onCommit(width + (e.key === 'ArrowLeft' ? -step : step));
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`${name} 열 너비 조절 (←/→, 더블클릭 시 기본값)`}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      title="드래그해서 너비 조절 · 더블클릭하면 기본값"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={key}
      onDoubleClick={onReset}
      className="group/rh absolute inset-y-0 right-0 z-20 flex w-2.5 cursor-col-resize touch-none select-none justify-end focus-visible:outline-none"
    >
      <span className="my-2 w-px bg-slate-200 transition-colors group-hover/rh:w-0.5 group-hover/rh:bg-accent-500 group-focus-visible/rh:w-0.5 group-focus-visible/rh:bg-accent-600" />
    </div>
  );
}

export function ProductTable({
  rows,
  category,
  view,
  widths,
  onResize,
  onResetWidth,
  onHistory,
  onEdit,
  onDelete,
}: {
  rows: ProductRow[];
  category: Category;
  view: UnitView;
  /** 사용자가 조절한 열 너비 (없는 열은 기본값, 상품명은 남는 폭) */
  widths: ColumnWidths;
  onResize: (key: ColumnKey, width: number) => void;
  onResetWidth: (key: ColumnKey) => void;
  onHistory: (p: ProductRow) => void;
  onEdit: (p: ProductRow) => void;
  onDelete: (p: ProductRow) => void;
}) {
  const basis = category.unitBasis;
  const showPieces = basis === 'piece' || category.showPieceCount;
  const unitHeader = basis === 'piece' ? `가격/${category.pieceLabel}` : view === '100g' ? '가격/100g' : '가격/kg';
  const fmtUnit = (r: ProductRow) => formatUnit(unitOf(r, basis), basis, category.pieceLabel, view);
  const bestId = rows.find((r) => unitOf(r, basis) != null)?.id;

  const cols: Col[] = [
    { key: 'name', label: '상품명', name: '상품명', className: 'sticky left-0 z-10 bg-slate-50' },
    { key: 'order', label: '주문', name: '주문' },
    { key: 'cutoff', label: '주문 마감', name: '주문 마감', title: '판매자 주문 마감 시각 (KST)' },
    { key: 'delivery', label: '예상 배송', name: '예상 배송' },
    { key: 'weight', label: '중량', name: '중량' },
    ...(showPieces ? [{ key: 'pieces', label: '개수', name: '개수' } as Col] : []),
    { key: 'regular', label: '정상가', name: '정상가', className: 'text-right' },
    { key: 'sale', label: '할인가', name: '할인가', className: 'text-right' },
    { key: 'coupon', label: '쿠폰가', name: '쿠폰가', className: 'text-right' },
    {
      key: 'unit',
      label: `${unitHeader}*`,
      name: unitHeader,
      className: 'bg-accent-50/70 text-right text-accent-800',
      title: '정상가·할인가·적용 가능 쿠폰가 중 최저가 ÷ 중량(또는 개수). 배송비 제외.',
    },
    { key: 'shipping', label: '배송비', name: '배송비' },
    { key: 'status', label: '상태', name: '상태' },
    { key: 'actions', label: '작업', name: '작업', className: 'text-right' },
    { key: 'source', label: '판매처', name: '판매처' },
  ];

  // 상품명 열은 직접 조절하기 전까지 남는 폭을 모두 차지 → 표가 화면 폭을 꽉 채운다
  const wrapRef = useRef<HTMLDivElement>(null);
  const [wrapW, setWrapW] = useState(0);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWrapW(el.clientWidth));
    ro.observe(el);
    setWrapW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const [draft, setDraft] = useState<{ key: ColumnKey; w: number } | null>(null);
  const fixedW = (k: Exclude<ColumnKey, 'name'>) => (draft?.key === k ? clampWidth(k, draft.w) : (widths[k] ?? DEFAULT_COLUMN_WIDTH[k]));
  const othersW = cols.reduce((sum, c) => (c.key === 'name' ? sum : sum + fixedW(c.key)), 0);
  const widthOf = (k: ColumnKey) => {
    if (k !== 'name') return fixedW(k);
    if (draft?.key === 'name') return clampWidth('name', draft.w);
    return widths.name ?? Math.max(MIN_NAME_WIDTH, wrapW > 0 && wrapW < 640 ? 160 : 240, wrapW - othersW);
  };
  const tableW = cols.reduce((sum, c) => sum + widthOf(c.key), 0);

  return (
    <div ref={wrapRef} className="overflow-x-auto">
      <table className={cx('table-fixed border-collapse text-sm', draft && 'select-none')} style={{ width: tableW }}>
        <caption className="sr-only">상품 목록 — 단가는 배송비를 제외한 최저 유효 상품가 기준</caption>
        <colgroup>
          {cols.map((c) => (
            <col key={c.key} style={{ width: widthOf(c.key) }} />
          ))}
        </colgroup>
        <thead className="border-b border-slate-200 bg-slate-50/80">
          <tr>
            {cols.map((c) => (
              <th key={c.key} scope="col" className={cx(th, c.className)} title={c.title ?? c.name}>
                {c.label}
                <ResizeHandle
                  name={c.name}
                  width={widthOf(c.key)}
                  onDrag={(w) => setDraft(w == null ? null : { key: c.key, w })}
                  onCommit={(w) => onResize(c.key, w)}
                  onReset={() => onResetWidth(c.key)}
                />
              </th>
            ))}
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
                <td className={cx(td, 'sticky left-0 z-[1] whitespace-normal break-words', isBest ? 'bg-[#f3fbf7]' : 'bg-white group-hover:bg-slate-50')}>
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
                  {r.orderStatusReason && <div className="mt-1 whitespace-normal text-[11px] leading-4 text-red-700">{r.orderStatusReason}</div>}
                </td>
                <td className={cx(td, 'num text-slate-700')}>{r.orderCutoff ?? '-'}</td>
                <td className={cx(td, 'whitespace-normal')}>
                  <div className="num font-medium text-slate-800">{deliveryLabel(r.deliveryLeadDays)}</div>
                  {r.deliveryNote && (
                    <div className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-slate-500" title={r.deliveryNote}>
                      {r.deliveryNote.replace(/^(당일|D\+\d+)\s*·\s*/, '')}
                    </div>
                  )}
                </td>
                <td className={cx(td, 'num')}>
                  <div className="truncate" title={e.rawWeightText ?? undefined}>
                    {e.rawWeightText ?? '-'}
                  </div>
                  <div className={cx('truncate text-xs', e.weightKg == null && basis === 'kg' ? 'text-amber-700' : 'text-slate-500')}>
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
                <td className={cx(td, 'num whitespace-normal text-slate-700')}>{shippingCell(r)}</td>
                <td className={td}>
                  <span className={cx('chip', st.tone)} title={st.title}>
                    {r.sourceStatus === 'stale' && <TriangleAlert size={11} />}
                    {st.label}
                  </span>
                  {r.reviewNotes.length > 0 && (
                    <div className="mt-1 truncate text-[11px] text-slate-500" title={r.reviewNotes.join('\n')}>
                      {r.reviewNotes[0]}
                    </div>
                  )}
                </td>
                <td className={cx(td, 'text-right')}>
                  <div className="flex flex-wrap justify-end gap-0.5">
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
                    <div className="mt-1 truncate text-xs text-slate-500" title={e.seller}>
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
