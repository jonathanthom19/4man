/** The Odds API sport keys — https://the-odds-api.com/sports-odds-data/sport-keys */

export const NFL_SPORT_KEY = 'americanfootball_nfl';
export const NFL_PRESEASON_SPORT_KEY = 'americanfootball_nfl_preseason';

export interface OddsSportConfig {
  key: string;
  label: string;
  espnLeague: 'nfl' | 'nba' | 'mlb' | 'nhl' | null;
  useNflSundayLockRules: boolean;
}

const SPORTS: Record<string, OddsSportConfig> = {
  [NFL_SPORT_KEY]: {
    key: NFL_SPORT_KEY,
    label: 'NFL',
    espnLeague: 'nfl',
    useNflSundayLockRules: true,
  },
  [NFL_PRESEASON_SPORT_KEY]: {
    key: NFL_PRESEASON_SPORT_KEY,
    label: 'NFL Preseason',
    espnLeague: 'nfl',
    useNflSundayLockRules: false,
  },
  basketball_nba: {
    key: 'basketball_nba',
    label: 'NBA',
    espnLeague: 'nba',
    useNflSundayLockRules: false,
  },
  baseball_mlb: {
    key: 'baseball_mlb',
    label: 'MLB',
    espnLeague: 'mlb',
    useNflSundayLockRules: false,
  },
  icehockey_nhl: {
    key: 'icehockey_nhl',
    label: 'NHL',
    espnLeague: 'nhl',
    useNflSundayLockRules: false,
  },
};

/** Active sport for picks line refresh (set ODDS_SPORT_KEY in .env.local). */
export function getOddsSportConfig(requestedKey?: string): OddsSportConfig {
  const key = requestedKey?.trim() || process.env.ODDS_SPORT_KEY?.trim() || NFL_SPORT_KEY;
  return (
    SPORTS[key] ?? {
      key,
      label: key.replace(/_/g, ' '),
      espnLeague: null,
      useNflSundayLockRules: false,
    }
  );
}

const NBA_ESPN_ABBR: Record<string, string> = {
  'Atlanta Hawks': 'atl',
  'Boston Celtics': 'bos',
  'Brooklyn Nets': 'bkn',
  'Charlotte Hornets': 'cha',
  'Chicago Bulls': 'chi',
  'Cleveland Cavaliers': 'cle',
  'Dallas Mavericks': 'dal',
  'Denver Nuggets': 'den',
  'Detroit Pistons': 'det',
  'Golden State Warriors': 'gs',
  'Houston Rockets': 'hou',
  'Indiana Pacers': 'ind',
  'Los Angeles Clippers': 'lac',
  'Los Angeles Lakers': 'lal',
  'Memphis Grizzlies': 'mem',
  'Miami Heat': 'mia',
  'Milwaukee Bucks': 'mil',
  'Minnesota Timberwolves': 'min',
  'New Orleans Pelicans': 'no',
  'New York Knicks': 'ny',
  'Oklahoma City Thunder': 'okc',
  'Orlando Magic': 'orl',
  'Philadelphia 76ers': 'phi',
  'Phoenix Suns': 'phx',
  'Portland Trail Blazers': 'por',
  'Sacramento Kings': 'sac',
  'San Antonio Spurs': 'sa',
  'Toronto Raptors': 'tor',
  'Utah Jazz': 'utah',
  'Washington Wizards': 'wsh',
};

const NFL_ESPN_ABBR: Record<string, string> = {
  'Arizona Cardinals': 'ari',
  'Atlanta Falcons': 'atl',
  'Baltimore Ravens': 'bal',
  'Buffalo Bills': 'buf',
  'Carolina Panthers': 'car',
  'Chicago Bears': 'chi',
  'Cincinnati Bengals': 'cin',
  'Cleveland Browns': 'cle',
  'Dallas Cowboys': 'dal',
  'Denver Broncos': 'den',
  'Detroit Lions': 'det',
  'Green Bay Packers': 'gb',
  'Houston Texans': 'hou',
  'Indianapolis Colts': 'ind',
  'Jacksonville Jaguars': 'jax',
  'Kansas City Chiefs': 'kc',
  'Las Vegas Raiders': 'lv',
  'Los Angeles Chargers': 'lac',
  'Los Angeles Rams': 'lar',
  'Miami Dolphins': 'mia',
  'Minnesota Vikings': 'min',
  'New England Patriots': 'ne',
  'New Orleans Saints': 'no',
  'New York Giants': 'nyg',
  'New York Jets': 'nyj',
  'Philadelphia Eagles': 'phi',
  'Pittsburgh Steelers': 'pit',
  'San Francisco 49ers': 'sf',
  'Seattle Seahawks': 'sea',
  'Tampa Bay Buccaneers': 'tb',
  'Tennessee Titans': 'ten',
  'Washington Commanders': 'wsh',
};

export function espnTeamLogoUrl(fullName: string, sportKey?: string): string {
  const sport = SPORTS[sportKey ?? NFL_SPORT_KEY];
  if (!sport?.espnLeague) return '';

  const abbr =
    sport.espnLeague === 'nba'
      ? NBA_ESPN_ABBR[fullName]
      : sport.espnLeague === 'nfl'
        ? NFL_ESPN_ABBR[fullName]
        : undefined;

  return abbr ? `https://a.espncdn.com/i/teamlogos/${sport.espnLeague}/500/${abbr}.png` : '';
}
