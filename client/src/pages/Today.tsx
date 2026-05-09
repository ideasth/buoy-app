import { useQuery } from "@tanstack/react-query";
import { StatusHeader } from "@/components/StatusHeader";
import { TaskCard } from "@/components/TaskCard";
import { EnergyTap } from "@/components/EnergyTap";
import { FocusSession } from "@/components/FocusSession";
import { useEffect, useMemo, useState } from "react";
import type { Task, TopThree } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Plus, Target, Lock, Sunrise } from "lucide-react";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { todayDateStr, fmtTime, fmtDuration } from "@/lib/anchor";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { DailyFactorsCard } from "@/components/DailyFactorsCard";
import { IssueList } from "@/components/IssueList";
import { TravelBadge } from "@/components/TravelBadge";
import type { TravelTodayItem } from "@/lib/travel";
import { leaveByLabel } from "@/lib/travel";

interface CalEvent {
  uid: string;
  summary: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
}

export default function Today() {
  const date = todayDateStr();
  const { toast } = useToast();

  const tasksQ = useQuery<Task[]>({ queryKey: ["/api/tasks"], refetchInterval: 30_000 });
  const topQ = useQuery<TopThree>({
    queryKey: ["/api/top-three", date],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/top-three?date=${date}`);
      return res.json();
    },
  });
  const eventsQ = useQuery<{ events: CalEvent[] }>({
    queryKey: ["/api/today-events"],
    refetchInterval: 60_000,
  });
  const morningQ = useQuery<{
    completedAt: number | null;
    energy: number | null;
    state: string | null;
  }>({
    queryKey: ["/api/morning/today"],
  });
  const briefingQ = useQuery<{ reflectionPrompt: string; adhdTaxCoefficient: number }>(
    {
      queryKey: ["/api/briefing"],
      refetchInterval: 60_000,
    },
  );
  const travelTodayQ = useQuery<{ items: TravelTodayItem[] }>({
    queryKey: ["/api/travel/today"],
    refetchInterval: 60_000,
  });
  const travelByUid = useMemo(() => {
    const m = new Map<string, TravelTodayItem>();
    for (const it of travelTodayQ.data?.items ?? []) m.set(it.event.uid, it);
    return m;
  }, [travelTodayQ.data]);

  // Carry-over from yesterday
  const yesterday = todayDateStr(new Date(Date.now() - 24 * 3600 * 1000));
  const yesterdayTopQ = useQuery<TopThree>({
    queryKey: ["/api/top-three", yesterday],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/top-three?date=${yesterday}`);
      return res.json();
    },
  });

  const tasksById = useMemo(() => {
    const m = new Map<number, Task>();
    for (const t of tasksQ.data ?? []) m.set(t.id, t);
    return m;
  }, [tasksQ.data]);

  const topIds = [topQ.data?.taskId1, topQ.data?.taskId2, topQ.data?.taskId3].filter(
    (n): n is number => typeof n === "number",
  );
  const topTasks = topIds.map((id) => tasksById.get(id)).filter((t): t is Task => !!t);
  const topSlotIds = new Set(topIds);

  const yesterdayTopIds = [
    yesterdayTopQ.data?.taskId1,
    yesterdayTopQ.data?.taskId2,
    yesterdayTopQ.data?.taskId3,
  ].filter((n): n is number => typeof n === "number");
  const carryOver = yesterdayTopIds
    .map((id) => tasksById.get(id))
    .filter((t): t is Task => !!t && t.status !== "done" && t.status !== "dropped");

  const ifTime = (tasksQ.data ?? [])
    .filter(
      (t) =>
        t.status === "todo" &&
        !topSlotIds.has(t.id) &&
        !carryOver.some((c) => c.id === t.id),
    )
    .slice(0, 8);

  const completedToday = (tasksQ.data ?? []).filter(
    (t) =>
      t.status === "done" &&
      t.completedAt &&
      new Date(t.completedAt).toISOString().slice(0, 10) === date,
  );

  const [focusTask, setFocusTask] = useState<Task | null>(null);

  const promote = async (taskId: number, slot: 1 | 2 | 3) => {
    const cur = topQ.data ?? { taskId1: null, taskId2: null, taskId3: null };
    const ids = {
      taskId1: cur.taskId1 ?? null,
      taskId2: cur.taskId2 ?? null,
      taskId3: cur.taskId3 ?? null,
    } as any;
    ids[`taskId${slot}`] = taskId;
    await apiRequest("PUT", "/api/top-three", { date, ...ids });
    queryClient.invalidateQueries({ queryKey: ["/api/top-three", date] });
    toast({ title: "Promoted to top 3" });
  };

  const findEmptySlot = (): 1 | 2 | 3 | null => {
    if (!topQ.data?.taskId1) return 1;
    if (!topQ.data?.taskId2) return 2;
    if (!topQ.data?.taskId3) return 3;
    return null;
  };

  const completeTask = async (t: Task) => {
    if (t.status === "done") {
      // mark back to todo
      await apiRequest("PATCH", `/api/tasks/${t.id}`, { status: "todo", completedAt: null });
    } else {
      // open focus complete via prompt — for simple click, just mark done with estimate
      await apiRequest("PATCH", `/api/tasks/${t.id}`, {
        status: "done",
        actualMinutes: t.estimateMinutes,
      });
      toast({ title: "Done", description: `Logged ${t.estimateMinutes}m actual.` });
    }
    queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
    queryClient.invalidateQueries({ queryKey: ["/api/briefing"] });
  };

  const dropTask = async (t: Task) => {
    await apiRequest("PATCH", `/api/tasks/${t.id}`, { status: "dropped" });
    queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
  };

  // Find the currently happening event
  const now = new Date();
  const happeningNow = (eventsQ.data?.events ?? []).find(
    (e) => !e.allDay && new Date(e.start) <= now && new Date(e.end) > now,
  );
  const allDay = (eventsQ.data?.events ?? []).filter((e) => e.allDay);
  const timedToday = (eventsQ.data?.events ?? [])
    .filter((e) => !e.allDay)
    .sort((a, b) => +new Date(a.start) - +new Date(b.start));
  const upcomingTimed = timedToday.filter((e) => new Date(e.end) > now);

  return (
    <div className="px-5 md:px-8 py-6 md:py-10 space-y-8">
      <StatusHeader />

      {/* Morning routine banner */}
      {morningQ.data?.completedAt ? (
        <div
          className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400 flex items-center gap-2"
          data-testid="banner-morning-done"
        >
          <Sunrise className="h-4 w-4" />
          <span>
            ✓ Morning routine completed at{" "}
            {new Date(morningQ.data.completedAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
            {morningQ.data.energy ? ` — energy ${morningQ.data.energy}` : ""}
            {morningQ.data.state ? `, ${morningQ.data.state}` : ""}
          </span>
        </div>
      ) : (
        <Link
          href="/morning"
          data-testid="banner-morning-start"
          className="block rounded-md border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-primary hover-elevate"
        >
          <span className="inline-flex items-center gap-2">
            <Sunrise className="h-4 w-4" />
            Start morning routine →
          </span>
        </Link>
      )}

      {/* Currently happening */}
      {happeningNow && (
        <div className="rounded-lg border border-primary/40 bg-primary/5 p-4">
          <div className="text-xs uppercase tracking-wider text-primary mb-1">Now</div>
          <div className="font-medium" data-testid="text-now-event">
            {happeningNow.summary}
          </div>
          <div className="text-xs text-muted-foreground mt-1 flex flex-wrap items-center gap-2">
            <span>
              {fmtTime(happeningNow.start)}–{fmtTime(happeningNow.end)}
              {happeningNow.location ? ` · ${happeningNow.location}` : ""}
            </span>
            <TravelBadge travel={travelByUid.get(happeningNow.uid) ?? null} />
          </div>
        </div>
      )}

      {/* Today's calendar (timed events) */}
      {upcomingTimed.length > 0 && (
        <section data-testid="section-today-calendar">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-muted-foreground">Today's calendar</h2>
            <Link href="/calendar">
              <span className="text-xs text-primary hover:underline">Open Calendar</span>
            </Link>
          </div>
          <div className="rounded-lg border border-card-border bg-card divide-y divide-border/60">
            {upcomingTimed.slice(0, 8).map((e) => {
              const tr = travelByUid.get(e.uid);
              const lb = tr?.allowMinutes != null ? leaveByLabel(e.start, tr.allowMinutes) : null;
              return (
                <div
                  key={e.uid}
                  className="px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1"
                  data-testid={`today-event-${e.uid}`}
                >
                  <div className="text-xs tabular-nums text-muted-foreground w-24 shrink-0">
                    {fmtTime(e.start)}–{fmtTime(e.end)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{e.summary}</div>
                    {e.location && (
                      <div className="text-xs text-muted-foreground truncate">{e.location}</div>
                    )}
                  </div>
                  <TravelBadge travel={tr ?? null} showLeaveBy={lb} />
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* All-day banners */}
      {allDay.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">
          {allDay.map((e) => (
            <span
              key={e.uid}
              className="rounded-full border border-border bg-muted/40 px-3 py-1 text-muted-foreground"
            >
              {e.summary}
            </span>
          ))}
        </div>
      )}

      <EnergyTap />

      {/* Carry-over */}
      {carryOver.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-medium">Yesterday's unfinished anchors</h2>
              <p className="text-xs text-muted-foreground">Carry forward, drop, or de-prioritise.</p>
            </div>
          </div>
          <div className="space-y-2">
            {carryOver.map((t) => {
              const slot = findEmptySlot();
              return (
                <div key={t.id} className="flex items-stretch gap-2">
                  <div className="flex-1">
                    <TaskCard
                      task={t}
                      onComplete={completeTask}
                      onDrop={dropTask}
                      onFocus={setFocusTask}
                      showFocus={false}
                    />
                  </div>
                  {slot && (
                    <Button
                      variant="outline"
                      onClick={() => promote(t.id, slot)}
                      className="self-start mt-2"
                      data-testid={`button-carry-promote-${t.id}`}
                    >
                      <Target className="h-3 w-3 mr-1" />
                      To top 3
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Top 3 MITs */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-base font-semibold flex items-center gap-2">
              <Target className="h-4 w-4 text-primary" /> Top 3 today
            </h2>
            <p className="text-xs text-muted-foreground">
              The only things that have to happen. Anything else is if-time.
            </p>
          </div>
          {!topQ.data?.lockedAt && topTasks.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await apiRequest("POST", "/api/top-three/lock", { date });
                queryClient.invalidateQueries({ queryKey: ["/api/top-three", date] });
                toast({ title: "Locked", description: "Don't add more — protect attention." });
              }}
              data-testid="button-lock-top3"
            >
              <Lock className="h-3 w-3 mr-1" />
              Lock
            </Button>
          )}
        </div>
        <div className="space-y-2">
          {[0, 1, 2].map((idx) => {
            const t = topTasks[idx];
            if (t)
              return (
                <TaskCard
                  key={t.id}
                  task={t}
                  highlight
                  onFocus={setFocusTask}
                  onComplete={completeTask}
                  onDrop={dropTask}
                />
              );
            return (
              <Link
                key={idx}
                href="/priorities"
                className="block rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground hover-elevate"
                data-testid={`link-empty-top-${idx}`}
              >
                + Pick task #{idx + 1}
              </Link>
            );
          })}
        </div>
      </section>

      {/* If-time */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-medium text-muted-foreground">If-time</h2>
            <p className="text-xs text-muted-foreground">
              Only after the top 3 are done.
            </p>
          </div>
          <Button asChild size="sm" variant="ghost" data-testid="button-add-task">
            <Link href="/capture">
              <Plus className="h-3 w-3 mr-1" />
              Add
            </Link>
          </Button>
        </div>
        <div className="space-y-2 opacity-90">
          {tasksQ.isLoading && (
            <>
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </>
          )}
          {ifTime.length === 0 && !tasksQ.isLoading && (
            <div className="text-sm text-muted-foreground italic">
              Nothing else queued. Stay with the top 3.
            </div>
          )}
          {ifTime.map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              onFocus={setFocusTask}
              onComplete={completeTask}
              onDrop={dropTask}
            />
          ))}
        </div>
      </section>

      {/* Mood & factors quick check-in */}
      <section data-testid="section-today-factors">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-muted-foreground">Mood &amp; factors</h2>
          <Link href="/evening">
            <span className="text-xs text-primary hover:underline">Open Evening</span>
          </Link>
        </div>
        <div className="rounded-lg border border-card-border bg-card p-4">
          <DailyFactorsCard variant="compact" />
        </div>
      </section>

      {/* Issues logged today */}
      <section data-testid="section-today-issues">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-muted-foreground">Today's issues</h2>
          <Link href="/issues">
            <span className="text-xs text-primary hover:underline">Open Issues</span>
          </Link>
        </div>
        <IssueList
          from={date}
          to={date}
          emptyText="No life issues logged today."
          showDate={false}
          compact
        />
      </section>

      {/* Done today */}
      {completedToday.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-muted-foreground mb-3">
            Done today · {completedToday.length}
          </h2>
          <div className="space-y-2">
            {completedToday.map((t) => (
              <TaskCard key={t.id} task={t} onComplete={completeTask} />
            ))}
          </div>
        </section>
      )}

      {/* ADHD coefficient + reflection prompt footer */}
      <section className="grid md:grid-cols-2 gap-4">
        <div className="rounded-lg border border-card-border bg-card p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            ADHD tax (rolling × estimate)
          </div>
          <div className="clock-numerals text-3xl font-medium mt-1" data-testid="text-adhd-coefficient">
            {(briefingQ.data?.adhdTaxCoefficient ?? 1.5).toFixed(2)}×
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            Multiply your gut estimates by this when planning.
          </div>
        </div>
        <Link
          href="/evening"
          className="rounded-lg border border-card-border bg-card p-4 hover-elevate active-elevate-2"
          data-testid="link-reflection-prompt"
        >
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Today's reflection prompt
          </div>
          <div className="text-base mt-1 font-medium">
            {briefingQ.data?.reflectionPrompt ?? "What did you avoid today?"}
          </div>
          <div className="text-xs text-muted-foreground mt-1">2 min · tap to answer</div>
        </Link>
      </section>

      <FocusSession
        task={focusTask}
        open={!!focusTask}
        onOpenChange={(v) => !v && setFocusTask(null)}
      />
    </div>
  );
}
