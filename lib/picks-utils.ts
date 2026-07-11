/** Every game's picks lock at its listed kickoff time. */
export function lockTimeAtKickoff(commenceTime: string): number {
  return new Date(commenceTime).getTime();
}

export function computeLockTime(commenceTime: string): number {
  return lockTimeAtKickoff(commenceTime);
}

/** Human-readable countdown to a lock time. */
export function lockCountdown(lockTime: number, now: number): string {
  const ms = lockTime - now;
  if (ms <= 0) return 'Locked';
  const totalMins = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hours >= 48) return `${Math.floor(hours / 24)}d`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}
