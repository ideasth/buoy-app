// Coach context-bundle telemetry. Given the bundle that was sent to the model
// and the assistant text, return which top-level bundle keys the response
// actually referenced. The signal is "did at least one entity name from
// bundle.<key> appear as a substring of the response text?" — model-agnostic,
// no prompt changes, deterministic.
//
// Caveats:
// - Common short tokens (1-3 chars) are skipped to avoid false positives.
// - Plain-text dates (YYYY-MM-DD) and ymd strings are matched as exact.
// - Numeric-only entries are skipped (too noisy).

import type { CoachContextBundle } from "./coach-context";

function collectStrings(value: unknown, out: Set<string>, depth = 0): void {
  if (depth > 5) return;
  if (value == null) return;
  if (typeof value === "string") {
    const s = value.trim();
    if (s.length >= 4 && !/^\d+$/.test(s)) out.add(s);
    return;
  }
  if (typeof value === "number" || typeof value === "boolean") return;
  if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, out, depth + 1);
    return;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value)) collectStrings(v, out, depth + 1);
  }
}

/**
 * Returns the bundle's top-level keys that have at least one string value
 * appearing in the assistant's response text. `bundleKeysPresent` is the full
 * set of top-level keys that actually had non-empty content in the bundle
 * (so admin Health can show "n keys referenced of m present").
 */
export function detectReferencedBundleKeys(
  bundle: CoachContextBundle,
  responseText: string,
): { bundleKeysPresent: string[]; bundleKeysReferenced: string[] } {
  const text = responseText || "";
  const bundleKeysPresent: string[] = [];
  const bundleKeysReferenced: string[] = [];

  for (const [key, value] of Object.entries(bundle as unknown as Record<string, unknown>)) {
    const isPresent =
      value != null &&
      (typeof value === "string"
        ? value.length > 0
        : Array.isArray(value)
          ? value.length > 0
          : typeof value === "object"
            ? Object.keys(value as object).length > 0
            : true);
    if (!isPresent) continue;
    bundleKeysPresent.push(key);

    const strings = new Set<string>();
    collectStrings(value, strings);
    let referenced = false;
    const lowerText = text.toLowerCase();
    // Use Array.from to avoid downlevel-iteration on Set.
    for (const s of Array.from(strings)) {
      if (lowerText.includes(s.toLowerCase())) {
        referenced = true;
        break;
      }
    }
    if (referenced) bundleKeysReferenced.push(key);
  }

  return { bundleKeysPresent, bundleKeysReferenced };
}
