'use client';

import { LEAGUE_MEMBERS } from '@/lib/league-members';
import { formatLockRecord } from '@/lib/picks-grading';
import {
  finalScoreLine,
  gameColumnDay,
  gameColumnHeader,
  mascot,
  matchupLine,
  resultGlyph,
} from '@/lib/picks-display';
import type { ArchivedPicksWeek, LockRecord, NFLGame, PicksSeasonState, UserPicksSubmission } from '@/lib/types';

export interface SpreadsheetProps {
  weekLabel: string;
  games: NFLGame[];
  submissions: UserPicksSubmission[];
  sportKey?: string;
  season?: PicksSeasonState | null;
  weeklyPoolDeltas?: Record<string, number>;
  myName?: string;
  /** Archived week snapshot (uses balances/locks from archive). */
  archive?: ArchivedPicksWeek;
}

function displayBalances(
  season: PicksSeasonState | null | undefined,
  weeklyPoolDeltas: Record<string, number> | undefined,
  archive?: ArchivedPicksWeek,
): Record<string, number> {
  if (archive) return archive.balancesAfterWeek;
  const base = season?.balances ?? Object.fromEntries(LEAGUE_MEMBERS.map(m => [m, 0]));
  if (!weeklyPoolDeltas || !Object.keys(weeklyPoolDeltas).length) return base;
  const out = { ...base };
  for (const m of LEAGUE_MEMBERS) {
    out[m] = (base[m] ?? 0) + (weeklyPoolDeltas[m] ?? 0);
  }
  return out;
}

function displayLockRecords(
  season: PicksSeasonState | null | undefined,
  archive?: ArchivedPicksWeek,
): Record<string, LockRecord> {
  if (archive) return archive.lockRecordsAfterWeek;
  return season?.lockRecords ?? Object.fromEntries(
    LEAGUE_MEMBERS.map(m => [m, { wins: 0, losses: 0, pushes: 0 }]),
  );
}

