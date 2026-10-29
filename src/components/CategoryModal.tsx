import { X } from 'lucide-react';
import { useState } from 'react';
import type { Category, CrawlSource, UnitBasis } from '../types';
import type { CategoryInput } from '../lib/repo/types';
import { Field, Modal, SOURCE_LABEL, Segmented, Toggle } from './ui';

const SOURCES: CrawlSource[] = ['foodspring', 'naver', 'coupang'];
const PIECE_LABELS = ['개', '알', '입', '구', '포기', '단', '송이'];

function ChipInput({
  id,
  values,
  onChange,
  placeholder,
  max,
  tone = 'slate',
}: {
  id: string;
  values: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  max: number;
  tone?: 'slate' | 'red';
}) {
  const [text, setText] = useState('');
  const add = () => {
    const v = text.trim();
    setText('');
    if (!v || values.includes(v) || values.length >= max) return;
    onChange([...values, v]);
  };
  return (
    <>
      <div className="flex gap-2">
        <input
          id={id}
          className="input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
        />
        <button className="btn-secondary" onClick={add} type="button">
          추가
        </button>
      </div>
      {values.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {values.map((k) => (
            <li key={k} className={`chip py-1 text-[12px] ${tone === 'red' ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-700'}`}>
              {k}
              <button aria-label={`${k} 삭제`} onClick={() => onChange(values.filter((x) => x !== k))} className="opacity-60 hover:opacity-100">
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** 품목 탭 생성/수정: 이름, 검색어·제외 키워드, 단가 기준(kg/개수), 수집 제공처, 추적 상품 URL */
export function CategoryModal({
  open,
  initial,
  busy,
  onSave,
  onClose,
}: {
  open: boolean;
  initial: Category | null;
  busy: boolean;
  onSave: (input: CategoryInput) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [keywords, setKeywords] = useState<string[]>(initial?.keywords ?? []);
  const [exclude, setExclude] = useState<string[]>(initial?.excludeKeywords ?? []);
  const [sources, setSources] = useState<CrawlSource[]>(initial?.enabledSources ?? ['foodspring']);
  const [basis, setBasis] = useState<UnitBasis>(initial?.unitBasis ?? 'kg');
  const [pieceLabel, setPieceLabel] = useState(initial?.pieceLabel ?? '개');
  const [showPieces, setShowPieces] = useState(initial?.showPieceCount ?? false);
  const [urls, setUrls] = useState((initial?.trackedUrls ?? []).join('\n'));
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const n = name.trim().normalize('NFC');
    if (!n) return setError('품목 이름을 입력하세요.');
    if (n.length > 40) return setError('품목 이름은 40자 이내로 입력하세요.');
    const trackedUrls = urls
      .split(/\s+/)
      .map((u) => u.trim())
      .filter(Boolean);
    if (trackedUrls.some((u) => !/^https?:\/\//.test(u))) return setError('상품 URL 은 http(s):// 로 시작해야 합니다.');
    onSave({
      name: n,
      keywords: keywords.length ? keywords : [n],
      excludeKeywords: exclude,
      enabledSources: sources,
      trackedUrls,
      unitBasis: basis,
      pieceLabel,
      showPieceCount: basis === 'piece' || showPieces,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? '품목 설정 · 검색어 관리' : '품목 추가'}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            취소
          </button>
          <button className="btn-primary" onClick={submit} disabled={busy}>
            {busy ? '저장 중…' : '저장'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="품목 이름" htmlFor="cat-name">
          <input id="cat-name" className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="예: 마늘" />
        </Field>
        <Field label="검색어" hint="검색어마다 정렬 4종(정확도·낮은 가격·높은 가격·할인율)으로 검색해 최대 32개씩 모읍니다. 같은 상품은 한 번만 저장됩니다." htmlFor="cat-kw">
          <ChipInput id="cat-kw" values={keywords} onChange={setKeywords} placeholder="예: 깐마늘 — 입력 후 Enter" max={20} />
        </Field>
        <Field label="제외 키워드" hint="상품명에 이 단어가 들어가면 수집하지 않고 표에서도 숨깁니다. 예: 냉동, 과자, 다진" htmlFor="cat-ex">
          <ChipInput id="cat-ex" values={exclude} onChange={setExclude} placeholder="예: 냉동 — 입력 후 Enter" max={30} tone="red" />
        </Field>

        <fieldset className="rounded-lg border border-slate-200 p-3">
          <legend className="px-1 text-[13px] font-medium text-slate-700">단가 기준</legend>
          <div className="flex flex-wrap items-center gap-3">
            <Segmented<UnitBasis>
              label="단가 기준"
              value={basis}
              onChange={setBasis}
              options={[
                { value: 'kg', label: '중량 (원/kg)' },
                { value: 'piece', label: '개수 (원/개)' },
              ]}
            />
            <label className="flex items-center gap-1.5 text-[13px] text-slate-600">
              개수 단위
              <select className="input h-8 w-20" value={pieceLabel} onChange={(e) => setPieceLabel(e.target.value)} aria-label="개수 단위">
                {PIECE_LABELS.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="mt-2.5 flex items-center gap-2 text-[13px] text-slate-600">
            <Toggle checked={basis === 'piece' || showPieces} onChange={setShowPieces} label="개수 열 표시" />
            중량 옆에 개수 열 표시 (예: 배추 3입)
          </label>
          <p className="mt-1.5 text-xs text-slate-500">계란처럼 개수로 사고파는 품목은 ‘개수’를 고르고 단위를 ‘알’로 두면 원/알로 비교합니다.</p>
        </fieldset>

        <fieldset>
          <legend className="label">수집 제공처</legend>
          <div className="flex flex-wrap gap-3">
            {SOURCES.map((s) => (
              <label key={s} className="flex items-center gap-1.5 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-accent-700"
                  checked={sources.includes(s)}
                  onChange={(e) => setSources(e.target.checked ? [...sources, s] : sources.filter((x) => x !== s))}
                />
                {SOURCE_LABEL[s]}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">네이버·쿠팡은 자동 수집 경로가 제한되어 ‘연동 제한’으로 기록됩니다. 수동 등록/CSV 가져오기를 이용하세요.</p>
        </fieldset>
        <Field label="추적할 상품 URL (선택, 줄마다 1개)" hint="식봄 상세 페이지(…/goods/detail/번호)는 자동 수집됩니다." htmlFor="cat-urls">
          <textarea id="cat-urls" className="input h-20 py-2" value={urls} onChange={(e) => setUrls(e.target.value)} placeholder="https://www.foodspring.co.kr/goods/detail/…" />
        </Field>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
