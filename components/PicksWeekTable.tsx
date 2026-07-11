'use client';

import { LEAGUE_MEMBERS } from '@/lib/league-members';
import {
  gameColumnDay,
  gameColumnHeader,
  matchupLine,
  mascot,
  finalScoreLine,
  resultGlyph,
} from '@/lib/picks-display';
import type { NFLGame, UserPicksSubmission } from '@/lib/types';

function resultClass(result?: string): string {
  if (result === 'win') return 'text-emerald-600 dark:text-emerald-400 font-bold';
  if (result === 'loss') return 'text-red-600 dark:text-red-400 font-bold';
  if (result === 'push') return 'text-slate-500 font-semibold';
  return '';
}

export interface PicksWeekTableProps {
  weekLabel: string;
  games: NFLGame[];
  submissions: UserPicksSubmission[];
  myName: string;
  /** Weekly pool $ per player; omit column when undefined and showPool false */
  poolDeltas?: Record<string, number>;
  showPool?: boolean;
  /** Shown below table for archived weeks */
  balancesAfterWeek?: Record<string, number>;
  footer?: React.ReactNode;
}

export default function PicksWeekTable({
  weekLabel,
  games,
  submissions,
  myName,
  poolDeltas,
  showPool = Boolean(poolDeltas),
  balancesAfterWeek,
  footer,
}: PicksWeekTableProps) {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-auto">
        <table className="min-w-max text-sm border-collapse w-full">
          <thead>
            <tr className="bg-slate-800 text-white sticky top-0 z-10">
              <th className="px-3 py-2 text-xs sticky left-0 bg-slate-800 z-20">Name</th>
              <th className="px-3 py-2 text-xs">Lock</th>
              {games.map(game => (
                <th
                  key={game.id}
                  className="px-3 py-2 text-left align-bottom"
                  aria-label={gameColumnHeader(game)}
                >
                  <span className="block text-[10px] text-slate-400">{gameColumnDay(game)}</span>
                  <span className="block text-xs whitespace-nowrap">{matchupLine(game)}</span>
                  {finalScoreLine(game) && (
                    <span className="block text-[10px] text-emerald-400 font-normal">
                      {finalScoreLine(game)}
                    </span>
                  )}
                </th>
              ))}
              {showPool && <th className="px-3 py-2 text-xs">Week $</th>}
            </tr>
          </thead>
          <tbody>
            {LEAGUE_MEMBERS.map((name, i) => {
              const sub = submissions.find(s => s.userName === name);
              const pickMap = new Map(sub?.picks.map(p => [p.gameId, p]) ?? []);
              const lockGame = games.find(g => g.id === sub?.lockOfWeekGameId);
              const lockPick = lockGame ? pickMap.get(lockGame.id) : undefined;
              const delta = poolDeltas?.[name];

              return (
                <tr
                  key={name}
                  className={`border-b border-slate-100 dark:border-slate-800 ${
                    i % 2 ? 'bg-slate-50 dark:bg-slate-900/50' : 'bg-white dark:bg-slate-900'
                  } ${name === myName ? 'ring-1 ring-inset ring-amber-400' : ''}`}
                >
                  <td className="px-3 py-2 font-semibold sticky left-0 bg-inherit whitespace-nowrap text-slate-800 dark:text-slate-100">
                    {name}
                  </td>
                  <td className="px-3 py-2 text-xs text-amber-600 whitespace-nowrap">
                    {lockPick ? mascot(lockPick.selectedTeam) : '–'}
                  </td>
                  {games.map(game => {
                    const p = pickMap.get(game.id);
                    return (
                      <td key={game.id} className="px-3 py-2 whitespace-nowrap">
                        {p ? (
                          <span className={resultClass(p.result)}>
                            {mascot(p.selectedTeam)}
                            {p.result && p.result !== 'pending' && (
                              <span className="ml-1">{resultGlyph(p.result)}</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-slate-300 dark:text-slate-600">–</span>
                        )}
                      </td>
                    );
                  })}
                  {showPool && (
                    <td
                      className={`px-3 py-2 font-mono text-xs whitespace-nowrap ${
                        (delta ?? 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                      }`}
                    >
                      {delta !== undefined
                        ? `${delta >= 0 ? '+' : ''}${delta}`
                        : '–'}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {balancesAfterWeek && (
        <div className="shrink-0 px-4 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/80">
          <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-2">
            Season balance after {weekLabel}
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {[...LEAGUE_MEMBERS]
              .sort((a, b) => (balancesAfterWeek[b] ?? 0) - (balancesAfterWeek[a] ?? 0))
              .map(name => (
                <span key={name} className={name === myName ? 'font-bold text-amber-600' : 'text-slate-600 dark:text-slate-300'}>
                  {name}: {(balancesAfterWeek[name] ?? 0) >= 0 ? '+' : ''}{balancesAfterWeek[name] ?? 0}$
                </span>
              ))}
          </div>
        </div>
      )}

      {footer}
    </div>
  );
}
