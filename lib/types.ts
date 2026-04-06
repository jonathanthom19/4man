export interface Player {
  player_id: string;
  name: string;
  pos: 'QB' | 'RB' | 'WR' | 'TE';
  team: string;
  rank: number;
  bye: number | null;
  status: string | null;
  age: number | null;
}

export interface DraftedPlayer extends Player {
  manager: string;
  pickNumber: number;
  round: number;
}

export interface DraftConfig {
  leagueName: string;
  managers: string[];
  rounds: number;
  snakeDraft: boolean;
}

export interface DraftState {
  managers: string[];
  rounds: number;
  picks: DraftedPlayer[];
  currentPick: number;
  startedAt: number;
  updatedAt: number;
  adminName?: string;
  snakeDraft?: boolean; // defaults to true
  draftName?: string;
}

// ─── NFL Picks ────────────────────────────────────────────────────────────────

export interface NFLGame {
  id: string;
  homeTeam: string; // e.g. "Philadelphia Eagles"
  awayTeam: string; // e.g. "Dallas Cowboys"
  commenceTime: string; // ISO 8601
  homeSpread: number | null; // negative = home favored
  lockTime: number; // ms since epoch — picks for this game lock at this time
}

export interface WeeklyPick {
  gameId: string;
  selectedTeam: string; // full team name
}

export interface UserPicksSubmission {
  userName: string;
  submittedAt: number;
  updatedAt: number;
  picks: WeeklyPick[];
}

export interface PicksState {
  weekLabel: string; // e.g. "Sep 4–7, 2025"
  games: NFLGame[];
  gamesRefreshedAt: number;
  submissions: UserPicksSubmission[];
}

// ─────────────────────────────────────────────────────────────────────────────

export interface ArchivedDraft {
  id: string;
  archivedAt: number;
  startedAt: number;
  managers: string[];
  rounds: number;
  picks: DraftedPlayer[];
  snakeDraft?: boolean;
  completed: boolean; // true = all picks done; false = reset early
  draftName?: string;
}
