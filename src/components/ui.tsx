import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import type { JobStatus, PriceKind, ProviderState, Source } from '../types';

export function cx(...c: Array<string | false | null | undefined>): string {
  return c.filter(Boolean).join(' ');
}

export const SOURCE_LABEL: Record<Source, string> = { foodspring: '식봄', naver: '네이버', coupang: '쿠팡', manual: '수동 입력' };

export function SourceBadge({ source }: { source: Source }) {
  const tone: Record<Source, string> = {
    foodspring: 'bg-orange-50 text-orange-700 ring-orange-200',
    naver: 'bg-green-50 text-green-700 ring-green-200',
    coupang: 'bg-sky-50 text-sky-700 ring-sky-200',
    manual: 'bg-slate-100 text-slate-600 ring-slate-200',
  };
  return <span className={cx('chip ring-1 ring-inset', tone[source])}>{SOURCE_LABEL[source]}</span>;
}

export const JOB_LABEL: Record<JobStatus, string> = {
  queued: '대기 중',
  running: '수집 중',
  success: '성공',
  partial: '일부 실패',
  failed: '실패',
  cancelled: '취소됨',
};

export function JobBadge({ status }: { status: JobStatus | null }) {
  if (!status) return <span className="chip bg-slate-100 text-slate-500">수집 기록 없음</span>;
  const tone: Record<JobStatus, string> = {
    queued: 'bg-amber-50 text-amber-700',
    running: 'bg-blue-50 text-blue-700',
    success: 'bg-accent-50 text-accent-700',
    partial: 'bg-orange-50 text-orange-700',
    failed: 'bg-red-50 text-red-700',
    cancelled: 'bg-slate-100 text-slate-500',
  };
  return (
    <span className={cx('chip', tone[status])}>
      {status === 'running' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-600" aria-hidden />}
      {JOB_LABEL[status]}
    </span>
  );
}

export const PROVIDER_LABEL: Record<ProviderState, string> = {
  available: '사용 가능',
  needs_setup: '인증 또는 권한 설정 필요',
  temporary_error: '일시 오류',
  restricted: '연동 제한',
};

export function ProviderBadge({ state }: { state: ProviderState }) {
  const tone: Record<ProviderState, string> = {
    available: 'bg-accent-50 text-accent-700',
    needs_setup: 'bg-amber-50 text-amber-700',
    temporary_error: 'bg-red-50 text-red-700',
    restricted: 'bg-slate-100 text-slate-600',
  };
  return <span className={cx('chip', tone[state])}>{PROVIDER_LABEL[state]}</span>;
}

export function PriceKindBadge({ kind }: { kind: PriceKind | null }) {
  if (!kind) return null;
  const label = { regular: '정상가', sale: '할인가', coupon: '쿠폰가' }[kind];
  return <span className="chip bg-slate-100 text-slate-500">{label} 기준</span>;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEscape(open, onClose);
  useEffect(() => {
    if (open) ref.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus();
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4" onMouseDown={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className={cx('card flex max-h-[92vh] w-full flex-col rounded-b-none shadow-xl sm:rounded-xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <h2 id={id} className="text-[15px] font-semibold">
            {title}
          </h2>
          <button className="btn-ghost btn-sm -mr-2" onClick={onClose} aria-label="닫기">
            <X size={16} />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 'max-w-2xl',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/30" onMouseDown={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        className={cx('flex h-full w-full flex-col bg-white shadow-xl', width)}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold leading-6">{title}</h2>
            {subtitle && <div className="mt-1 text-[13px] text-slate-500">{subtitle}</div>}
          </div>
          <button className="btn-ghost btn-sm -mr-2 shrink-0" onClick={onClose} aria-label="닫기">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</div>}
      </aside>
    </div>
  );
}

function useEscape(active: boolean, fn: () => void) {
  useEffect(() => {
    if (!active) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && fn();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [active, fn]);
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = 'sm',
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
  label: string;
  size?: 'sm' | 'xs';
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-md font-medium transition-colors',
            size === 'sm' ? 'h-7 px-2.5 text-[13px]' : 'h-6 px-2 text-xs',
            value === o.value ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-800',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-500">{icon}</div>
      <p className="text-[15px] font-semibold text-slate-800">{title}</p>
      {children && <div className="mt-1.5 max-w-md text-[13px] leading-5 text-slate-500">{children}</div>}
    </div>
  );
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-4" aria-busy="true" aria-label="불러오는 중">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton h-9 rounded-md" />
      ))}
    </div>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx('relative h-5 w-9 shrink-0 rounded-full transition-colors', checked ? 'bg-accent-600' : 'bg-slate-300')}
    >
      <span className={cx('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
    </button>
  );
}
