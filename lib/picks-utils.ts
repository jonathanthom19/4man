/**
 * Computes the lock time for an NFL game pick.
 *
 * Rules:
 *   - Games that kick off BEFORE Sunday 1 PM ET → lock at kickoff
 *   - All other games (Sunday 1 PM, Sunday afternoon/night, Monday night) → lock at Sunday 1 PM ET
 *
 * This mirrors the most common pick'em format: the "main" deadline is when the
 * first Sunday 1 PM game kicks off, but early-week games (Thursday, Friday, Saturday)
 * lock individually so you can't wait and pick based on other results.
 */
export function computeLockTime(commenceTime: string): number {
  const kickoff = new Date(commenceTime);

  // ── Step 1: find the Sunday of this NFL week (in Eastern time) ────────────
  const etDay = kickoff.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/New_York' });
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dow = dayMap[etDay] ?? kickoff.getDay();

  // Days to shift to reach Sunday of the SAME NFL week:
  //   Thu(4) → +3, Fri(5) → +2, Sat(6) → +1, Sun(0) → 0
  //   Mon(1) → -1, Tue(2) → -2, Wed(3) → -3  (MNF etc. — lock on previous Sunday)
  const daysOffset = dow === 0 ? 0 : dow >= 4 ? 7 - dow : -dow;

  const sundayApprox = new Date(kickoff);
  sundayApprox.setDate(sundayApprox.getDate() + daysOffset);

  // YYYY-MM-DD for that Sunday in Eastern time
  const sundayDateStr = sundayApprox.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

  // ── Step 2: determine 1 PM ET in UTC for that Sunday ─────────────────────
  // Probe 17:00 UTC to detect EDT vs EST:
  //   17:00 UTC = 13:00 EDT  →  probeETHour = 13  →  UTC hour for 1 PM ET = 17
  //   17:00 UTC = 12:00 EST  →  probeETHour = 12  →  UTC hour for 1 PM ET = 18
  const probe      = new Date(`${sundayDateStr}T17:00:00Z`);
  const probeHour  = parseInt(probe.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', hour12: false,
  }), 10);
  const utcHour    = probeHour === 12 ? 18 : 17;
  const sunday1pm  = new Date(`${sundayDateStr}T${String(utcHour).padStart(2, '0')}:00:00Z`);

  // ── Step 3: earlier of kickoff or Sunday 1 PM ET ──────────────────────────
  return Math.min(kickoff.getTime(), sunday1pm.getTime());
}

/** Human-readable countdown to a lock time. */
export function lockCountdown(lockTime: number, now: number): string {
  const ms = lockTime - now;
  if (ms <= 0) return 'Locked';
  const totalMins = Math.floor(ms / 60_000);
  const hours     = Math.floor(totalMins / 60);
  const mins      = totalMins % 60;
  if (hours >= 48) return `${Math.floor(hours / 24)}d`;
  if (hours > 0)   return `${hours}h ${mins}m`;
  return `${mins}m`;
}