export default function PicksSpreadsheet({
  weekLabel,
  games,
  submissions,
  sportKey,
  season,
  weeklyPoolDeltas,
  myName,
  archive,
}: SpreadsheetProps) {
  const balances = displayBalances(season, weeklyPoolDeltas, archive);
  const lockRecords = displayLockRecords(season, archive);
  const deltas = archive?.weeklyPoolDeltas ?? weeklyPoolDeltas;

  const orderedSubs = LEAGUE_MEMBERS.map(name => {
    return submissions.find(s => s.userName === name) ?? null;
  }).filter((s): s is UserPicksSubmission => s !== null);

  const extraSubs = submissions.filter(s => !LEAGUE_MEMBERS.includes(s.userName as typeof LEAGUE_MEMBERS[number]));
  const allSubs = [...orderedSubs, ...extraSubs];

  return (
    <div className="flex flex-col gap-4">
      {/* Season summary */}
      <div className="px-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-2">Season balance</p>
          <div className="grid grid-cols-2 gap-2">
            {LEAGUE_MEMBERS.map(name => {
              const bal = balances[name] ?? 0;
              const delta = deltas?.[name];
              return (
                <div key={name} className="text-xs">
                  <span className="font-semibold text-slate-700 dark:text-slate-200">{name}</span>
                  <span className={`ml-1 font-bold ${bal >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    {bal >= 0 ? '+' : ''}{bal}
                  </span>
                  {delta != null && delta !== 0 && !archive && (
                    <span className={`ml-1 ${delta > 0 ? 'text-emerald-500' : 'text-red-400'}`}>
                      ({delta > 0 ? '+' : ''}{delta} wk)
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20 p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400 mb-2">
            Lock of the Week (season)
          </p>
          <div className="grid grid-cols-2 gap-2">
            {LEAGUE_MEMBERS.map(name => {
              const rec = lockRecords[name] ?? { wins: 0, losses: 0, pushes: 0 };
              return (
                <div key={name} className="text-xs text-slate-700 dark:text-slate-200">
                  <span className="font-semibold">{name}</span>
                  <span className="ml-1 text-amber-700 dark:text-amber-400 font-bold">{formatLockRecord(rec)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Spreadsheet table */}
      <div className="flex-1 overflow-auto">
        <table className="min-w-max text-sm border-collapse w-full">
          <thead>
            <tr className="bg-slate-800 text-white text-left sticky top-0 z-10">
              <th className="px-4 py-3 font-semibold text-xs whitespace-nowrap sticky left-0 bg-slate-800 z-20">Name</th>
              <th className="px-3 py-3 font-semibold text-xs whitespace-nowrap bg-slate-800 border-r border-slate-700">$</th>
              <th className="px-3 py-3 font-semibold text-xs whitespace-nowrap bg-slate-800 border-r border-slate-700">🔒</th>
              {games.map(game => (
                <th
                  key={game.id}
                  aria-label={gameColumnHeader(game)}
                  className="px-4 py-3 text-left align-bottom"
                  style={{ minWidth: '168px' }}
                >
                  <span className="block text-[10px] font-normal text-slate-400 whitespace-nowrap mb-0.5">
                    {gameColumnDay(game)}
                  </span>
                  <span className="block text-xs font-semibold text-white whitespace-nowrap">
                    {matchupLine(game)}
                  </span>
                  {finalScoreLine(game) && (
                    <span className="block text-[10px] font-normal text-emerald-300 mt-0.5 whitespace-nowrap">
                      Final: {finalScoreLine(game)}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {allSubs.length === 0 ? (
              <tr>
                <td colSpan={3 + games.length} className="px-4 py-8 text-center text-slate-400 text-sm">
                  No picks submitted yet.
                </td>
              </tr>
            ) : (
              allSubs.map((sub, i) => {
                const pickMap: Record<string, { team: string; result?: string }> = {};
                sub.picks.forEach(p => { pickMap[p.gameId] = { team: p.selectedTeam, result: p.result }; });
                const bal = balances[sub.userName] ?? 0;

                return (
                  <tr
                    key={sub.userName}
                    className={`border-b border-slate-100 dark:border-slate-800 ${
                      i % 2 === 0 ? 'bg-white dark:bg-slate-900' : 'bg-slate-50 dark:bg-slate-900/50'
                    } ${sub.userName === myName ? 'ring-1 ring-inset ring-amber-400' : ''}`}
                  >
                    <td className="px-4 py-2.5 font-semibold text-slate-800 dark:text-slate-100 whitespace-nowrap sticky left-0 bg-inherit">
                      {sub.userName}
                      {sub.userName === myName && <span className="ml-1 text-[10px] text-amber-500">★</span>}
                    </td>
                    <td className={`px-3 py-2.5 text-xs font-bold whitespace-nowrap border-r border-slate-100 dark:border-slate-800 ${
                      bal >= 0 ? 'text-emerald-600' : 'text-red-500'
                    }`}>
                      {bal >= 0 ? '+' : ''}{bal}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-amber-700 dark:text-amber-400 whitespace-nowrap border-r border-slate-100 dark:border-slate-800">
                      {formatLockRecord(lockRecords[sub.userName] ?? { wins: 0, losses: 0, pushes: 0 })}
                    </td>
                    {games.map(game => {
                      const picked = pickMap[game.id];
                      const isLock = sub.lockOfWeekGameId === game.id;
                      const glyph = resultGlyph(picked?.result);
                      const resultClass =
                        picked?.result === 'win'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : picked?.result === 'loss'
                            ? 'text-red-500'
                            : picked?.result === 'push'
                              ? 'text-slate-600 dark:text-slate-400'
                              : '';

                      return (
                        <td
                          key={game.id}
                          className={`px-4 py-2.5 whitespace-nowrap ${
                            isLock
                              ? 'bg-amber-100 dark:bg-amber-950/40 ring-1 ring-inset ring-amber-400/60'
                              : ''
                          }`}
                        >
                          {picked ? (
                            <span className={`inline-flex items-center gap-1.5 font-medium ${resultClass || 'text-slate-700 dark:text-slate-300'}`}>
                              {isLock && <span className="text-amber-600 dark:text-amber-400" title="Lock of the Week">🔒</span>}
                              <span>{mascot(picked.team)}</span>
                              {glyph && (
                                <span className={`text-xs font-black ${resultClass}`}>{glyph}</span>
                              )}
                            </span>
                          ) : (
                            <span className="text-slate-300 dark:text-slate-600">–</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="px-4 text-[10px] text-slate-600 dark:text-slate-400 pb-2">
        {weekLabel}
        {sportKey ? ` · ${sportKey}` : ''}
        {archive ? ` · Archived ${new Date(archive.archivedAt).toLocaleDateString()}` : ''}
      </p>
    </div>
  );
}
