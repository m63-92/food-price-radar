import { MoreHorizontal } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from './ui';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  hidden?: boolean;
}

export function Menu({ items, label = '더보기', trigger }: { items: MenuItem[]; label?: string; trigger?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button className="btn-secondary px-2.5" aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen((v) => !v)}>
        {trigger ?? <MoreHorizontal size={16} />}
      </button>
      {open && (
        <div role="menu" className="card absolute right-0 z-30 mt-1 min-w-[200px] py-1 shadow-lg">
          {items
            .filter((i) => !i.hidden)
            .map((i) => (
              <button
                key={i.label}
                role="menuitem"
                className={cx('flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50', i.danger ? 'text-red-600' : 'text-slate-700')}
                onClick={() => {
                  setOpen(false);
                  i.onSelect();
                }}
              >
                {i.icon}
                {i.label}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
