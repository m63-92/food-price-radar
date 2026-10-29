import { GripVertical, Plus } from 'lucide-react';
import { useRef, useState, type KeyboardEvent } from 'react';
import type { Category } from '../types';
import { JobBadge, cx } from './ui';

/**
 * 품목 목록 (왼쪽 세로 사이드바). 드래그 또는 Alt+↑/↓ 로 순서 변경, ↑/↓ 로 이동.
 * 모바일에서는 Dashboard 가 드로어 안에 같은 목록을 띄운다.
 */
export function CategorySidebar({
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
    const up = e.key === 'ArrowUp';
    if (!up && e.key !== 'ArrowDown') return;
    e.preventDefault();
    if (e.altKey) return move(id, idx + (up ? -1 : 1));
    const next = categories[(idx + (up ? -1 : 1) + categories.length) % categories.length];
    refs.current[next.id]?.focus();
    onSelect(next.id);
  };

  return (
    <nav aria-label="품목">
      <div className="mb-2 flex items-center justify-between px-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">품목 {categories.length}</h2>
      </div>
      <ul role="tablist" aria-orientation="vertical" aria-label="품목 (Alt+↑/↓ 로 순서 변경)" className="space-y-0.5">
        {categories.map((c, idx) => {
          const active = c.id === activeId;
          return (
            <li key={c.id}>
              <button
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
                  'group flex w-full items-center gap-1.5 rounded-lg px-2 py-2 text-left text-sm transition-colors',
                  active ? 'bg-accent-50 font-semibold text-accent-800' : 'text-slate-700 hover:bg-slate-100',
                  overId === c.id && dragId !== c.id && 'ring-2 ring-inset ring-accent-200',
                  dragId === c.id && 'opacity-50',
                )}
              >
                <GripVertical size={13} className="shrink-0 cursor-grab text-slate-300 opacity-0 group-hover:opacity-100" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                {(c.lastJobStatus === 'queued' || c.lastJobStatus === 'running' || c.lastJobStatus === 'failed') && <JobBadge status={c.lastJobStatus} />}
              </button>
            </li>
          );
        })}
      </ul>
      <button className="btn-ghost btn-sm mt-2 w-full justify-start text-accent-700" onClick={onAdd}>
        <Plus size={15} /> 품목 추가
      </button>
    </nav>
  );
}
