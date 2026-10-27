import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import type { ChangeSummary } from '../lib/domain/history';
import { formatKrw, formatKstShort, formatPct, formatSignedKrw, formatUnitPrice } from '../lib/domain/format';
import { cx } from './ui';

function Delta({ s, unit }: { s: ChangeSummary; unit: boolean }) {
  if (s.delta == null) return <span className="text-slate-400">-</span>;
  const dir = s.delta < 0 ? 'down' : s.delta > 0 ? 'up' : 'flat';
  const Icon = dir === 'down' ? ArrowDownRight : dir === 'up' ? ArrowUpRight : Minus;
  // 색상만으로 구분하지 않도록 아이콘 + 부호 텍스트를 함께 표시
  return (
    <span className={cx('inline-flex items-center gap-0.5 font-semibold', dir === 'down' && 'text-blue-700', dir === 'up' && 'text-red-700', dir === 'flat' && 'text-slate-600')}>
      <Icon size={14} aria-hidden />
      {formatSignedKrw(s.delta, unit ? '/kg' : '')} ({formatPct(s.pct)})
    </span>
  );
}

export function PriceChangeSummary({ price, unit }: { price: ChangeSummary; unit: ChangeSummary }) {
  const rows: Array<{ label: string; s: ChangeSummary; isUnit: boolean }> = [
    { label: '가격/중량', s: unit, isUnit: true },
    { label: '최저 유효 상품가', s: price, isUnit: false },
  ];
  const fmt = (v: number | null, isUnit: boolean) => (isUnit ? formatUnitPrice(v) : formatKrw(v));
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {rows.map(({ label, s, isUnit }) => (
        <div key={label} className="rounded-lg border border-slate-200 p-3">
          <div className="text-xs font-medium text-slate-500">{label}</div>
          <div className="num mt-1 text-lg font-semibold leading-6">{fmt(s.last, isUnit)}</div>
          <div className="num mt-0.5 text-[13px]">
            <span className="text-slate-500">기간 첫 값 대비 </span>
            <Delta s={s} unit={isUnit} />
          </div>
          <dl className="num mt-2 grid grid-cols-3 gap-1 text-[12px]">
            <div>
              <dt className="text-slate-500">첫 값{s.firstAt ? ` (${formatKstShort(s.firstAt).slice(0, 5)})` : ''}</dt>
              <dd>{fmt(s.first, isUnit)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">기간 최저</dt>
              <dd>{fmt(s.min, isUnit)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">기간 최고</dt>
              <dd>{fmt(s.max, isUnit)}</dd>
            </div>
          </dl>
        </div>
      ))}
    </div>
  );
}
