import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { cx } from './ui';

type Tone = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  tone: Tone;
  message: string;
}

const Ctx = createContext<(tone: Tone, message: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((tone: Tone, message: string) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, tone, message }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), tone === 'error' ? 8000 : 4500);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className={cx(
              'pointer-events-auto flex w-full max-w-md items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm shadow-lg',
              t.tone === 'success' && 'border-accent-200 bg-white text-slate-800',
              t.tone === 'error' && 'border-red-200 bg-white text-slate-800',
              t.tone === 'info' && 'border-slate-200 bg-white text-slate-800',
            )}
          >
            {t.tone === 'success' && <CheckCircle2 size={18} className="mt-px shrink-0 text-accent-600" />}
            {t.tone === 'error' && <TriangleAlert size={18} className="mt-px shrink-0 text-red-600" />}
            {t.tone === 'info' && <Info size={18} className="mt-px shrink-0 text-slate-500" />}
            <span className="flex-1 leading-5">{t.message}</span>
            <button aria-label="알림 닫기" className="text-slate-400 hover:text-slate-600" onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))}>
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
