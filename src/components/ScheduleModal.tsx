import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import type { CategorySchedule, ScheduleFrequency } from '../types';
import { formatKst } from '../lib/domain/format';
import { nextSlotAfter, validateSchedule, WEEKDAY_LABEL } from '../lib/domain/schedule';
import { Field, Modal, Segmented, Toggle, cx } from './ui';

export function ScheduleModal({
  open,
  schedule,
  lastSuccessAt,
  busy,
  onSave,
  onClose,
}: {
  open: boolean;
  schedule: CategorySchedule;
  lastSuccessAt: string | null;
  busy: boolean;
  onSave: (s: CategorySchedule) => void;
  onClose: () => void;
}) {
  const [s, setS] = useState<CategorySchedule>(schedule);
  const [time, setTime] = useState('08:30');
  const errors = validateSchedule(s);
  const next = nextSlotAfter(s, Date.now());
  const set = (patch: Partial<CategorySchedule>) => setS((x) => ({ ...x, ...patch }));

  const addTime = () => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || s.timesOfDay.includes(time)) return;
    set({ timesOfDay: [...s.timesOfDay, time].sort() });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="자동 갱신 설정"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            취소
          </button>
          <button
            className="btn-primary"
            disabled={busy || errors.length > 0}
            onClick={() => onSave({ ...s, nextDueAt: next != null ? new Date(next).toISOString() : null })}
          >
            {busy ? '저장 중…' : '저장'}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">자동 갱신</p>
            <p className="text-xs text-slate-500">타임존 Asia/Seoul (KST)</p>
          </div>
          <Toggle checked={s.enabled} onChange={(v) => set({ enabled: v })} label="자동 갱신 사용" />
        </div>

        <div className={cx('space-y-5', !s.enabled && 'pointer-events-none opacity-50')} aria-disabled={!s.enabled}>
          <Field label="주기">
            <Segmented<ScheduleFrequency>
              label="갱신 주기"
              value={s.frequency}
              onChange={(v) => set({ frequency: v, intervalHours: v === 'interval' ? (s.intervalHours ?? 6) : s.intervalHours })}
              options={[
                { value: 'daily', label: '매일' },
                { value: 'weekly', label: '선택 요일' },
                { value: 'interval', label: 'N시간 간격' },
              ]}
            />
          </Field>

          {s.frequency === 'weekly' && (
            <fieldset>
              <legend className="label">요일</legend>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAY_LABEL.map((d, i) => {
                  const on = s.daysOfWeek.includes(i);
                  return (
                    <button
                      key={d}
                      aria-pressed={on}
                      onClick={() => set({ daysOfWeek: on ? s.daysOfWeek.filter((x) => x !== i) : [...s.daysOfWeek, i].sort() })}
                      className={cx('h-8 w-9 rounded-lg border text-sm', on ? 'border-accent-700 bg-accent-50 font-semibold text-accent-800' : 'border-slate-200 text-slate-600')}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}

          {s.frequency === 'interval' ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="간격(시간)" htmlFor="sch-int">
                <input id="sch-int" type="number" min={1} max={168} className="input num" value={s.intervalHours ?? ''} onChange={(e) => set({ intervalHours: e.target.value ? Number(e.target.value) : null })} />
              </Field>
              <Field label="기준 시각" htmlFor="sch-anchor" hint="이 시각부터 간격마다 실행">
                <input id="sch-anchor" type="time" className="input num" value={s.timesOfDay[0] ?? '00:00'} onChange={(e) => set({ timesOfDay: [e.target.value] })} />
              </Field>
            </div>
          ) : (
            <Field label="갱신 시각 (여러 개 가능)" htmlFor="sch-time">
              <div className="flex gap-2">
                <input id="sch-time" type="time" className="input num w-36" value={time} onChange={(e) => setTime(e.target.value)} />
                <button className="btn-secondary" onClick={addTime}>
                  <Plus size={15} /> 시각 추가
                </button>
              </div>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {s.timesOfDay.map((t) => (
                  <li key={t} className="chip num bg-slate-100 py-1 text-[13px] text-slate-700">
                    {t}
                    <button aria-label={`${t} 삭제`} onClick={() => set({ timesOfDay: s.timesOfDay.filter((x) => x !== t) })} className="text-slate-400 hover:text-slate-700">
                      <X size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            </Field>
          )}
        </div>

        <dl className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 text-[13px]">
          <div>
            <dt className="text-slate-500">다음 예정 갱신</dt>
            <dd className="num mt-0.5 font-medium">{next != null ? formatKst(new Date(next).toISOString()) : '-'}</dd>
          </div>
          <div>
            <dt className="text-slate-500">마지막 성공</dt>
            <dd className="num mt-0.5 font-medium">{formatKst(lastSuccessAt)}</dd>
          </div>
        </dl>
        <p className="text-xs leading-5 text-slate-500">
          GitHub Actions 예약 실행은 정시를 보장하지 않습니다. 설정 시각 이후 가능한 첫 실행(보통 수 분, 혼잡 시 더 지연)에 처리되며 실제 실행 시각이 수집 로그에 기록됩니다.
        </p>
        {errors.length > 0 && s.enabled && (
          <ul role="alert" className="list-inside list-disc text-sm text-red-600">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
