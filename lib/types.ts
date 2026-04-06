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
