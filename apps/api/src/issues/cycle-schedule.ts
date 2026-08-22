export interface CycleSchedule {
  weekLabel: string;
  startAt: string;
  endAt: string;
  commentEndsAt: string;
  commentPublishAt: string;
  voteStartsAt: string;
  voteEndsAt: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function cycleSchedule(now: Date): CycleSchedule {
  const currentWeekMonday = mondayOfIsoWeek(now);
  const currentWeek = isoWeekNumber(currentWeekMonday);
  const pairedStart = currentWeek % 2 === 0
    ? new Date(currentWeekMonday.getTime() - 7 * DAY_MS)
    : currentWeekMonday;
  const candidateStart = now.getTime() - pairedStart.getTime() < 12 * DAY_MS
    ? pairedStart
    : new Date(pairedStart.getTime() + 14 * DAY_MS);
  const startAt = atUtcStart(candidateStart);
  const voteStartsAt = new Date(startAt.getTime() + 12 * DAY_MS);
  const endAt = new Date(startAt.getTime() + 14 * DAY_MS - 1000);
  const endWeek = isoWeekNumber(new Date(startAt.getTime() + 13 * DAY_MS));

  return {
    weekLabel: `第${isoWeekNumber(startAt)}~${endWeek}周`,
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    commentEndsAt: new Date(voteStartsAt.getTime() - 1000).toISOString(),
    commentPublishAt: voteStartsAt.toISOString(),
    voteStartsAt: voteStartsAt.toISOString(),
    voteEndsAt: endAt.toISOString()
  };
}

function atUtcStart(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function mondayOfIsoWeek(value: Date) {
  const date = atUtcStart(value);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date;
}

function isoWeekNumber(value: Date) {
  const date = atUtcStart(value);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / DAY_MS) + 1) / 7);
}
