import { describe, expect, it } from 'vitest';
import { dueSlot, latestSlotAtOrBefore, nextSlotAfter, validateSchedule } from './schedule';

const kst = (s: string) => Date.parse(`${s}+09:00`);
const daily = (times: string[]) => ({ enabled: true, frequency: 'daily' as const, daysOfWeek: [], timesOfDay: times, intervalHours: null });

describe('예약 슬롯 (KST)', () => {
  it('마늘 08:30, 배추 19:00 독립 계산', () => {
    const now = kst('2026-10-27T12:00:00');
    expect(latestSlotAtOrBefore(daily(['08:30']), now)).toBe(kst('2026-10-27T08:30:00'));
    expect(latestSlotAtOrBefore(daily(['19:00']), now)).toBe(kst('2026-10-26T19:00:00'));
    expect(nextSlotAfter(daily(['19:00']), now)).toBe(kst('2026-10-27T19:00:00'));
  });
  it('복수 시각', () => {
    const s = daily(['18:00', '08:30']);
    expect(nextSlotAfter(s, kst('2026-10-27T09:00:00'))).toBe(kst('2026-10-27T18:00:00'));
    expect(nextSlotAfter(s, kst('2026-10-27T18:00:00'))).toBe(kst('2026-10-28T08:30:00'));
  });
  it('선택 요일 (2026-10-27 은 화요일)', () => {
    const s = { enabled: true, frequency: 'weekly' as const, daysOfWeek: [1], timesOfDay: ['07:00'], intervalHours: null };
    expect(latestSlotAtOrBefore(s, kst('2026-10-27T12:00:00'))).toBe(kst('2026-10-26T07:00:00'));
    expect(nextSlotAfter(s, kst('2026-10-27T12:00:00'))).toBe(kst('2026-11-02T07:00:00'));
  });
  it('N시간 간격', () => {
    const s = { enabled: true, frequency: 'interval' as const, daysOfWeek: [], timesOfDay: ['00:00'], intervalHours: 6 };
    expect(latestSlotAtOrBefore(s, kst('2026-10-27T13:10:00'))).toBe(kst('2026-10-27T12:00:00'));
    expect(nextSlotAfter(s, kst('2026-10-27T13:10:00'))).toBe(kst('2026-10-27T18:00:00'));
  });
  it('이미 큐에 넣은 슬롯은 다시 처리하지 않고, 놓친 슬롯은 한 번만 따라잡음', () => {
    const s = daily(['08:30']);
    const now = kst('2026-10-27T09:02:00');
    expect(dueSlot(s, now, null)).toBe(kst('2026-10-27T08:30:00'));
    expect(dueSlot(s, now, new Date(kst('2026-10-27T08:30:00')).toISOString())).toBeNull();
    expect(dueSlot(s, now, new Date(kst('2026-10-24T08:30:00')).toISOString())).toBe(kst('2026-10-27T08:30:00'));
  });
  it('비활성화는 슬롯 없음, 잘못된 입력 검증', () => {
    expect(latestSlotAtOrBefore({ ...daily(['08:30']), enabled: false }, Date.now())).toBeNull();
    expect(validateSchedule(daily(['25:00'])).length).toBeGreaterThan(0);
    expect(validateSchedule(daily(['08:30']))).toEqual([]);
  });
});
