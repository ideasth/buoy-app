import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sunrise, Trash2, Check, X, DollarSign } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Logo } from "@/components/Logo";
import { AvailableHoursCard } from "@/components/AvailableHoursCard";
import { DailyFactorsCard } from "@/components/DailyFactorsCard";
import { IssueQuickAdd } from "@/components/IssueQuickAdd";
import { IssueList } from "@/components/IssueList";
import { todayDateStr, fmtTime } from "@/lib/anchor";
import type { MorningRoutine, Task } from "@shared/schema";
import { domainLabel, DOMAIN_OPTIONS, ESTIMATE_PRESETS } from "@/lib/anchor";
import { cn } from "@/lib/utils";
import { formatAUDPerHour } from "@/lib/projectValues";
import { TravelBadge } from "@/components/TravelBadge";
import type { TravelTodayItem } from "@/lib/travel";
import { leaveByLabel } from "@/lib/travel";

type TopPayingTodayResponse = {
  project: { id: number; name: string; currentIncomePerHour: number } | null;
  matchedEvent: { uid: string; summary: string | null; start: string; end: string } | null;
};

const STATE_OPTIONS = [
  { value: "calm", label: "Calm" },
  { value: "anxious", label: "Anxious" },
  { value: "scattered", label: "Scattered" },
  { value: "flat", label: "Flat" },
];

function fmtMelbourneToday(): string {
  const fmt = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  return fmt.format(new Date());
}

