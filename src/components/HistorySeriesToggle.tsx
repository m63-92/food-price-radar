import type { SeriesKey } from '../lib/domain/history';
import { SERIES_LABEL } from '../lib/domain/history';
import { HISTORY_COLORS } from '../lib/chartColors';

export function HistorySeriesToggle({
  keys,
  visible,
  onChange,
}: {
  keys: SeriesKey[];
  visible: Record<SeriesKey, boolean>;
  onChange: (v: Record<SeriesKey, boolean>) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="표시할 가격 시리즈">
      {keys.map((k) => {
        const on = visible[k];
        return (
          <button
            key={k}
            aria-pressed={on}
            onClick={() => onChange({ ...visible, [k]: !on })}
            className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium ${
              on ? 'border-slate-300 bg-white text-slate-800' : 'border-slate-200 bg-slate-50 text-slate-400'
            }`}
          >
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: on ? HISTORY_COLORS[k] : 'transparent', boxShadow: `inset 0 0 0 1.5px ${HISTORY_COLORS[k]}` }}
              aria-hidden
            />
            {SERIES_LABEL[k]}
          </button>
        );
      })}
    </div>
  );
}
