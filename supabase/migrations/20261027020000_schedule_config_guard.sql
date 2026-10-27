-- 예약 설정을 켜거나 바꾼 시점 이전에 이미 지난 슬롯은 따라잡기(catch-up) 대상에서 제외한다.
-- (버그: 22:48 에 '매일 08:30' 을 켜자 그날 08:30 슬롯이 즉시 실행됨)
-- last_enqueued_slot 을 설정 변경 시각으로 끌어올리면 수집기는 그 이후 도래하는 슬롯만 큐에 넣는다.
create or replace function public.fpr_schedule_config_guard() returns trigger
language plpgsql as $$
begin
  if new.enabled and (
       not old.enabled
       or new.frequency is distinct from old.frequency
       or new.days_of_week is distinct from old.days_of_week
       or new.times_of_day is distinct from old.times_of_day
       or new.interval_hours is distinct from old.interval_hours) then
    new.last_enqueued_slot := greatest(coalesce(old.last_enqueued_slot, now()), now());
  end if;
  return new;
end $$;

create trigger category_schedules_config_guard
  before update on public.category_schedules
  for each row execute function public.fpr_schedule_config_guard();
