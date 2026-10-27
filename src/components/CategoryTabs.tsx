import { GripVertical, Plus } from 'lucide-react';
import { useRef, useState, type KeyboardEvent } from 'react';
import type { Category } from '../types';
import { cx } from './ui';

/**
 * 품목 탭. 드래그(데스크톱) 또는 Alt+←/→(키보드)로 순서를 바꾼다. 모바일은 가로 스크롤.
 */
export function CategoryTabs({
  categories,
  activeId,
  onSelect,
  onReorder,
  onAdd,
}: {
  categories: Category[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onReorder: (ids: string[]) => void;
  onAdd: () => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const move = (id: string, to: number) => {
    const ids = categories.map((c) => c.id).filter((x) => x !== id);
    ids.splice(Math.max(0, Math.min(to, ids.length)), 0, id);
    onReorder(ids);
  };

  const onKey = (e: KeyboardEvent, idx: number, id: string) => {
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      move(id, idx + (e.key === 'ArrowLeft' ? -1 : 1));
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const next = categories[(idx + (e.key === 'ArrowLeft' ? -1 : 1) + categories.length) % categories.length];
      refs.current[next.id]?.focus();
      onSelect(next.id);
    }
  };

  return (
    <div className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-[1400px] items-end gap-1 overflow-x-auto px-4 sm:px-6" role="tablist" aria-label="품목 탭 (Alt+←/→ 로 순서 변경)">
        {categories.map((c, idx) => {
          const active = c.id === activeId;
          return (
            <button
              key={c.id}
              ref={(el) => (refs.current[c.id] = el)}
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              draggable
              onDragStart={() => setDragId(c.id)}
              onDragOver={(e) => {
                e.preventDefault();
                setOverId(c.id);
              }}
              onDragLeave={() => setOverId(null)}
              onDrop={() => {
                if (dragId && dragId !== c.id) move(dragId, idx);
                setDragId(null);
                setOverId(null);
              }}
              onDragEnd={() => {
                setDragId(null);
                setOverId(null);
              }}
              onClick={() => onSelect(c.id)}
              onKeyDown={(e) => onKey(e, idx, c.id)}
              className={cx(
                'group relative flex h-11 shrink-0 items-center gap-1 border-b-2 px-3 text-sm font-medium transition-colors',
                active ? 'border-accent-700 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800',
                overId === c.id && dragId !== c.id && 'bg-accent-50',
                dragId === c.id && 'opacity-50',
              )}
            >
              <GripVertical size={13} className="hidden cursor-grab text-slate-300 group-hover:inline sm:inline" aria-hidden />
              {c.name}
            </button>
          );
        })}
        <button className="btn-ghost btn-sm mb-1.5 ml-1 shrink-0 text-accent-700" onClick={onAdd}>
          <Plus size={15} /> 품목 추가
        </button>
      </div>
    </div>
  );
}
