import type { NFLGame } from './types';

const ET = 'America/New_York';

function kickoffMs(game: NFLGame): number {
  return new Date(game.commenceTime).getTime();
}

function etDateParts(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ET,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find(part => part.type === type)?.value);
  return { year: value('year'), month: value('month'), day: value('day') };
}

function seasonOpenerDateMs(season: number): number {
  const septemberFirst = new Date(Date.UTC(season, 8, 1));
  const daysToMonday = (8 - septemberFirst.getUTCDay()) % 7;
  const laborDay = 1 + daysToMonday;
  // The regular season opens on the Thursday following Labor Day.
  return Date.UTC(season, 8, laborDay + 3);
}

/** Calendar NFL week, independent of which past games remain in the odds feed. */
export function nflWeekNumberForDate(value: string | Date): number {
  const date = typeof value === 'string' ? new Date(value) : value;
  const { year, month, day } = etDateParts(date);
  const season = month <= 2 ? year - 1 : year;
  const calendarDate = Date.UTC(year, month - 1, day);
  return Math.max(1, Math.floor((calendarDate - seasonOpenerDateMs(season)) / (7 * 86_400_000)) + 1);
}

/** Group games by their real calendar NFL week, retaining gaps in the feed. */
export function groupGamesByNflWeek(games: NFLGame[]): NFLGame[][] {
  const byWeek = new Map<number, NFLGame[]>();
  for (const game of [...games].sort((a, b) => kickoffMs(a) - kickoffMs(b))) {
    const week = nflWeekNumberForDate(game.commenceTime);
    byWeek.set(week, [...(byWeek.get(week) ?? []), game]);
  }
  const maxWeek = Math.max(0, ...byWeek.keys());
  return Array.from({ length: maxWeek }, (_, index) => byWeek.get(index + 1) ?? []);
}

export function filterGamesForNflWeek(games: NFLGame[], weekNumber: number): NFLGame[] {
  return games
    .filter(game => nflWeekNumberForDate(game.commenceTime) === weekNumber)
    .sort((a, b) => kickoffMs(a) - kickoffMs(b));
}

export function nflWeekCount(games: NFLGame[]): number {
  return new Set(games.map(game => nflWeekNumberForDate(game.commenceTime))).size;
}

/** Pick the week we're in (or week 1 before the season starts). */
export function detectCurrentNflWeek(games: NFLGame[], now = Date.now()): number {
  if (!games.length) return nflWeekNumberForDate(new Date(now));
  const available = new Set(games.map(game => nflWeekNumberForDate(game.commenceTime)));
  const calendarWeek = nflWeekNumberForDate(new Date(now));
  if (available.has(calendarWeek)) return calendarWeek;
  return Math.min(...available);
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
  const minParts = etDateParts(min);
  const maxParts = etDateParts(max);
  const range =
    minParts.month === maxParts.month
      ? `${fmt(min)}–${maxParts.day}, ${year}`
      : `${fmt(min)} – ${fmt(max)}, ${year}`;
  return `${prefix} · ${range}`;
}
