// Feature 2 — Project values formatting helpers.

const audCurrency = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0,
});

const audCompact = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0,
  notation: "compact",
});

/** Format an hourly AUD rate, e.g. 400 -> "$400/hr". */
export function formatAUDPerHour(amount: number): string {
  return `${audCurrency.format(amount)}/hr`;
}

/**
 * Format an annualised AUD income estimate.
 * Uses compact notation for >= 10,000 (e.g. "$120K"), full for smaller.
 */
export function formatAUDAnnualised(amount: number): string {
  if (amount >= 10_000) return audCompact.format(amount);
  return audCurrency.format(amount);
}

/** Clamp a 1-5 score; returns null for nullish input. */
export function clampScore(value: number | null | undefined): number | null {
  if (value == null) return null;
  return Math.max(1, Math.min(5, Math.round(value)));
}
