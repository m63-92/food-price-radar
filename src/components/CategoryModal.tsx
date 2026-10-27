import { X } from 'lucide-react';
import { useState } from 'react';
import type { Category, CrawlSource } from '../types';
import type { CategoryInput } from '../lib/repo/types';
import { Field, Modal, SOURCE_LABEL } from './ui';

const SOURCES: CrawlSource[] = ['foodspring', 'naver', 'coupang'];

/** 품목 탭 생성/수정: 이름, 검색어 묶음, 수집 제공처, 추적 상품 URL */
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
  const [kw, setKw] = useState('');
  const [sources, setSources] = useState<CrawlSource[]>(initial?.enabledSources ?? ['foodspring']);
  const [urls, setUrls] = useState((initial?.trackedUrls ?? []).join('\n'));
  const [error, setError] = useState<string | null>(null);

  const addKw = () => {
    const v = kw.trim();
    if (!v) return;
    if (keywords.includes(v)) setError('이미 등록된 검색어입니다.');
    else if (keywords.length >= 20) setError('검색어는 20개까지 등록할 수 있습니다.');
    else {
      setKeywords([...keywords, v]);
      setError(null);
    }
    setKw('');
  };

  const submit = () => {
    if (!name.trim()) return setError('품목 이름을 입력하세요.');
    if (name.trim().length > 40) return setError('품목 이름은 40자 이내로 입력하세요.');
    const trackedUrls = urls
      .split(/\s+/)
      .map((u) => u.trim())
      .filter(Boolean);
    if (trackedUrls.some((u) => !/^https?:\/\//.test(u))) return setError('상품 URL 은 http(s):// 로 시작해야 합니다.');
    onSave({ name: name.trim(), keywords: keywords.length ? keywords : [name.trim()], enabledSources: sources, trackedUrls });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? '품목 탭 · 검색어 관리' : '품목 추가'}
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
        <Field label="검색어 묶음" hint="예: 깐마늘, 통마늘, 마늘 1kg — 검색어마다 따로 검색하며, 같은 상품은 제공처 상품 ID로 한 번만 저장됩니다." htmlFor="cat-kw">
          <div className="flex gap-2">
            <input
              id="cat-kw"
              className="input"
              value={kw}
              onChange={(e) => setKw(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  addKw();
                }
              }}
              placeholder="검색어 입력 후 Enter"
            />
            <button className="btn-secondary" onClick={addKw} type="button">
              추가
            </button>
          </div>
          {keywords.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {keywords.map((k) => (
                <li key={k} className="chip bg-slate-100 py-1 text-[12px] text-slate-700">
                  {k}
                  <button aria-label={`${k} 삭제`} onClick={() => setKeywords(keywords.filter((x) => x !== k))} className="text-slate-400 hover:text-slate-700">
                    <X size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Field>
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
          <p className="mt-1 text-xs text-slate-500">네이버·쿠팡은 현재 자동 수집 경로가 제한되어 있어 선택해도 ‘연동 제한’으로 기록됩니다. 수동 등록/CSV 가져오기를 이용하세요.</p>
        </fieldset>
        <Field label="추적할 상품 URL (선택, 줄마다 1개)" hint="식봄 상세 페이지(…/goods/detail/번호)는 자동 수집됩니다. 다른 제공처 URL 은 ‘+ 상품 추가’로 수동 등록하세요." htmlFor="cat-urls">
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
