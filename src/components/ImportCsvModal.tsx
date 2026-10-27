import { useState } from 'react';
import { IMPORT_COLUMNS, parseImportCsv, toCsv, downloadText, type ImportRow } from '../lib/domain/csv';
import { derive } from '../lib/domain/effective';
import { formatUnitPrice } from '../lib/domain/format';
import { Modal, SOURCE_LABEL } from './ui';

/** 수집 제한 제공처(네이버·쿠팡) 가격을 관리자가 확인 후 CSV 로 일괄 등록 */
export function ImportCsvModal({ open, busy, onImport, onClose }: { open: boolean; busy: boolean; onImport: (rows: ImportRow[]) => void; onClose: () => void }) {
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const r = parseImportCsv(await f.text());
    setRows(r.rows);
    setErrors(r.errors);
  };

  const template = () =>
    downloadText(
      'food-price-radar-import-template.csv',
      toCsv([...IMPORT_COLUMNS], [['naver', '국산 깐마늘 1kg', 'https://example.invalid/product/1', '판매자명', '', '1kg', '', '12000', '9900', '', '', '', 'paid', '3000']]),
    );

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="CSV 가져오기 (수동 등록)"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            취소
          </button>
          <button className="btn-primary" disabled={busy || rows.length === 0} onClick={() => onImport(rows)}>
            {busy ? '등록 중…' : `${rows.length}개 상품 등록`}
          </button>
        </>
      }
    >
      <div className="space-y-3 text-[13px]">
        <p className="text-slate-600">
          자동 수집이 제한된 제공처의 가격을 직접 확인한 뒤 등록합니다. 열: <code className="rounded bg-slate-100 px-1">{IMPORT_COLUMNS.join(', ')}</code>. 빈 칸은 ‘-’(미확인)으로 저장되며 0원으로 바뀌지 않습니다.
        </p>
        <div className="flex flex-wrap gap-2">
          <input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} className="text-sm file:mr-2 file:rounded-md file:border file:border-slate-200 file:bg-white file:px-3 file:py-1.5 file:text-sm" aria-label="CSV 파일 선택" />
          <button className="btn-ghost btn-sm" onClick={template}>
            양식 내려받기
          </button>
        </div>
        {errors.length > 0 && (
          <ul role="alert" className="list-inside list-disc text-red-600">
            {errors.slice(0, 8).map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        {rows.length > 0 && (
          <div className="max-h-64 overflow-auto rounded-lg border border-slate-200">
            <table className="num w-full text-[12px]">
              <thead className="sticky top-0 bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-2 py-1.5 text-left">판매처</th>
                  <th className="px-2 py-1.5 text-left">상품명</th>
                  <th className="px-2 py-1.5 text-right">중량(kg)</th>
                  <th className="px-2 py-1.5 text-right">가격/중량</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td className="px-2 py-1">{SOURCE_LABEL[r.source]}</td>
                    <td className="max-w-[260px] truncate px-2 py-1">{r.fields.title}</td>
                    <td className="px-2 py-1 text-right">{r.fields.weightKg ?? '-'}</td>
                    <td className="px-2 py-1 text-right">{formatUnitPrice(derive(r.fields).unitPriceKrwPerKg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
