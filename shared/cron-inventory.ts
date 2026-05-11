// Canonical inventory of Anchor's recurring Perplexity crons that need retuning
// at the AEDT cutover (Sun 5 Oct 2026 03:00 AEST -> 03:00 AEDT, clocks jump +1h).
//
// This is the source of truth for the AEDT cutover reminder (cron 236aa4a4).
// When that cron fires on Sat 3 Oct 2026, the proposed retune list it shows
// to the user MUST match this file. If you add or remove a cron, update this
// list and the test in test/cron-inventory.test.ts will keep things honest.
//
// Each entry's `aedtCron` is the `currentCron` shifted -1 hour in UTC, so
// that the Melbourne local time stays the same after AEDT begins.
//
// Stage 12c: this list was trimmed to only the recurring Perplexity crons that
// remain after the Stage 12b VPS offload. The six crons offloaded to systemd
// timers on the wmu VPS (anchor-backup-datadb, anchor-prune-backups,
// anchor-warm-calendar, anchor-warm-morning, anchor-warm-weekly-review,
// anchor-verify-backup-receipt) live in the systemd timer manifest in
// server/admin-db.ts SYSTEMD_TIMERS and are unaffected by AEDT (they fire on
// Melbourne local time directly).

export interface CronInventoryEntry {
  /** 8-char short cron id assigned by the platform. */
  id: string;
  /** Short human label. */
  label: string;
  /** Current UTC cron expression (valid before 2026-10-05). */
  currentCron: string;
  /** UTC cron expression to apply on/after 2026-10-05 to keep the same Melbourne local time. */
  aedtCron: string;
  /** Local Melbourne time (informational; does not change at the cutover). */
  melbourneLocal: string;
}

export const AEDT_RETUNE_INVENTORY: ReadonlyArray<CronInventoryEntry> = [
  {
    id: "17df3d7e",
    label: "Outlook+Capture bridge (every 2h 06-22)",
    currentCron: "54 0,2,4,6,8,10,12,20,22 * * *",
    aedtCron: "54 23,1,3,5,7,9,11,19,21 * * *",
    melbourneLocal: "every 2h, 06-22",
  },
  {
    id: "2928f9fa",
    label: "calendar sync ICS-only (06:00 + 18:00)",
    currentCron: "0 8,20 * * *",
    aedtCron: "0 7,19 * * *",
    melbourneLocal: "06:00 and 18:00 daily",
  },
  {
    id: "c751741f",
    label: "Email Status pull (6-hourly 00/06/12/18)",
    currentCron: "0 20,2,8,14 * * *",
    aedtCron: "0 19,1,7,13 * * *",
    melbourneLocal: "00:00, 06:00, 12:00, 18:00 daily",
  },
] as const;

/**
 * Render the inventory as the markdown bullet list used in cron 236aa4a4's body.
 * The cron body should match this output verbatim. If the cron body is edited
 * by hand, run this function and replace the list to keep things in sync.
 */
export function renderAedtRetuneList(): string {
  return AEDT_RETUNE_INVENTORY.map(
    (e) => `- ${e.id} (${e.label}): ${e.currentCron} -> ${e.aedtCron}`,
  ).join("\n");
}

/**
 * Parse a UTC cron expression's hour field and return all hours as integers.
 * Supports comma-separated values. Does NOT support ranges or steps —
 * the inventory only uses comma lists or single values.
 */
export function parseHourField(cron: string): number[] {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`expected 5 cron fields, got ${fields.length}: ${cron}`);
  const hourField = fields[1];
  if (!/^[0-9,]+$/.test(hourField)) {
    throw new Error(`unsupported hour field syntax (no ranges/steps allowed): ${hourField}`);
  }
  return hourField.split(",").map((s) => {
    const n = Number(s);
    if (!Number.isInteger(n) || n < 0 || n > 23) throw new Error(`invalid hour: ${s}`);
    return n;
  });
}
