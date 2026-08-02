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

export type PickResult = 'win' | 'loss' | 'push' | 'pending';

export type LineHistorySource = 'open' | 'refresh' | 'admin';

export interface LineHistoryEntry {
  homeSpread: number | null;
  /** ms since epoch */
  at: number;
  source: LineHistorySource;
}

export interface NFLGame {
  id: string;
  homeTeam: string; // e.g. "Philadelphia Eagles"
  awayTeam: string; // e.g. "Dallas Cowboys"
  commenceTime: string; // ISO 8601
  homeSpread: number | null; // negative = home favored
  /** Append-only snapshots when the DraftKings home spread changes. */
  lineHistory?: LineHistoryEntry[];
  /** Set when the first member saves a pick; automatic line updates stop. */
  lineLockedAt?: number;
  lockTime: number; // ms since epoch — picks for this game lock at this time
  homeScore?: number | null;
  awayScore?: number | null;
  completed?: boolean;
}

export interface WeeklyPick {
  gameId: string;
  selectedTeam: string; // full team name
  /** Spread displayed when the member made this pick. */
  lineAtPick?: number | null;
  result?: PickResult;
}

export interface UserPicksSubmission {
  userName: string;
  submittedAt: number;
  updatedAt: number;
  picks: WeeklyPick[];
  /** One confidence pick per week (must be among `picks`). */
  lockOfWeekGameId?: string;
}

export interface PicksState {
  weekLabel: string; // e.g. "NFL Week 1 · Sep 10–15, 2026"
  /** NFL week number (1–18) when sport uses NFL week grouping. */
  weekNumber?: number;
  games: NFLGame[];
  gamesRefreshedAt: number;
  submissions: UserPicksSubmission[];
  /** Odds API sport key from last refresh (e.g. basketball_nba). */
  sportKey?: string;
  season?: string;
  /** Pool $ deltas applied when this week was last graded (before archive). */
  lastWeeklyPoolDeltas?: Record<string, number>;
  gradedAt?: number;
  /** Wednesday rollover waits here until missing picks/locks are resolved. */
  rolloverPending?: boolean;
  /** Previous week is archived; do not load the next slate before Wednesday. */
  awaitingWednesday?: boolean;
  /** Append-only record of administrator corrections. */
  adminEdits?: PicksAdminEdit[];
}

export interface PicksAdminEdit {
  id: string;
  editedAt: number;
  adminName: string;
  userName: string;
  gameId: string;
  previousTeam?: string;
  selectedTeam: string;
  previousLockGameId?: string;
  setAsLock: boolean;
  timing: 'before-kickoff' | 'after-kickoff';
  reason?: string;
}

export interface LockRecord {
  wins: number;
  losses: number;
  pushes: number;
}

export interface PicksSeasonState {
  season: string;
  balances: Record<string, number>;
  lockRecords: Record<string, LockRecord>;
}

export interface ArchivedPicksWeek {
  id: string;
  season: string;
  weekLabel: string;
  archivedAt: number;
  games: NFLGame[];
  submissions: UserPicksSubmission[];
  sportKey?: string;
  weeklyPoolDeltas: Record<string, number>;
  /** Season balances after this week was applied. */
  balancesAfterWeek: Record<string, number>;
  lockRecordsAfterWeek: Record<string, LockRecord>;
  gradedAt: number;
  adminEdits?: PicksAdminEdit[];
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
