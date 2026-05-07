import { storage } from "./storage";

const ALPHA = 0.3; // learning rate for exponential moving average

/**
 * calibrate — called after a new balance entry is saved.
 * Compares predicted vs actual credit consumption between the two most-recent
 * balance entries and gently updates per-run estimates.
 */
export function calibrate(): boolean {
  const balances = storage.getLastTwoCreditBalances();
  if (balances.length < 2) return false;

  // Ordered DESC: [newer, older]
  const newer = balances[0];
  const older = balances[1];

  const gapMs = newer.recordedAt - older.recordedAt;
  const twelveH = 12 * 60 * 60 * 1000;
  const sevenD = 7 * 24 * 60 * 60 * 1000;
  if (gapMs < twelveH || gapMs > sevenD) return false;

  const actualUsed = older.balance - newer.balance;
  if (actualUsed <= 0) return false; // credits increased or unchanged — skip

  const runs = storage.getCronRunsBetween(older.recordedAt, newer.recordedAt);
  if (runs.length === 0) return false;

  // Count by cronType
  const counts: Record<string, number> = {};
  for (const r of runs) {
    counts[r.cronType] = (counts[r.cronType] ?? 0) + 1;
  }

  const estimates = storage.getAllCreditEstimates();
  const estimateMap: Record<string, { perRunCredits: number; sampleCount: number }> = {};
  for (const e of estimates) {
    estimateMap[e.cronType] = { perRunCredits: e.perRunCredits, sampleCount: e.sampleCount };
  }

  // Predicted usage
  let predictedUsed = 0;
  for (const [cronType, count] of Object.entries(counts)) {
    const est = estimateMap[cronType];
    if (est) predictedUsed += count * est.perRunCredits;
  }
  if (predictedUsed === 0) return false;

  const scalingFactor = actualUsed / predictedUsed;

  // Update each estimate using EMA
  for (const [cronType, count] of Object.entries(counts)) {
    if (count === 0) continue;
    const est = estimateMap[cronType];
    if (!est) continue;

    const scaledEstimate = est.perRunCredits * scalingFactor;
    const newEstimate = est.perRunCredits * (1 - ALPHA) + scaledEstimate * ALPHA;
    storage.updateCreditEstimate(cronType, newEstimate, est.sampleCount + 1);
  }

  return true;
}

/**
 * estimateLast24h — sum of (runs * perRunEstimate) for last 24h.
 */
export function estimateLast24h(): number {
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const runCounts = storage.getCronRunCountsByType(since);
  if (runCounts.length === 0) return 0;

  const estimates = storage.getAllCreditEstimates();
  const estimateMap: Record<string, number> = {};
  for (const e of estimates) estimateMap[e.cronType] = e.perRunCredits;

  let total = 0;
  for (const { cronType, count } of runCounts) {
    total += count * (estimateMap[cronType] ?? 0);
  }
  return Math.round(total);
}

/**
 * actualLast24h — null if <2 balance entries in the last 24h.
 * Returns first.balance - last.balance (positive = credits spent).
 */
export function actualLast24h(): number | null {
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const rows = storage.getCreditBalancesSince(since);
  if (rows.length < 2) return null;
  return rows[0].balance - rows[rows.length - 1].balance;
}

/**
 * lastBalance — most recent credit_balances row with ageHours.
 */
export function lastBalance(): { balance: number; recordedAt: number; ageHours: number } | null {
  const rows = storage.getLastTwoCreditBalances();
  if (rows.length === 0) return null;
  const row = rows[0];
  const ageHours = (Date.now() - row.recordedAt) / (1000 * 60 * 60);
  return { balance: row.balance, recordedAt: row.recordedAt, ageHours: Math.round(ageHours * 10) / 10 };
}

/**
 * runs24hByType — { cronType: count } for last 24h.
 */
export function runs24hByType(): Record<string, number> {
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const rows = storage.getCronRunCountsByType(since);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.cronType] = r.count;
  return out;
}
