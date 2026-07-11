import type { NFLGame } from './types';

export function mascot(fullName: string): string {
  const parts = fullName.trim().split(' ');
  return parts[parts.length - 1];
}

export function city(fullName: string): string {
  const parts = fullName.trim().split(' ');
  return parts.slice(0, -1).join(' ');
}

export function matchupLine(game: NFLGame): string {
  const away = city(game.awayTeam);
  const home = city(game.homeTeam);
  const hs   = game.homeSpread;
  if (hs === null) return `${away} at ${home}`;
  if (hs === 0)    return `${away} at ${home} (PK)`;
  if (hs < 0)      return `${away} at ${home} (${hs})`;
  return `${away} (${-hs}) at ${home}`;
}

export function gameColumnDay(game: NFLGame): string {
  return new Date(game.commenceTime).toLocaleDateString('en-US', {
    weekday: 'long', timeZone: 'America/New_York',
  });
}

export function gameColumnHeader(game: NFLGame): string {
  return `${gameColumnDay(game)} - ${matchupLine(game)}`;
}

export function finalScoreLine(game: NFLGame): string | null {
  if (game.homeScore == null || game.awayScore == null) return null;
  return `${mascot(game.awayTeam)} ${game.awayScore} – ${game.homeScore} ${mascot(game.homeTeam)}`;
}

export function resultGlyph(result?: string): string {
  if (result === 'win') return '✓';
  if (result === 'loss') return '✗';
  if (result === 'push') return '–';
  return '';
}
