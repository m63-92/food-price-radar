import { Lock, RotateCcw, Unlock } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { EditableField, EditableFields, ProductRow, Source } from '../types';
import { EDITABLE_FIELDS, FIELD_LABEL, derive } from '../lib/domain/effective';
import { formatKrw, formatUnitPrice, parseKrwInput, shippingLabel } from '../lib/domain/format';
import { PRICE_KIND_LABEL, PRICE_WARNING_LABEL } from '../lib/domain/pricing';
import { parseWeight } from '../lib/domain/weight';
import type { FieldChange } from '../lib/repo/types';
import { Drawer, SOURCE_LABEL, cx } from './ui';

const EMPTY: EditableFields = {
  title: '',
  seller: null,
  productOption: null,
  sourceUrl: '',
  rawWeightText: null,
  weightKg: null,
  pieceCount: null,
  regularPriceKrw: null,
  salePriceKrw: null,
  couponPriceKrw: null,
  couponEligible: null,
  couponConditions: null,
  shippingStatus: 'unknown',
  shippingPriceKrw: null,
  availability: 'unknown',
};

const PRICE_FIELDS: EditableField[] = ['regularPriceKrw', 'salePriceKrw', 'couponPriceKrw', 'shippingPriceKrw'];

function display(f: EditableField, v: unknown): string {
  if (v == null || v === '') return '-';
  if (PRICE_FIELDS.includes(f)) return formatKrw(v as number);
  if (f === 'couponEligible') return v ? '적용 가능' : '적용 불가';
  if (f === 'shippingStatus') return shippingLabel(v as EditableFields['shippingStatus'], null).replace(' (금액 미확인)', '');
  if (f === 'availability') return { in_stock: '판매 중', out_of_stock: '품절', unknown: '미확인' }[v as string] ?? String(v);
  return String(v);
}

export interface EditResult {
  mode: 'add' | 'edit';
  source?: Source;
  fields: EditableFields;
  changes: Partial<Record<EditableField, FieldChange>>;
  revert: EditableField[];
}

