// filepath: client/src/components/WeekUpdatesCard.tsx
// Stage 31 — project Updates in the weekly review: how many project changes
// happened in the last 7 days, the busiest projects, and a link to the full
// Updates feed. Read-only.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";

type UpdateEvent = { id: number; projectId: number; projectName: string | null; kind: string };

export function WeekUpdatesCard() {
  const q = useQuery<{ days: number; events: UpdateEvent[] }>({
    queryKey: ["/api/updates", 7, "", ""],
    queryFn: async () => (await apiRequest("GET", "/api/updates?days=7")).json(),
  });
  const events = q.data?.events ?? [];
  const top = useMemo(() => {
    const m = new Map<number, { name: string; n: number }>();
    for (const e of events) {
      const cur = m.get(e.projectId) ?? { name: e.projectName ?? `Project ${e.projectId}`, n: 0 };
      cur.n++;
      m.set(e.projectId, cur);
    }
    return Array.from(m.entries()).sort((a, b) => b[1].n - a[1].n).slice(0, 5);
  }, [events]);
  const done = events.filter((e) => e.kind === "task_done").length;

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-2" data-testid="week-updates-card">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-sm font-medium">Project updates this week</div>
        <Link href="/updates" className="text-xs underline" data-testid="link-week-updates">Open Updates</Link>
      </div>
      {q.isLoading ? (
        <div className="text-xs text-muted-foreground">Loading…</div>
      ) : events.length === 0 ? (
        <div className="text-xs text-muted-foreground">No project changes in the last 7 days.</div>
      ) : (
        <>
          <div className="text-xs text-muted-foreground">
            {events.length} change{events.length === 1 ? "" : "s"}{done ? `, ${done} task${done === 1 ? "" : "s"} done` : ""}
          </div>
          <ul className="text-sm space-y-0.5">
            {top.map(([id, p]) => (
              <li key={id} className="flex justify-between gap-2">
                <Link href={`/projects/${id}`} className="truncate hover:underline">{p.name}</Link>
                <span className="text-xs text-muted-foreground tabular-nums">{p.n}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
