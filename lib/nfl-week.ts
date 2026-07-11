import type { NFLGame } from './types';

const ET = 'America/New_York';

function kickoffMs(game: NFLGame): number {
  return new Date(game.commenceTime).getTime();
}

/** Tuesday 6:00 AM ET on the calendar week after this week's Sunday slate. */
function nflWeekEndMs(weekFirstKickoff: string): number {
  const start = new Date(weekFirstKickoff);

  // Walk forward to the first Sunday (ET) on or after the week's opening kickoff.
  const cursor = new Date(start);
  for (let i = 0; i < 10; i++) {
    const wd = cursor.toLocaleDateString('en-US', { weekday: 'short', timeZone: ET });
    if (wd === 'Sun') break;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const sundayEt = cursor.toLocaleDateString('en-CA', { timeZone: ET });
  const [y, m, d] = sundayEt.split('-').map(Number);
  const tuesday = new Date(Date.UTC(y, m - 1, d + 2, 12, 0, 0));

  // Resolve 6:00 AM ET on that Tuesday to UTC (probe for DST like picks-utils).
  const tuesdayStr = tuesday.toLocaleDateString('en-CA', { timeZone: ET });
  const probe = new Date(`${tuesdayStr}T12:00:00Z`);
  const probeHour = parseInt(
    probe.toLocaleTimeString('en-US', { timeZone: ET, hour: 'numeric', hour12: false }),
    10,
  );
  const utcHour = probeHour === 7 ? 11 : 10; // 10:00 UTC = 6:00 EDT, 11:00 UTC = 6:00 EST
  return new Date(`${tuesdayStr}T${String(utcHour).padStart(2, '0')}:00:00Z`).getTime();
}

/** Group games into NFL weeks (Thu opener through Monday night, then next week). */
export function groupGamesByNflWeek(games: NFLGame[]): NFLGame[][] {
  const sorted = [...games].sort((a, b) => kickoffMs(a) - kickoffMs(b));
  if (!sorted.length) return [];

  const weeks: NFLGame[][] = [];
  let i = 0;

  while (i < sorted.length) {
    const weekEnd = nflWeekEndMs(sorted[i].commenceTime);
    const weekGames: NFLGame[] = [];
    while (i < sorted.length && kickoffMs(sorted[i]) < weekEnd) {
      weekGames.push(sorted[i++]);
    }
    if (weekGames.length) weeks.push(weekGames);
  }

  return weeks;
}

export function filterGamesForNflWeek(games: NFLGame[], weekNumber: number): NFLGame[] {
  const weeks = groupGamesByNflWeek(games);
  const idx = weekNumber - 1;
  return idx >= 0 && idx < weeks.length ? weeks[idx] : [];
}

export function nflWeekCount(games: NFLGame[]): number {
  return groupGamesByNflWeek(games).length;
}

/** Pick the week we're in (or week 1 before the season starts). */
export function detectCurrentNflWeek(games: NFLGame[], now = Date.now()): number {
  const weeks = groupGamesByNflWeek(games);
  if (!weeks.length) return 1;

  if (now < kickoffMs(weeks[0][0])) return 1;

  for (let i = 0; i < weeks.length; i++) {
    const weekEnd = nflWeekEndMs(weeks[i][0].commenceTime);
    if (now < weekEnd) return i + 1;
  }
  return weeks.length;
}

export function formatNflWeekLabel(games: NFLGame[], sportLabel: string, weekNumber: number): string {
  const round = weekNumber === 19 ? 'Wild Card' : weekNumber === 20 ? 'Divisional Round' : `Week ${weekNumber}`;
  const prefix = `${sportLabel} ${round}`;
  if (!games.length) return prefix;

  const times = games.map(g => kickoffMs(g));
  const min = new Date(Math.min(...times));
  const max = new Date(Math.max(...times));
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: ET });
  const year = parseInt(min.toLocaleDateString('en-US', { year: 'numeric', timeZone: ET }), 10);
  const range =
    min.getMonth() === max.getMonth()
      ? `${fmt(min)}–${max.getDate()}, ${year}`
      : `${fmt(min)} – ${fmt(max)}, ${year}`;
  return `${prefix} · ${range}`;
}
