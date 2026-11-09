// filepath: client/src/lib/emailThreads.ts
// Stage 34 — group sorted-inbox emails into conversation threads.
// Thread key = subject with reply/forward prefixes and tags removed, so
// "Re: Fwd: [EXTERNAL] Theatre list" and "Theatre list" land together.
// Threads are ordered by their most recent email; emails inside a thread
// are newest first.

const PREFIX_RE = /^\s*(?:(?:re|fw|fwd|aw|wg|sv|antw|r)\s*(?:\[\d+\])?\s*:|\[[^\]]{1,40}\]|\((?:external|ext)\)|(?:external|caution)\s*:)\s*/i;

export function threadKey(subject: string | null | undefined): string {
  let s = String(subject ?? "").trim();
  for (let i = 0; i < 12; i++) {
    const next = s.replace(PREFIX_RE, "");
    if (next === s) break;
    s = next;
  }
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

export interface ThreadGroup<T> { key: string; latest: number; items: T[] }

export function groupByThread<T extends { subject: string; received_at: number; id: number }>(items: T[]): ThreadGroup<T>[] {
  const map = new Map<string, ThreadGroup<T>>();
  for (const it of items) {
    // Emails with no subject never merge with each other.
    const k = threadKey(it.subject) || `__nosubject_${it.id}`;
    const g = map.get(k) ?? { key: k, latest: 0, items: [] };
    g.items.push(it);
    g.latest = Math.max(g.latest, it.received_at);
    map.set(k, g);
  }
  const groups = Array.from(map.values());
  for (const g of groups) g.items.sort((a, b) => b.received_at - a.received_at);
  groups.sort((a, b) => b.latest - a.latest);
  return groups;
}