export function ProductEditDrawer({
  open,
  product,
  busy,
  onSave,
  onClose,
}: {
  open: boolean;
  product: ProductRow | null;
  busy: boolean;
  onSave: (r: EditResult) => void;
  onClose: () => void;
}) {
  const isAdd = product == null;
  const base = product?.effective ?? EMPTY;
  const [form, setForm] = useState<EditableFields>(base);
  const [source, setSource] = useState<Source>('manual');
  const [locks, setLocks] = useState<Partial<Record<EditableField, boolean>>>(() =>
    Object.fromEntries(Object.entries(product?.overrides ?? {}).map(([k, o]) => [k, o!.isLocked])),
  );
  const [revert, setRevert] = useState<EditableField[]>([]);
  const [weightTouched, setWeightTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = useMemo(() => derive(form), [form]);
  const crawled = product != null && !product.isManual;

  const set = <K extends EditableField>(k: K, v: EditableFields[K]) => {
    setForm((f) => {
      const next = { ...f, [k]: v };
      if (k === 'rawWeightText' && !weightTouched) next.weightKg = parseWeight(v as string | null).kg;
      return next;
    });
    setRevert((r) => r.filter((x) => x !== k));
  };

  const changedFields = EDITABLE_FIELDS.filter((f) => form[f] !== base[f] && !revert.includes(f));

  const submit = () => {
    if (!form.title.trim()) return setError('상품명을 입력하세요.');
    if (!/^https?:\/\//.test(form.sourceUrl)) return setError('상품 URL 은 http(s):// 로 시작해야 합니다.');
    if (form.weightKg != null && !(form.weightKg > 0)) return setError('총중량은 0보다 커야 합니다. 모르면 비워 두세요.');
    if (form.pieceCount != null && !(form.pieceCount > 0)) return setError('개수는 0보다 커야 합니다. 모르면 비워 두세요.');
    if (form.shippingStatus !== 'paid' && form.shippingPriceKrw != null) return setError('택배비 금액은 ‘유료’일 때만 입력할 수 있습니다.');
    const changes: Partial<Record<EditableField, FieldChange>> = {};
    for (const f of changedFields) changes[f] = { value: form[f], locked: locks[f] ?? true };
    // 값은 그대로 두고 고정 여부만 바꾼 경우
    for (const [f, o] of Object.entries(product?.overrides ?? {}) as Array<[EditableField, { value: unknown; isLocked: boolean }]>) {
      if (!changes[f] && !revert.includes(f) && locks[f] !== undefined && locks[f] !== o.isLocked) changes[f] = { value: o.value, locked: locks[f]! };
    }
    setError(null);
    onSave({ mode: isAdd ? 'add' : 'edit', source, fields: form, changes, revert });
  };

  const fieldRow = (f: EditableField, input: React.ReactNode, wide = false) => {
    const ov = product?.overrides[f];
    const isChanged = changedFields.includes(f);
    const showLock = crawled && (isChanged || ov);
    const locked = locks[f] ?? true;
    return (
      <div className={cx(wide && 'sm:col-span-2')}>
        <div className="mb-1 flex items-center justify-between gap-2">
          <label className="text-[13px] font-medium text-slate-700" htmlFor={`f-${f}`}>
            {FIELD_LABEL[f]}
          </label>
          <div className="flex items-center gap-1">
            {showLock && (
              <button
                type="button"
                className={cx('chip', locked ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600')}
                onClick={() => setLocks((l) => ({ ...l, [f]: !locked }))}
                aria-pressed={locked}
                title={locked ? '다음 자동 수집에서도 이 값을 유지합니다' : '다음 자동 수집 결과로 대체됩니다'}
              >
                {locked ? <Lock size={10} /> : <Unlock size={10} />} {locked ? '수동 값 고정' : '고정 안 함'}
              </button>
            )}
            {crawled && ov && !revert.includes(f) && (
              <button
                type="button"
                className="chip bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50"
                onClick={() => {
                  setRevert((r) => [...r, f]);
                  setForm((x) => ({ ...x, [f]: product!.raw[f] }));
                }}
                title="고정을 해제하고 최신 자동 수집값을 사용합니다"
              >
                <RotateCcw size={10} /> 자동 값으로 복원
              </button>
            )}
          </div>
        </div>
        {input}
        {crawled && (
          <p className="mt-1 text-[11px] text-slate-500">
            자동 수집값: <span className="num">{display(f, product!.raw[f])}</span>
            {revert.includes(f) && <span className="ml-1 font-medium text-accent-700">· 저장 시 복원</span>}
          </p>
        )}
      </div>
    );
  };

  const priceInput = (f: 'regularPriceKrw' | 'salePriceKrw' | 'couponPriceKrw' | 'shippingPriceKrw') => (
    <input
      id={`f-${f}`}
      inputMode="numeric"
      className="input num text-right"
      placeholder="-"
      value={form[f] == null ? '' : form[f]!.toLocaleString('ko-KR')}
      onChange={(e) => set(f, parseKrwInput(e.target.value))}
    />
  );

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isAdd ? '상품 수동 추가' : '상품 정보 수정'}
      subtitle={isAdd ? '자동 수집이 제한된 제공처(네이버·쿠팡 등) 상품을 직접 등록합니다.' : product?.isManual ? '수동 등록 상품' : '자동 수집 상품 — 수정한 필드는 관리자 확정값(override)으로 저장됩니다.'}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            취소
          </button>
          <button className="btn-primary" onClick={submit} disabled={busy || (!isAdd && changedFields.length === 0 && revert.length === 0 && !Object.keys(locks).some((k) => locks[k as EditableField] !== product?.overrides[k as EditableField]?.isLocked))}>
            {busy ? '저장 중…' : '저장'}
          </button>
        </>
      }
    >
      <div className="mb-5 grid grid-cols-3 gap-2 rounded-lg border border-accent-200 bg-accent-50/60 p-3 text-[13px]">
        <div>
          <div className="text-slate-500">최저 유효 상품가</div>
          <div className="num mt-0.5 font-semibold">{formatKrw(preview.bestPriceKrw)}</div>
          <div className="text-[11px] text-slate-500">{preview.kind ? `${PRICE_KIND_LABEL[preview.kind]} 기준` : ''}</div>
        </div>
        <div>
          <div className="text-slate-500">단가</div>
          <div className="num mt-0.5 text-[15px] font-semibold text-accent-800">{formatUnitPrice(preview.unitPriceKrwPerKg)}</div>
          {preview.unitPriceKrwPerPiece != null && <div className="num text-[12px] text-slate-600">개당 {formatKrw(preview.unitPriceKrwPerPiece)}</div>}
        </div>
        <div className="text-[11px] leading-4 text-slate-500">
          배송비는 단가에 포함하지 않습니다.
          {preview.warnings.map((w) => (
            <div key={w} className="mt-1 text-amber-700">
              {PRICE_WARNING_LABEL[w]}
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {isAdd && (
          <div className="sm:col-span-2">
            <label className="label" htmlFor="f-source">
              제공처
            </label>
            <select id="f-source" className="input" value={source} onChange={(e) => setSource(e.target.value as Source)}>
              {(['manual', 'foodspring', 'naver', 'coupang'] as Source[]).map((s) => (
                <option key={s} value={s}>
                  {SOURCE_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
        )}
        {fieldRow('title', <input id="f-title" className="input" value={form.title} onChange={(e) => set('title', e.target.value)} />, true)}
        {fieldRow('sourceUrl', <input id="f-sourceUrl" className="input" value={form.sourceUrl} onChange={(e) => set('sourceUrl', e.target.value)} placeholder="https://" />, true)}
        {fieldRow('seller', <input id="f-seller" className="input" value={form.seller ?? ''} onChange={(e) => set('seller', e.target.value || null)} />)}
        {fieldRow('productOption', <input id="f-productOption" className="input" value={form.productOption ?? ''} onChange={(e) => set('productOption', e.target.value || null)} />)}
        {fieldRow('rawWeightText', <input id="f-rawWeightText" className="input" value={form.rawWeightText ?? ''} onChange={(e) => set('rawWeightText', e.target.value || null)} placeholder="예: 500g × 2봉" />)}
        {fieldRow(
          'weightKg',
          <input
            id="f-weightKg"
            inputMode="decimal"
            className="input num text-right"
            placeholder="-"
            value={form.weightKg ?? ''}
            onChange={(e) => {
              setWeightTouched(true);
              const v = e.target.value.trim();
              set('weightKg', v === '' ? null : Number(v));
            }}
          />,
        )}
        {fieldRow(
          'pieceCount',
          <input
            id="f-pieceCount"
            inputMode="numeric"
            className="input num text-right"
            placeholder="-"
            value={form.pieceCount ?? ''}
            onChange={(e) => {
              const v = e.target.value.trim();
              set('pieceCount', v === '' ? null : Number(v));
            }}
          />,
        )}
        <div className="hidden sm:block" />
        {fieldRow('regularPriceKrw', priceInput('regularPriceKrw'))}
        {fieldRow('salePriceKrw', priceInput('salePriceKrw'))}
        {fieldRow('couponPriceKrw', priceInput('couponPriceKrw'))}
        {fieldRow(
          'couponEligible',
          <select
            id="f-couponEligible"
            className="input"
            value={form.couponEligible == null ? '' : String(form.couponEligible)}
            onChange={(e) => set('couponEligible', e.target.value === '' ? null : e.target.value === 'true')}
          >
            <option value="">조건 미확인 (최저가 제외)</option>
            <option value="true">적용 가능 확인됨</option>
            <option value="false">적용 불가</option>
          </select>,
        )}
        {fieldRow('couponConditions', <input id="f-couponConditions" className="input" value={form.couponConditions ?? ''} onChange={(e) => set('couponConditions', e.target.value || null)} placeholder="예: 첫 구매, 5만원 이상" />, true)}
        {fieldRow(
          'shippingStatus',
          <select id="f-shippingStatus" className="input" value={form.shippingStatus} onChange={(e) => set('shippingStatus', e.target.value as EditableFields['shippingStatus'])}>
            <option value="unknown">미확인 (-)</option>
            <option value="free">무료</option>
            <option value="paid">유료</option>
          </select>,
        )}
        {fieldRow('shippingPriceKrw', priceInput('shippingPriceKrw'))}
        {fieldRow(
          'availability',
          <select id="f-availability" className="input" value={form.availability} onChange={(e) => set('availability', e.target.value as EditableFields['availability'])}>
            <option value="unknown">미확인</option>
            <option value="in_stock">판매 중</option>
            <option value="out_of_stock">품절</option>
          </select>,
        )}
      </div>
      {error && (
        <p role="alert" className="mt-4 text-sm text-red-600">
          {error}
        </p>
      )}
    </Drawer>
  );
}
