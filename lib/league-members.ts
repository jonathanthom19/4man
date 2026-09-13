/** League roster — edit here to add/remove people. */
export const LEAGUE_MEMBERS = ['Charlie', 'Jon', 'Steven', 'Avery'] as const;

/** Consistent row order for picks sheets and standings. */
export const PICKS_DISPLAY_ORDER = ['Jon', 'Avery', 'Charlie', 'Steven'] as const;

export const LEAGUE_MEMBER_SET = new Set(LEAGUE_MEMBERS.map(n => n.toLowerCase()));

export const LEAGUE_ADMINS = new Set(['jon']);

export function isLeagueMember(name: string): boolean {
  return LEAGUE_MEMBER_SET.has(name.toLowerCase());
}

export function isLeagueAdmin(name: string): boolean {
  return LEAGUE_ADMINS.has(name.toLowerCase());
}

export function canonicalMemberName(name: string): string | null {
  const found = LEAGUE_MEMBERS.find(m => m.toLowerCase() === name.toLowerCase());
  return found ?? null;
}
