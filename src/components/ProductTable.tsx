import { ExternalLink, LineChart, Lock, Pencil, Trash2, TriangleAlert } from 'lucide-react';
import type { ProductRow, ProductSourceStatus } from '../types';
import { FIELD_LABEL } from '../lib/domain/effective';
import { formatKrw, formatKst, formatUnitPrice, shippingLabel, type UnitBasis } from '../lib/domain/format';
import { formatWeightKg } from '../lib/domain/weight';
import { PriceKindBadge, SourceBadge, cx } from './ui';

const STATUS: Record<ProductSourceStatus, { label: string; tone: string; title: string }> = {
  ok: { label: '성공', tone: 'bg-accent-50 text-accent-700', title: '마지막 수집에 성공했습니다.' },
  stale: { label: '수집 실패', tone: 'bg-red-50 text-red-700', title: '최근 수집이 실패해 마지막 정상값을 표시 중입니다.' },
  needs_review: { label: '검토 필요', tone: 'bg-amber-50 text-amber-700', title: '중량/가격 추출 신뢰도가 낮습니다.' },
  manual: { label: '수동', tone: 'bg-slate-100 text-slate-600', title: '관리자가 직접 입력한 상품입니다.' },
};

const th = 'px-3 py-2.5 text-left text-[12px] font-semibold text-slate-500 whitespace-nowrap';
const td = 'px-3 py-2.5 align-top whitespace-nowrap';

export function ProductTable({
  rows,
  basis,
  onHistory,
  onEdit,
  onDelete,
}: {
  rows: ProductRow[];
  basis: UnitBasis;
  onHistory: (p: ProductRow) => void;
  onEdit: (p: ProductRow) => void;
  onDelete: (p: ProductRow) => void;
}) {
  const bestId = rows.find((r) => r.unitPriceKrwPerKg != null)?.id;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1080px] border-collapse text-sm">
        <caption className="sr-only">상품 목록 — 가격/중량은 배송비를 제외한 최저 유효 상품가 기준</caption>
        <thead className="border-b border-slate-200 bg-slate-50/80">
          <tr>
            <th scope="col" className={cx(th, 'sticky left-0 z-10 min-w-[170px] bg-slate-50 md:min-w-[240px]')}>
              상품명
            </th>
            <th scope="col" className={th}>판매처</th>
            <th scope="col" className={th}>중량</th>
            <th scope="col" className={cx(th, 'text-right')}>정상가</th>
            <th scope="col" className={cx(th, 'text-right')}>할인가</th>
            <th scope="col" className={cx(th, 'text-right')}>쿠폰가</th>
            <th scope="col" className={cx(th, 'bg-accent-50/70 text-right text-accent-800')} title="정상가·할인가·적용 가능 쿠폰가 중 최저가 ÷ 총중량. 배송비 제외.">
              가격/중량*
            </th>
            <th scope="col" className={th}>택배비</th>
            <th scope="col" className={th}>최종 확인</th>
            <th scope="col" className={th}>상태</th>
            <th scope="col" className={cx(th, 'text-right')}>작업</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => {
            const e = r.effective;
            const locked = (Object.entries(r.overrides) as Array<[keyof typeof FIELD_LABEL, { isLocked: boolean }]>).filter(([, o]) => o);
            const couponExcluded = e.couponPriceKrw != null && e.couponEligible !== true;
            const isBest = r.id === bestId;
            const st = STATUS[r.sourceStatus];
            return (
              <tr key={r.id} className={cx('group', isBest ? 'bg-accent-50/40' : 'hover:bg-slate-50/70')}>
                <td className={cx(td, 'sticky left-0 z-[1] max-w-[180px] whitespace-normal md:max-w-[340px]', isBest ? 'bg-[#f3fbf7]' : 'bg-white group-hover:bg-slate-50')}>
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
                  {/* 좁은 화면에서는 가격/중량 열이 가로 스크롤 밖에 있으므로 고정된 상품명 칸에도 강조 표시 */}
                  <div className="num mt-1.5 text-[13px] font-semibold text-accent-800 md:hidden">
                    가격/중량 {formatUnitPrice(r.unitPriceKrwPerKg, basis)}
                  </div>
                </td>
                <td className={td}>
                  <SourceBadge source={r.source} />
                  {e.seller && <div className="mt-1 max-w-[120px] truncate text-xs text-slate-500" title={e.seller}>{e.seller}</div>}
                </td>
                <td className={cx(td, 'num')}>
                  <div className="max-w-[140px] truncate" title={e.rawWeightText ?? undefined}>{e.rawWeightText ?? '-'}</div>
                  <div className={cx('text-xs', e.weightKg == null ? 'text-amber-700' : 'text-slate-500')}>
                    {e.weightKg == null ? '총중량 확인 필요' : `= ${formatWeightKg(e.weightKg)}`}
                  </div>
                </td>
                <td className={cx(td, 'num text-right text-slate-700')}>{formatKrw(e.regularPriceKrw)}</td>
                <td className={cx(td, 'num text-right text-slate-700')}>{formatKrw(e.salePriceKrw)}</td>
                <td className={cx(td, 'num text-right')}>
                  <span className={couponExcluded ? 'text-slate-400 line-through decoration-slate-300' : 'text-slate-700'}>{formatKrw(e.couponPriceKrw)}</span>
                  {couponExcluded && (
                    <div className="mt-0.5 text-right">
                      <span className="chip bg-slate-100 text-slate-500" title={e.couponConditions ?? '쿠폰 적용 조건을 확인할 수 없어 최저가 계산에서 제외'}>
                        조건 미확인·제외
                      </span>
                    </div>
                  )}
                </td>
                <td className={cx(td, 'num bg-accent-50/50 text-right')}>
                  <div className={cx('text-[15px] font-semibold', r.unitPriceKrwPerKg == null ? 'text-slate-400' : 'text-slate-900')}>
                    {formatUnitPrice(r.unitPriceKrwPerKg, basis)}
                  </div>
                  <div className="mt-0.5 flex justify-end">
                    <PriceKindBadge kind={r.unitPriceKrwPerKg != null ? r.effectivePriceKind : null} />
                  </div>
                </td>
                <td className={cx(td, 'num text-slate-700')}>{shippingLabel(e.shippingStatus, e.shippingPriceKrw)}</td>
                <td className={cx(td, 'num text-slate-600')}>{formatKst(r.lastSuccessAt)}</td>
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
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
