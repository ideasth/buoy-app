import { describe, it, expect } from "vitest";
import {
  AEDT_RETUNE_INVENTORY,
  parseHourField,
  renderAedtRetuneList,
} from "../shared/cron-inventory";

// Every cron in the AEDT retune inventory must shift its UTC hour(s) by exactly
// -1 from the current schedule to the AEDT schedule. The minute, day-of-month,
// month, and day-of-week fields must NOT change. Day rollover is handled by
// modular arithmetic (e.g. UTC 0 -> 23 of the previous day).
//
// This test is the load-bearing check that cron 236aa4a4's reminder body stays
// honest. If a cron is added or removed in production, update the inventory
// and this test will keep the AEDT body in sync.

describe("AEDT retune inventory", () => {
  it("contains only the recurring Perplexity crons that survive the Stage 12b VPS offload", () => {
    // Stage 12c trim: the six crons offloaded to systemd timers on wmu
    // (8e8b7bb5, 0697627f, 67fb0e91, b4a58a27, 28a67578, d08f13f1) were
    // deleted from Perplexity. The reminder cron 236aa4a4 is itself one-shot
    // and is intentionally NOT in this list — it references the list.
    const ids = AEDT_RETUNE_INVENTORY.map((e) => e.id).sort();
    expect(ids).toEqual([
      "17df3d7e",
      "2928f9fa",
      "c751741f",
    ].sort());
    expect(ids).not.toContain("236aa4a4");
    // Sanity: none of the offloaded ids leaked back in.
    for (const offloaded of [
      "8e8b7bb5",
      "0697627f",
      "67fb0e91",
      "b4a58a27",
      "28a67578",
      "d08f13f1",
    ]) {
      expect(ids, `offloaded cron ${offloaded} should not be in inventory`).not.toContain(offloaded);
    }
  });

  it.each(AEDT_RETUNE_INVENTORY)(
    "$id ($label): aedtCron is currentCron shifted -1 hour (UTC)",
    ({ id, currentCron, aedtCron }) => {
      const currentFields = currentCron.split(/\s+/);
      const aedtFields = aedtCron.split(/\s+/);
      expect(currentFields.length, `${id}: currentCron must have 5 fields`).toBe(5);
      expect(aedtFields.length, `${id}: aedtCron must have 5 fields`).toBe(5);

      // Minute, day-of-month, month, day-of-week must be identical.
      expect(currentFields[0], `${id}: minute changed`).toBe(aedtFields[0]);
      expect(currentFields[2], `${id}: day-of-month changed`).toBe(aedtFields[2]);
      expect(currentFields[3], `${id}: month changed`).toBe(aedtFields[3]);
      expect(currentFields[4], `${id}: day-of-week changed`).toBe(aedtFields[4]);

      // Hour(s) shift by exactly -1 modulo 24.
      const currentHours = parseHourField(currentCron);
      const aedtHours = parseHourField(aedtCron);
      expect(currentHours.length, `${id}: hour count changed`).toBe(aedtHours.length);
      const expected = currentHours.map((h) => (h + 23) % 24);
      // Compare as sets — comma order can vary.
      expect(new Set(aedtHours), `${id}: AEDT hours not -1 of current`).toEqual(new Set(expected));
    },
  );

  it("renderAedtRetuneList contains every id and arrow notation", () => {
    const rendered = renderAedtRetuneList();
    for (const e of AEDT_RETUNE_INVENTORY) {
      expect(rendered, `missing entry for ${e.id}`).toContain(e.id);
      expect(rendered, `missing arrow for ${e.id}`).toContain(`${e.currentCron} -> ${e.aedtCron}`);
    }
    // Every line is an inventory entry; no extras.
    expect(rendered.split("\n").length).toBe(AEDT_RETUNE_INVENTORY.length);
  });

  it("parseHourField rejects ranges and steps", () => {
    expect(() => parseHourField("0 0-5 * * *")).toThrow(/unsupported/);
    expect(() => parseHourField("0 */2 * * *")).toThrow(/unsupported/);
  });

  it("parseHourField parses comma-separated hours", () => {
    expect(parseHourField("0 8,20 * * *")).toEqual([8, 20]);
    expect(parseHourField("0 17 * * 6")).toEqual([17]);
  });
});
