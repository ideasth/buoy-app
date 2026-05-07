import { useQuery } from "@tanstack/react-query";
import type { Task, TopThree } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { domainLabel, todayDateStr, fmtDuration } from "@/lib/anchor";
import { Button } from "@/components/ui/button";
import { ArrowDown, ArrowUp, Target, X, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";

const DOMAIN_GROUPS = [
  { key: "family", title: "Family first", subtitle: "Hilde · Axel · Marieke" },
  { key: "work", title: "Clinical work" },
  { key: "medicolegal", title: "Medicolegal" },
  { key: "health", title: "Health" },
  { key: "personal", title: "Personal" },
];

export default function Priorities() {
  const date = todayDateStr();
  const tasksQ = useQuery<Task[]>({ queryKey: ["/api/tasks"] });
  const topQ = useQuery<TopThree>({
    queryKey: ["/api/top-three", date],
    queryFn: async () => (await apiRequest("GET", `/api/top-three?date=${date}`)).json(),
  });
  const { toast } = useToast();
  const [order, setOrder] = useState<number[] | null>(null);

  const open = useMemo(
    () => (tasksQ.data ?? []).filter((t) => t.status === "todo" || t.status === "doing"),
    [tasksQ.data],
  );

  const initial = useMemo(() => open.map((t) => t.id), [open]);
  const ids = order ?? initial;

  // Re-derive ordered list from tasks data
  const tasksById = useMemo(() => {
    const m = new Map<number, Task>();
    for (const t of tasksQ.data ?? []) m.set(t.id, t);
    return m;
  }, [tasksQ.data]);

  const ordered = ids.map((id) => tasksById.get(id)).filter((t): t is Task => !!t);

  const move = (idx: number, dir: -1 | 1) => {
    const next = [...ids];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    setOrder(next);
  };

  const setSlot = async (taskId: number, slot: 1 | 2 | 3) => {
    const cur = topQ.data ?? { taskId1: null, taskId2: null, taskId3: null };
    const next: any = {
      taskId1: cur.taskId1,
      taskId2: cur.taskId2,
      taskId3: cur.taskId3,
    };
    // If task is already a top, clear it
    for (const k of ["taskId1", "taskId2", "taskId3"] as const) {
      if (next[k] === taskId) next[k] = null;
    }
    next[`taskId${slot}`] = taskId;
    await apiRequest("PUT", "/api/top-three", { date, ...next });
    queryClient.invalidateQueries({ queryKey: ["/api/top-three", date] });
    toast({ title: `Set as #${slot}` });
  };

  const drop = async (id: number) => {
    await apiRequest("PATCH", `/api/tasks/${id}`, { status: "dropped" });
    queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
  };
  const done = async (id: number) => {
    await apiRequest("PATCH", `/api/tasks/${id}`, { status: "done" });
    queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
  };

  const slotMap = new Map<number, number>();
  if (topQ.data?.taskId1) slotMap.set(topQ.data.taskId1, 1);
  if (topQ.data?.taskId2) slotMap.set(topQ.data.taskId2, 2);
  if (topQ.data?.taskId3) slotMap.set(topQ.data.taskId3, 3);

  return (
    <div className="px-5 md:px-8 py-8 md:py-10 space-y-8">
      <header>
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Priorities</div>
        <h1 className="text-2xl font-semibold mt-1">Family first triage.</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Pick three. Move the rest down. Drop anything you can.
        </p>
      </header>

      {/* Top 3 summary */}
      <div className="grid grid-cols-3 gap-2">
        {[1, 2, 3].map((s) => {
          const id = (topQ.data as any)?.[`taskId${s}`];
          const t = id ? tasksById.get(id) : null;
          return (
            <div
              key={s}
              className={cn(
                "rounded-lg border p-3 min-h-[72px]",
                t ? "border-primary/40 bg-primary/5" : "border-dashed border-border",
              )}
              data-testid={`top-slot-${s}`}
            >
              <div className="text-xs uppercase tracking-wider text-muted-foreground">#{s}</div>
              <div className="text-sm font-medium truncate mt-1">
                {t ? t.title : "empty"}
              </div>
            </div>
          );
        })}
      </div>

      {/* Domain groups (family-first) */}
      {DOMAIN_GROUPS.map((g) => {
        const items = ordered.filter((t) => t.domain === g.key);
        if (items.length === 0) return null;
        return (
          <section key={g.key}>
            <div className="mb-3">
              <h2 className="text-base font-semibold">{g.title}</h2>
              {g.subtitle && (
                <div className="text-xs text-muted-foreground">{g.subtitle}</div>
              )}
            </div>
            <div className="space-y-2">
              {items.map((t) => {
                const idxInIds = ids.indexOf(t.id);
                const slot = slotMap.get(t.id);
                return (
                  <div
                    key={t.id}
                    className={cn(
                      "rounded-lg border bg-card p-3 space-y-2",
                      slot && "border-primary/40 bg-primary/5",
                    )}
                    data-testid={`priority-row-${t.id}`}
                  >
                    <div className="flex items-start gap-2">
                      <div className="flex flex-col gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => move(idxInIds, -1)}
                          aria-label="Move up"
                          data-testid={`button-up-${t.id}`}
                          className="h-6 w-6"
                        >
                          <ArrowUp className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => move(idxInIds, 1)}
                          aria-label="Move down"
                          data-testid={`button-down-${t.id}`}
                          className="h-6 w-6"
                        >
                          <ArrowDown className="h-3 w-3" />
                        </Button>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium leading-snug">{t.title}</div>
                        <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap items-center gap-2">
                          <span>
                            {domainLabel(t.domain)} · est {fmtDuration(t.estimateMinutes)}
                            {slot ? ` · in top ${slot}` : ""}
                          </span>
                          {t.tag && (
                            <span
                              className="rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px]"
                              title={t.tag}
                              data-testid={`tag-priority-${t.id}`}
                            >
                              {t.tag.length > 22 ? `${t.tag.slice(0, 21)}…` : t.tag}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1 pl-8">
                      {[1, 2, 3].map((s) => (
                        <Button
                          key={s}
                          size="sm"
                          variant={slot === s ? "default" : "outline"}
                          onClick={() => setSlot(t.id, s as 1 | 2 | 3)}
                          data-testid={`button-set-slot-${s}-${t.id}`}
                          className="h-7 px-2.5"
                        >
                          <Target className="h-3 w-3 mr-1" />
                          {s}
                        </Button>
                      ))}
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => done(t.id)}
                        data-testid={`button-priority-done-${t.id}`}
                        aria-label="Mark done"
                        className="h-7 w-7"
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => drop(t.id)}
                        data-testid={`button-priority-drop-${t.id}`}
                        aria-label="Drop"
                        className="h-7 w-7"
                      >
                        <X className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      {ordered.length === 0 && (
        <div className="text-sm text-muted-foreground italic rounded-lg border border-dashed border-border p-6 text-center">
          No open tasks. Capture something on /capture.
        </div>
      )}
    </div>
  );
}
