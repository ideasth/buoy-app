// filepath: client/src/pages/Updates.tsx
// Stage 26a — read-only feed of recent project changes, newest first,
// grouped by Melbourne day. Changes are still made on the project page.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";

type UpdateEvent = {
  id: number;
  projectId: number;
  projectName: string | null;
  at: number;
  kind: string;
  summary: string;
};

const KIND_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "All changes" },
  { value: "status", label: "Status" },
  { value: "priority", label: "Priority" },
  { value: "focus", label: "Focus of the week" },
  { value: "note", label: "Notes" },
  { value: "task_done", label: "Tasks done" },
  { value: "component", label: "Components" },
  { value: "phase", label: "Phases" },
  { value: "capture", label: "Captures" },
  { value: "created", label: "New projects" },
  { value: "renamed", label: "Renamed" },
];

const dayKey = (ms: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
const dayLabel = (ms: number) =>
  new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", weekday: "long", day: "numeric", month: "long" }).format(new Date(ms));
const timeLabel = (ms: number) =>
  new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ms));

export default function Updates() {
  const [days, setDays] = useState<7 | 30>(7);
  const [kind, setKind] = useState("");
  const [projectId, setProjectId] = useState("");

  const q = useQuery<{ days: number; events: UpdateEvent[] }>({
    queryKey: ["/api/updates", days, kind, projectId],
    queryFn: async () => {
      const qs = new URLSearchParams({ days: String(days) });
      if (kind) qs.set("kind", kind);
      if (projectId) qs.set("projectId", projectId);
      return (await apiRequest("GET", `/api/updates?${qs}`)).json();
    },
  });
  const events = q.data?.events ?? [];

  // Project filter options come from what is in the current window.
  const projectOptions = useMemo(() => {
    const m = new Map<number, string>();
    for (const e of events) if (!m.has(e.projectId)) m.set(e.projectId, e.projectName ?? `Project ${e.projectId}`);
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [events]);

  const groups = useMemo(() => {
    const out: Array<{ key: string; label: string; items: UpdateEvent[] }> = [];
    for (const e of events) {
      const k = dayKey(e.at);
      let g = out[out.length - 1];
      if (!g || g.key !== k) { g = { key: k, label: dayLabel(e.at), items: [] }; out.push(g); }
      g.items.push(e);
    }
    return out;
  }, [events]);

  return (
    <div className="px-5 md:px-8 py-8 md:py-10 space-y-6">
      <header>
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Time-Task Management</div>
        <h1 className="text-2xl font-semibold mt-1">Updates</h1>
        <p className="text-sm text-muted-foreground mt-1">
          What has changed across your projects. Read-only - open a project to make changes.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2" data-testid="updates-filters">
        <div className="inline-flex rounded-md border">
          {([7, 30] as const).map((d) => (
            <Button key={d} size="sm" variant={days === d ? "default" : "ghost"} onClick={() => setDays(d)} data-testid={`updates-days-${d}`}>
              {d} days
            </Button>
          ))}
        </div>
        <select
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          aria-label="Type of change"
          data-testid="updates-kind"
        >
          {KIND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select
          className="h-9 rounded-md border bg-background px-2 text-sm max-w-[16rem]"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          aria-label="Project"
          data-testid="updates-project"
        >
          <option value="">All projects</option>
          {projectOptions.map(([id, name]) => <option key={id} value={String(id)}>{name}</option>)}
        </select>
      </div>

      {q.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {q.isError && <div className="text-sm text-destructive">Could not load updates.</div>}
      {!q.isLoading && !q.isError && events.length === 0 && (
        <div className="text-sm text-muted-foreground" data-testid="updates-empty">
          No project changes in the last {days} days. Changes are recorded from 9 November 2026 onwards.
        </div>
      )}

      <div className="space-y-6">
        {groups.map((g) => (
          <section key={g.key}>
            <h2 className="text-sm font-semibold text-muted-foreground mb-2">{g.label}</h2>
            <ul className="divide-y rounded-md border">
              {g.items.map((e) => (
                <li key={e.id} className="px-4 py-3 flex items-baseline gap-3" data-testid={`update-${e.id}`}>
                  <span className="text-xs tabular-nums text-muted-foreground w-12 shrink-0">{timeLabel(e.at)}</span>
                  <div className="min-w-0">
                    <Link href={`/projects/${e.projectId}`} className="font-medium hover:underline">
                      {e.projectName ?? `Project ${e.projectId}`}
                    </Link>
                    <div className="text-sm text-muted-foreground break-words">{e.summary}</div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
