import type { CategorySchedule } from '../../types';

/**
 * 탭별 예약 슬롯 계산 (Asia/Seoul). crawler/scheduler.py 와 같은 규칙.
 *  - daily:    매일 timesOfDay 각 시각
 *  - weekly:   daysOfWeek(0=일) 에 해당하는 날의 timesOfDay 각 시각
 *  - interval: 기준 시각(timesOfDay[0], 없으면 00:00)부터 intervalHours 간격
 * 실행은 GitHub Actions 가 슬롯 시각 이후 가능한 첫 실행에서 처리한다(정시 보장 아님).
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
/** interval 모드의 기준일 (KST) */
const INTERVAL_EPOCH_DAY = Date.UTC(2026, 0, 1);

type ScheduleLike = Pick<CategorySchedule, 'enabled' | 'frequency' | 'daysOfWeek' | 'timesOfDay' | 'intervalHours'>;

export function parseHHmm(s: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function kstMidnightUtcMs(t: number): number {
  const kst = t + KST_OFFSET_MS;
  return kst - (((kst % DAY_MS) + DAY_MS) % DAY_MS) - KST_OFFSET_MS;
}

function kstWeekday(dayStartUtcMs: number): number {
  return new Date(dayStartUtcMs + KST_OFFSET_MS).getUTCDay();
}

function sortedMinutes(times: string[]): number[] {
  return [...new Set(times.map(parseHHmm).filter((m): m is number => m != null))].sort((a, b) => a - b);
}

function daySlots(s: ScheduleLike, dayStart: number): number[] {
  if (s.frequency === 'weekly' && !s.daysOfWeek.includes(kstWeekday(dayStart))) return [];
  return sortedMinutes(s.timesOfDay).map((m) => dayStart + m * 60_000);
}

function intervalParams(s: ScheduleLike): { anchor: number; step: number } | null {
  const hours = s.intervalHours ?? 0;
  if (!(hours >= 1 && hours <= 168)) return null;
  const minutes = sortedMinutes(s.timesOfDay)[0] ?? 0;
  return { anchor: INTERVAL_EPOCH_DAY - KST_OFFSET_MS + minutes * 60_000, step: hours * HOUR_MS };
}

/** now 이하인 가장 최근 슬롯 (UTC ms). 없으면 null */
export function latestSlotAtOrBefore(s: ScheduleLike, now: number): number | null {
  if (!s.enabled) return null;
  if (s.frequency === 'interval') {
    const p = intervalParams(s);
    if (!p || now < p.anchor) return null;
    return p.anchor + Math.floor((now - p.anchor) / p.step) * p.step;
  }
  const today = kstMidnightUtcMs(now);
  for (let i = 0; i <= 7; i++) {
    const slots = daySlots(s, today - i * DAY_MS).filter((t) => t <= now);
    if (slots.length) return slots[slots.length - 1];
  }
  return null;
}

/** now 이후(초과) 첫 슬롯 (UTC ms). 없으면 null */
export function nextSlotAfter(s: ScheduleLike, now: number): number | null {
  if (!s.enabled) return null;
  if (s.frequency === 'interval') {
    const p = intervalParams(s);
    if (!p) return null;
    if (now < p.anchor) return p.anchor;
    return p.anchor + (Math.floor((now - p.anchor) / p.step) + 1) * p.step;
  }
  const today = kstMidnightUtcMs(now);
  for (let i = 0; i <= 7; i++) {
    const slot = daySlots(s, today + i * DAY_MS).find((t) => t > now);
    if (slot != null) return slot;
  }
  return null;
}

/**
 * 처리해야 할 슬롯: 마지막으로 큐에 넣은 슬롯 이후 도래한 가장 최근 슬롯 하나.
 * 놓친 슬롯이 여러 개여도 한 번만 따라잡는다(catch-up).
 */
export function dueSlot(s: ScheduleLike, now: number, lastEnqueuedSlot: string | null): number | null {
  const latest = latestSlotAtOrBefore(s, now);
  if (latest == null) return null;
  if (lastEnqueuedSlot && Date.parse(lastEnqueuedSlot) >= latest) return null;
  return latest;
}

export function validateSchedule(s: ScheduleLike): string[] {
  const errors: string[] = [];
  if (!s.enabled) return errors;
  if (s.frequency !== 'interval' && sortedMinutes(s.timesOfDay).length === 0) errors.push('갱신 시각을 1개 이상 입력하세요 (HH:mm).');
  if (s.timesOfDay.some((t) => parseHHmm(t) == null)) errors.push('시각은 HH:mm 형식이어야 합니다 (예: 08:30).');
  if (s.frequency === 'weekly' && s.daysOfWeek.length === 0) errors.push('요일을 1개 이상 선택하세요.');
  if (s.frequency === 'interval' && !((s.intervalHours ?? 0) >= 1 && (s.intervalHours ?? 0) <= 168))
    errors.push('간격은 1~168시간 사이여야 합니다.');
  return errors;
}

export const WEEKDAY_LABEL = ['일', '월', '화', '수', '목', '금', '토'];