export default function Morning() {
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const morningQ = useQuery<MorningRoutine>({ queryKey: ["/api/morning/today"] });
  const eligibleQ = useQuery<Task[]>({ queryKey: ["/api/morning/eligible-tasks"] });
  const topPayingQ = useQuery<TopPayingTodayResponse>({
    queryKey: ["/api/projects/top-paying-today"],
    staleTime: 5 * 60_000,
  });
  const travelTodayQ = useQuery<{ items: TravelTodayItem[] }>({
    queryKey: ["/api/travel/today"],
    refetchInterval: 60_000,
  });
  const timedTravelItems = useMemo(
    () =>
      (travelTodayQ.data?.items ?? [])
        .filter((it) => !it.event.allDay)
        .sort((a, b) => +new Date(a.event.start) - +new Date(b.event.start)),
    [travelTodayQ.data],
  );

  const morning = morningQ.data;

  // Time-on-task counter (live)
  const [elapsedSec, setElapsedSec] = useState(0);
  useEffect(() => {
    if (!morning?.startedAt) return;
    const tick = () => {
      setElapsedSec(Math.max(0, Math.floor((Date.now() - (morning.startedAt ?? 0)) / 1000)));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [morning?.startedAt]);

  // Local copies of fields so typing doesn't lag while server saves.
  const [energy, setEnergy] = useState<number | null>(null);
  const [stateV, setStateV] = useState<string | null>(null);
  const [sleep, setSleep] = useState<number | null>(null);
  const [gratitude, setGratitude] = useState("");
  const [avoided, setAvoided] = useState("");
  const [notes, setNotes] = useState("");
  const [express, setExpress] = useState(false);

  const [braindump, setBraindump] = useState("");
  const [braindumpDone, setBraindumpDone] = useState(false);
  const [braindumpTasks, setBraindumpTasks] = useState<Task[]>([]);

  const [topThree, setTopThree] = useState<number[]>([]);
  const [locking, setLocking] = useState(false);

  // Hydrate from server snapshot once.
  const hydrated = useRef(false);
  useEffect(() => {
    if (!morning || hydrated.current) return;
    hydrated.current = true;
    setEnergy(morning.energy ?? null);
    setStateV(morning.state ?? null);
    setSleep(morning.sleepQuality ?? null);
    setGratitude(morning.gratitude ?? "");
    setAvoided(morning.avoidedTask ?? "");
    setNotes(morning.notes ?? "");
    setExpress((morning.expressMode ?? 0) === 1);
    setBraindump(morning.braindumpRaw ?? "");
    if (morning.braindumpRaw && morning.braindumpRaw.trim().length > 0) {
      setBraindumpDone(true);
      try {
        const ids: number[] = morning.braindumpTaskIds
          ? JSON.parse(morning.braindumpTaskIds)
          : [];
        // We'll fill braindumpTasks from /api/tasks if needed in render.
        setBraindumpTasks([]);
        void ids; // not used here
      } catch {
        // ignore
      }
    }
    try {
      const ids = morning.topThreeIds ? JSON.parse(morning.topThreeIds) : [];
      if (Array.isArray(ids)) setTopThree(ids.filter((n) => typeof n === "number"));
    } catch {
      // ignore
    }
  }, [morning]);

  // Debounced auto-save.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queuePatch = (patch: Record<string, unknown>) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await apiRequest("PATCH", "/api/morning/today", patch);
        queryClient.invalidateQueries({ queryKey: ["/api/morning/today"] });
      } catch (err) {
        toast({
          title: "Save failed",
          description: String(err),
          variant: "destructive",
        });
      }
    }, 400);
  };

  const setEnergyAndSave = (n: number) => {
    setEnergy(n);
    queuePatch({ energy: n });
  };
  const setStateAndSave = (s: string) => {
    setStateV(s);
    queuePatch({ state: s });
  };
  const setSleepAndSave = (n: number) => {
    setSleep(n);
    queuePatch({ sleepQuality: n });
  };
  const toggleExpress = (v: boolean) => {
    setExpress(v);
    queuePatch({ expressMode: v ? 1 : 0 });
  };

  const convertBraindump = async () => {
    const raw = braindump.trim();
    if (!raw) return;
    try {
      const res = await apiRequest("POST", "/api/morning/braindump", { raw });
      const json = (await res.json()) as { tasks: Task[] };
      setBraindumpTasks(json.tasks);
      setBraindumpDone(true);
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/morning/today"] });
      queryClient.invalidateQueries({ queryKey: ["/api/morning/eligible-tasks"] });
      toast({
        title: `${json.tasks.length} task${json.tasks.length === 1 ? "" : "s"} created`,
      });
    } catch (err) {
      toast({
        title: "Convert failed",
        description: String(err),
        variant: "destructive",
      });
    }
  };

  const editAndReconvert = () => {
    setBraindumpDone(false);
  };

  const patchTask = async (id: number, patch: Record<string, unknown>) => {
    try {
      await apiRequest("PATCH", `/api/tasks/${id}`, patch);
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      // refresh local mirror
      setBraindumpTasks((arr) =>
        arr.map((t) => (t.id === id ? ({ ...t, ...patch } as Task) : t)),
      );
    } catch (err) {
      toast({ title: "Save failed", description: String(err), variant: "destructive" });
    }
  };

  const deleteBraindumpTask = async (id: number) => {
    try {
      await apiRequest("DELETE", `/api/tasks/${id}`);
      setBraindumpTasks((arr) => arr.filter((t) => t.id !== id));
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/morning/eligible-tasks"] });
    } catch (err) {
      toast({ title: "Delete failed", description: String(err), variant: "destructive" });
    }
  };

  // Top 3 ops
  const eligibleTasks = eligibleQ.data ?? [];
  const eligibleById = useMemo(() => {
    const m = new Map<number, Task>();
    for (const t of eligibleTasks) m.set(t.id, t);
    for (const t of braindumpTasks) m.set(t.id, t);
    return m;
  }, [eligibleTasks, braindumpTasks]);

  const addToTop = (id: number) => {
    if (topThree.includes(id)) return;
    if (topThree.length >= 3) return;
    setTopThree([...topThree, id]);
  };
  const removeFromTop = (id: number) => {
    setTopThree(topThree.filter((x) => x !== id));
  };

  const lockMorning = async () => {
    setLocking(true);
    try {
      const res = await apiRequest("POST", "/api/morning/lock", {
        topThreeIds: topThree.slice(0, 3),
      });
      const json = (await res.json()) as { completed: boolean; missing: string[] };
      queryClient.invalidateQueries({ queryKey: ["/api/morning/today"] });
      queryClient.invalidateQueries({ queryKey: ["/api/top-three"] });
      if (json.completed) {
        toast({ title: "Morning locked in. Have a good one." });
        navigate("/");
      } else {
        toast({
          title: "Saved — a few things still missing",
          description: json.missing.join(", "),
        });
      }
    } catch (err) {
      toast({ title: "Lock failed", description: String(err), variant: "destructive" });
    } finally {
      setLocking(false);
    }
  };

  // Section completion booleans
  const reflectDone = !!energy && !!stateV;
  const braindumpComplete = !!braindump && braindump.trim().length > 0;
  const topDone = topThree.length >= 1;
  const allDone = reflectDone && braindumpComplete && topDone;
  const sectionsComplete = [reflectDone, braindumpComplete, topDone].filter(Boolean).length;

  const elapsedMin = Math.floor(elapsedSec / 60);
  const wrapUp = elapsedMin >= 20;

  return (
    <div className="px-5 md:px-8 py-6 md:py-8 max-w-3xl pb-32">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 -mx-5 md:-mx-8 px-5 md:px-8 py-3 bg-background/90 backdrop-blur border-b border-border mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sunrise className="h-5 w-5 text-primary" />
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Morning routine
              </div>
              <div className="text-sm font-medium" data-testid="text-morning-date">
                {fmtMelbourneToday()}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "text-xs font-mono",
                wrapUp ? "text-primary" : "text-muted-foreground",
              )}
              data-testid="text-elapsed"
            >
              {elapsedMin} min in{wrapUp ? " — wrap up?" : ""}
            </span>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Express</span>
              <Switch checked={express} onCheckedChange={toggleExpress} data-testid="switch-express" />
            </label>
          </div>
        </div>
        <div className="mt-3 flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors",
                i < sectionsComplete ? "bg-primary" : "bg-muted",
              )}
            />
          ))}
        </div>
      </div>

      {/* Today's events with Leave-by (Feature 1) */}
      {timedTravelItems.length > 0 && (
        <div className="mb-6 rounded-lg border border-card-border bg-card" data-testid="morning-todays-events">
          <div className="px-4 py-2 text-xs uppercase tracking-wider text-muted-foreground border-b border-border/60">
            Today's events
          </div>
          <div className="divide-y divide-border/60">
            {timedTravelItems.map((it) => {
              const lb = it.allowMinutes != null ? leaveByLabel(it.event.start, it.allowMinutes) : null;
              return (
                <div
                  key={it.event.uid}
                  className="px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1"
                  data-testid={`morning-event-${it.event.uid}`}
                >
                  <div className="text-xs tabular-nums text-muted-foreground w-24 shrink-0">
                    {fmtTime(it.event.start)}–{fmtTime(it.event.end)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{it.event.summary}</div>
                    {it.event.location && (
                      <div className="text-xs text-muted-foreground truncate">{it.event.location}</div>
                    )}
                    {lb && (
                      <div className="text-xs mt-0.5">
                        <span className="text-muted-foreground">Leave by </span>
                        <span className="text-foreground font-medium tabular-nums">{lb}</span>
                      </div>
                    )}
                  </div>
                  <TravelBadge travel={it} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Top-paying project today (Feature 2) */}
      {topPayingQ.data?.project && (
        <div
          className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-medium"
          data-testid="pill-top-paying-today"
          title={
            topPayingQ.data.matchedEvent?.summary
              ? `Matched event: ${topPayingQ.data.matchedEvent.summary}`
              : undefined
          }
        >
          <DollarSign className="h-3.5 w-3.5 text-primary" />
          <span className="text-muted-foreground">Top-paying today:</span>
          <span className="text-foreground">{topPayingQ.data.project.name}</span>
          <span className="text-primary tabular-nums">
            {formatAUDPerHour(topPayingQ.data.project.currentIncomePerHour)}
          </span>
        </div>
      )}

      {/* Section 1: Reflect */}
      <section className="space-y-5 mb-12" data-testid="section-reflect">
        <header>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">01 — Reflect</div>
          <h2 className="text-xl font-semibold mt-1">How are you arriving?</h2>
        </header>

        <div className="space-y-2">
          <div className="text-sm text-muted-foreground">Energy</div>
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setEnergyAndSave(n)}
                data-testid={`button-energy-${n}`}
                className={cn(
                  "h-10 w-10 rounded-full border text-sm font-medium hover-elevate active-elevate-2",
                  energy === n
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border bg-secondary text-secondary-foreground",
                )}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-sm text-muted-foreground">State</div>
          <div className="flex flex-wrap gap-2">
            {STATE_OPTIONS.map((s) => (
              <button
                key={s.value}
                onClick={() => setStateAndSave(s.value)}
                data-testid={`chip-state-${s.value}`}
                className={cn(
                  "px-4 py-2 rounded-full border text-sm hover-elevate active-elevate-2",
                  stateV === s.value
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border bg-secondary text-secondary-foreground",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {!express && (
          <>
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">Sleep quality</div>
              <div className="flex gap-1.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    onClick={() => setSleepAndSave(n)}
                    data-testid={`button-sleep-${n}`}
                    aria-label={`sleep quality ${n}`}
                    className={cn(
                      "h-3 w-8 rounded-full transition-colors",
                      (sleep ?? 0) >= n ? "bg-primary" : "bg-muted",
                    )}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Input
                placeholder="One thing I'm grateful for…"
                value={gratitude}
                onChange={(e) => setGratitude(e.target.value)}
                onBlur={() => queuePatch({ gratitude })}
                data-testid="input-gratitude"
              />
            </div>

            <div className="space-y-1.5">
              <Textarea
                placeholder="Free notes…"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onBlur={() => queuePatch({ notes })}
                data-testid="textarea-morning-notes"
              />
            </div>
          </>
        )}

        <div className="space-y-1.5">
          <Input
            placeholder="What am I avoiding?"
            value={avoided}
            onChange={(e) => setAvoided(e.target.value)}
            onBlur={() => queuePatch({ avoidedTask: avoided })}
            data-testid="input-avoided"
          />
        </div>

        {!reflectDone && (
          <div className="text-xs text-muted-foreground">
            Tap an energy level and a state to mark this section done.
          </div>
        )}
      </section>

      {/* Section 1b: Mood & Factors check-in (compact) */}
      <section className="space-y-4 mb-12" data-testid="section-daily-factors">
        <header>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Mood &amp; factors
          </div>
          <h2 className="text-xl font-semibold mt-1">A quick check-in</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Light-touch read on mood, energy, load, sleep, focus, and values alignment.
            Fill what feels true; come back later for the rest.
          </p>
        </header>
        <DailyFactorsCard variant="compact" />
      </section>

      {/* Section 2: Braindump */}
      <section className="space-y-4 mb-12" data-testid="section-braindump">
        <header>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            02 — Braindump
          </div>
          <h2 className="text-xl font-semibold mt-1">Empty your head — one thought per line</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Try not to filter. Capture first, sort later.
          </p>
        </header>

        {!braindumpDone ? (
          <>
            <Textarea
              rows={8}
              className="md:min-h-[18rem] text-base leading-relaxed"
              placeholder={"Call Bernie\nDraft IUGA abstract\nBuy milk\n…"}
              value={braindump}
              onChange={(e) => setBraindump(e.target.value)}
              data-testid="textarea-braindump"
            />
            <Button
              onClick={convertBraindump}
              disabled={!braindump.trim()}
              data-testid="button-convert-braindump"
            >
              Convert to tasks
            </Button>
          </>
        ) : (
          <>
            <div className="rounded-md border bg-muted/30 p-3 text-sm whitespace-pre-wrap font-mono">
              {braindump}
            </div>
            <button
              onClick={editAndReconvert}
              className="text-xs text-primary underline underline-offset-2"
              data-testid="button-edit-reconvert"
            >
              Edit &amp; re-convert
            </button>
            {braindumpTasks.length > 0 && (
              <div className="space-y-2 pt-2">
                <span className="inline-flex items-center rounded-full bg-primary/15 text-primary px-2.5 py-1 text-xs font-medium">
                  {braindumpTasks.length} task{braindumpTasks.length === 1 ? "" : "s"} created
                </span>
                <div className="divide-y rounded-md border">
                  {braindumpTasks.map((t) => (
                    <BraindumpRow
                      key={t.id}
                      task={t}
                      onPatch={(p) => patchTask(t.id, p)}
                      onDelete={() => deleteBraindumpTask(t.id)}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {/* Section 2b: Issues mini-section (logs to the Issues page) */}
      <section className="space-y-4 mb-12" data-testid="section-morning-issues">
        <header>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Anything pressing?
          </div>
          <h2 className="text-xl font-semibold mt-1">Log a life issue</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Optional. Tag any pressure that's present this morning. Multiple categories
            are fine. Manage the full log on the Issues page.
          </p>
        </header>
        <div className="rounded-lg border border-card-border bg-card p-4">
          <IssueQuickAdd sourcePage="morning" defaultDate={todayDateStr()} />
        </div>
        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">Today's issues</div>
          <IssueList
            from={todayDateStr()}
            to={todayDateStr()}
            emptyText="Nothing logged for today yet."
            showDate={false}
            compact
          />
        </div>
      </section>

      {/* Section 3: Top 3 */}
      <section className="space-y-4 mb-12" data-testid="section-top-three">
        <header>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            03 — Today's top 3
          </div>
          <h2 className="text-xl font-semibold mt-1">
            What are the three things that matter most today?
          </h2>
        </header>

        <div className="space-y-2 rounded-lg border bg-card p-4">
          {[0, 1, 2].map((slot) => {
            const id = topThree[slot];
            const task = id ? eligibleById.get(id) : null;
            return (
              <div
                key={slot}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm",
                  task ? "bg-primary/5 border border-primary/30" : "border border-dashed border-border text-muted-foreground",
                )}
                data-testid={`slot-top-${slot + 1}`}
              >
                <span className="w-5 text-xs font-mono">{slot + 1}.</span>
                {task ? (
                  <>
                    <span className="flex-1 truncate text-foreground">{task.title}</span>
                    <span className="text-xs text-muted-foreground">{domainLabel(task.domain)}</span>
                    <button
                      onClick={() => removeFromTop(task.id)}
                      data-testid={`button-remove-top-${task.id}`}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="remove"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </>
                ) : (
                  <span className="flex-1">Tap a task below to add</span>
                )}
              </div>
            );
          })}
        </div>

        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Eligible tasks
          </div>
          {eligibleQ.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : eligibleTasks.length === 0 && braindumpTasks.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No eligible tasks yet. Try a braindump above.
            </div>
          ) : (
            <div className="grid gap-2">
              {[...braindumpTasks, ...eligibleTasks.filter((t) => !braindumpTasks.find((b) => b.id === t.id))].map((t) => {
                const inTop = topThree.includes(t.id);
                return (
                  <div
                    key={t.id}
                    className="flex items-center gap-3 rounded-md border bg-card px-3 py-2 text-sm"
                    data-testid={`row-eligible-${t.id}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{t.title}</div>
                      <div className="text-xs text-muted-foreground flex gap-2 mt-0.5">
                        <span>{domainLabel(t.domain)}</span>
                        {t.tag && <span>· {t.tag}</span>}
                        {t.priority !== "iftime" && <span>· {t.priority}</span>}
                        {t.dueAt && (
                          <span>
                            · due {new Date(t.dueAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={inTop ? "secondary" : "outline"}
                      disabled={inTop || topThree.length >= 3}
                      onClick={() => addToTop(t.id)}
                      data-testid={`button-add-top-${t.id}`}
                    >
                      {inTop ? <Check className="h-3.5 w-3.5" /> : "+ Add"}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <Button
          size="lg"
          className="w-full"
          disabled={topThree.length === 0 || locking}
          onClick={lockMorning}
          data-testid="button-lock-priorities"
        >
          {locking ? "Locking…" : "Lock priorities for today"}
        </Button>
      </section>

      {/* Available project time this week */}
      <section className="mb-12" data-testid="section-available-hours">
        <header className="mb-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            This week
          </div>
          <h2 className="text-xl font-semibold mt-1">How much time you actually have.</h2>
        </header>
        <AvailableHoursCard variant="compact" />
      </section>

      {/* Floating "Complete morning" FAB when all sections done */}
      {allDone && !morning?.completedAt && (
        <button
          onClick={lockMorning}
          data-testid="button-fab-complete"
          className="fixed bottom-5 right-5 z-30 rounded-full px-5 py-3 text-sm font-medium shadow-lg bg-primary text-primary-foreground hover:opacity-90"
        >
          Complete morning
        </button>
      )}

      {morning?.completedAt && (
        <div className="rounded-md border border-primary/40 bg-primary/5 p-3 text-sm text-primary text-center">
          Completed at {new Date(morning.completedAt).toLocaleTimeString()}.
        </div>
      )}

      {/* Hidden logo to register import; keeps lucide tree shaken */}
      <span className="hidden">
        <Logo className="h-1 w-1" />
      </span>
    </div>
  );
}

function BraindumpRow({
  task,
  onPatch,
  onDelete,
}: {
  task: Task;
  onPatch: (p: Record<string, unknown>) => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [estimate, setEstimate] = useState(task.estimateMinutes);
  const [domain, setDomain] = useState(task.domain);
  const [due, setDue] = useState<"today" | "tomorrow" | "none">(() => {
    if (!task.dueAt) return "none";
    const d = new Date(task.dueAt);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today.getTime() + 86400000);
    if (d < tomorrow) return "today";
    return "tomorrow";
  });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queue = (p: Record<string, unknown>) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onPatch(p), 400);
  };
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
      <Input
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          queue({ title: e.target.value });
        }}
        className="flex-1 min-w-[12rem]"
        data-testid={`input-bd-title-${task.id}`}
      />
      <Select
        value={domain}
        onValueChange={(v) => {
          setDomain(v);
          onPatch({ domain: v });
        }}
      >
        <SelectTrigger className="w-32" data-testid={`select-bd-domain-${task.id}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {DOMAIN_OPTIONS.map((d) => (
            <SelectItem key={d.value} value={d.value}>
              {d.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={String(estimate)}
        onValueChange={(v) => {
          const n = Number(v);
          setEstimate(n);
          onPatch({ estimateMinutes: n });
        }}
      >
        <SelectTrigger className="w-24" data-testid={`select-bd-est-${task.id}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ESTIMATE_PRESETS.map((m) => (
            <SelectItem key={m} value={String(m)}>
              {m}m
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={due}
        onValueChange={(v) => {
          setDue(v as any);
          let dueAt: number | null = null;
          if (v === "today") {
            const d = new Date();
            d.setHours(17, 0, 0, 0);
            dueAt = d.getTime();
          } else if (v === "tomorrow") {
            const d = new Date();
            d.setDate(d.getDate() + 1);
            d.setHours(17, 0, 0, 0);
            dueAt = d.getTime();
          }
          onPatch({ dueAt });
        }}
      >
        <SelectTrigger className="w-28" data-testid={`select-bd-due-${task.id}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">No due</SelectItem>
          <SelectItem value="today">Today</SelectItem>
          <SelectItem value="tomorrow">Tomorrow</SelectItem>
        </SelectContent>
      </Select>
      <Button
        size="icon"
        variant="ghost"
        onClick={onDelete}
        data-testid={`button-bd-delete-${task.id}`}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
