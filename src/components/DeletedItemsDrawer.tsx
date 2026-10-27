import { RotateCcw } from 'lucide-react';
import type { Category } from '../types';
import { formatKst, formatUnitPrice } from '../lib/domain/format';
import { useCategories, useMutations, useProducts } from '../lib/queries';
import { useToast } from './Toast';
import { Drawer, SourceBadge } from './ui';

export function DeletedItemsDrawer({ category, onClose }: { category: Category | null; onClose: () => void }) {
  const toast = useToast();
  const { restoreProduct, restoreCategory } = useMutations();
  const deletedProducts = useProducts(category?.id ?? null, true);
  const allCats = useCategories(true);
  const deletedCats = (allCats.data ?? []).filter((c) => c.deletedAt);

  return (
    <Drawer open onClose={onClose} title="삭제한 항목 복구" subtitle="삭제한 상품은 다음 수집에서 다시 나타나지 않습니다. 복구하면 다시 수집·표시됩니다.">
      {category && (
        <section className="mb-6">
          <h3 className="mb-2 text-[13px] font-semibold text-slate-700">‘{category.name}’ 탭에서 삭제한 상품</h3>
          {(deletedProducts.data ?? []).length === 0 ? (
            <p className="text-[13px] text-slate-500">삭제한 상품이 없습니다.</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {deletedProducts.data!.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                  <SourceBadge source={p.source} />
                  <span className="min-w-0 flex-1 truncate">{p.effective.title}</span>
                  <span className="num text-slate-500">{formatUnitPrice(p.unitPriceKrwPerKg)}</span>
                  <span className="num hidden text-slate-400 sm:inline">{formatKst(p.deletedAt)}</span>
                  <button
                    className="btn-secondary btn-sm"
                    onClick={() => restoreProduct.mutate(p.id, { onSuccess: () => toast('success', '상품을 복구했습니다.'), onError: (e) => toast('error', (e as Error).message) })}
                  >
                    <RotateCcw size={13} /> 복구
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <section>
        <h3 className="mb-2 text-[13px] font-semibold text-slate-700">삭제한 품목 탭</h3>
        {deletedCats.length === 0 ? (
          <p className="text-[13px] text-slate-500">삭제한 품목 탭이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {deletedCats.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                <span className="flex-1 font-medium">{c.name}</span>
                <span className="num text-slate-400">{formatKst(c.deletedAt)}</span>
                <button
                  className="btn-secondary btn-sm"
                  onClick={() => restoreCategory.mutate(c.id, { onSuccess: () => toast('success', `‘${c.name}’ 탭을 복구했습니다. 자동 갱신은 다시 켜야 합니다.`), onError: (e) => toast('error', (e as Error).message) })}
                >
                  <RotateCcw size={13} /> 복구
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Drawer>
  );
}
