import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
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
import { AvailableHoursTodayCard } from "@/components/AvailableHoursTodayCard";
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

// Reflection chip option sets and the shared ReflectionChipRow live in
// client/src/lib/morningOptions.tsx so the Reflect page can reuse the exact
// same option arrays and visual style (Stage 6 — 2026-05-09).
import {
  AROUSAL_STATE_OPTIONS,
  MOOD_OPTIONS,
  COGNITIVE_LOAD_OPTIONS,
  ENERGY_OPTIONS,
  SLEEP_OPTIONS,
  FOCUS_OPTIONS,
  ALIGNMENT_PEOPLE_OPTIONS,
  ALIGNMENT_ACTIVITIES_OPTIONS,
  ReflectionChipRow,
} from "@/lib/morningOptions";

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

  // Local field copies so typing doesn't lag while server saves.
  // Habits
  const [breathingDone, setBreathingDone] = useState(false);
  const [medicationDone, setMedicationDone] = useState(false);
  // Reflection
  const [arousalState, setArousalState] = useState<string | null>(null);
  // Energy + Sleep moved to Reflect-aligned text labels (2026-05-09).
  // Legacy 1–5 numeric values remain in the database but are no longer rendered
  // or written by the Morning UI; Stage 5 will formalise the numeric mapping.
  const [energyLabel, setEnergyLabel] = useState<string | null>(null);
  const [sleepLabel, setSleepLabel] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [mood, setMood] = useState<string | null>(null);
  const [cognitiveLoad, setCognitiveLoad] = useState<string | null>(null);
  const [alignmentPeople, setAlignmentPeople] = useState<string | null>(null);
  const [alignmentActivities, setAlignmentActivities] = useState<string | null>(null);
  // Bottom-of-page reflective prompts
  const [gratitude, setGratitude] = useState("");
  const [notes, setNotes] = useState("");
  const [avoided, setAvoided] = useState("");
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
    setBreathingDone((morning.breathingDone ?? 0) === 1);
    setMedicationDone((morning.medicationDone ?? 0) === 1);
    setArousalState(morning.state ?? null);
    setEnergyLabel((morning as any).energyLabel ?? null);
    setSleepLabel((morning as any).sleepLabel ?? null);
    setFocus((morning as any).focus ?? null);
    setMood(morning.mood ?? null);
    setCognitiveLoad(morning.cognitiveLoad ?? null);
    setAlignmentPeople((morning as any).alignmentPeople ?? null);
    setAlignmentActivities((morning as any).alignmentActivities ?? null);
    setGratitude(morning.gratitude ?? "");
    setAvoided(morning.avoidedTask ?? "");
    setNotes(morning.notes ?? "");
    setExpress((morning.expressMode ?? 0) === 1);
    setBraindump(morning.braindumpRaw ?? "");
    if (morning.braindumpRaw && morning.braindumpRaw.trim().length > 0) {
      setBraindumpDone(true);
      setBraindumpTasks([]);
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

  // Habits
  const setBreathingAndSave = (v: boolean) => {
    setBreathingDone(v);
    queuePatch({ breathingDone: v ? 1 : 0 });
  };
  const setMedicationAndSave = (v: boolean) => {
    setMedicationDone(v);
    queuePatch({ medicationDone: v ? 1 : 0 });
  };
  // Reflection setters
  const setArousalAndSave = (s: string) => {
    const next = arousalState === s ? null : s;
    setArousalState(next);
    queuePatch({ state: next });
  };
  const setEnergyLabelAndSave = (s: string) => {
    const next = energyLabel === s ? null : s;
    setEnergyLabel(next);
    queuePatch({ energyLabel: next });
  };
  const setSleepLabelAndSave = (s: string) => {
    const next = sleepLabel === s ? null : s;
    setSleepLabel(next);
    queuePatch({ sleepLabel: next });
  };
  const setFocusAndSave = (s: string) => {
    const next = focus === s ? null : s;
    setFocus(next);
    queuePatch({ focus: next });
  };
  const setMoodAndSave = (s: string) => {
    const next = mood === s ? null : s;
    setMood(next);
    queuePatch({ mood: next });
  };
  const setCognitiveLoadAndSave = (s: string) => {
    const next = cognitiveLoad === s ? null : s;
    setCognitiveLoad(next);
    queuePatch({ cognitiveLoad: next });
  };
  const setAlignmentPeopleAndSave = (s: string) => {
    const next = alignmentPeople === s ? null : s;
    setAlignmentPeople(next);
    queuePatch({ alignmentPeople: next });
  };
  const setAlignmentActivitiesAndSave = (s: string) => {
    const next = alignmentActivities === s ? null : s;
    setAlignmentActivities(next);
    queuePatch({ alignmentActivities: next });
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

  // Section completion booleans. Reflection is done when at least the two
  // required quick-tap fields are set (energy + arousal state).
  const reflectDone = !!energyLabel && !!arousalState;
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

      {/* Today's events with Leave-by */}
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

      {/* Top-paying project today */}
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

      {/* Section: Morning habits */}
      <section className="space-y-4 mb-12" data-testid="section-morning-habits">
        <header>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Morning habits
          </div>
          <h2 className="text-xl font-semibold mt-1">Tick when done</h2>
        </header>

        <div className="rounded-lg border bg-card divide-y divide-border/60">
          <HabitRow
            id="habit-breathing"
            label="Calm focused breathing"
            checked={breathingDone}
            onChange={setBreathingAndSave}
          />
          <HabitRow
            id="habit-medication"
            label="Medication"
            checked={medicationDone}
            onChange={setMedicationAndSave}
          />
        </div>
      </section>

      {/* Section 1: Reflection */}
      <section className="space-y-5 mb-12" data-testid="section-reflect">
        <header>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">01 — Reflection</div>
          <h2 className="text-xl font-semibold mt-1">How are you arriving?</h2>
        </header>

        <ReflectionChipRow
          label="Arousal state"
          options={AROUSAL_STATE_OPTIONS}
          current={arousalState}
          onPick={setArousalAndSave}
          testIdPrefix="chip-arousal"
        />

        <ReflectionChipRow
          label="Energy"
          options={ENERGY_OPTIONS}
          current={energyLabel}
          onPick={setEnergyLabelAndSave}
          testIdPrefix="chip-energy"
        />

        <ReflectionChipRow
          label="Sleep quality"
          options={SLEEP_OPTIONS}
          current={sleepLabel}
          onPick={setSleepLabelAndSave}
          testIdPrefix="chip-sleep"
        />

        <ReflectionChipRow
          label="Mood"
          options={MOOD_OPTIONS}
          current={mood}
          onPick={setMoodAndSave}
          testIdPrefix="chip-mood"
        />

        <ReflectionChipRow
          label="Cognitive load"
          options={COGNITIVE_LOAD_OPTIONS}
          current={cognitiveLoad}
          onPick={setCognitiveLoadAndSave}
          testIdPrefix="chip-cognitive"
        />

        <ReflectionChipRow
          label="Focus"
          options={FOCUS_OPTIONS}
          current={focus}
          onPick={setFocusAndSave}
          testIdPrefix="chip-focus"
        />

        <ReflectionChipRow
          label="Alignment — with those around me"
          options={ALIGNMENT_PEOPLE_OPTIONS}
          current={alignmentPeople}
          onPick={setAlignmentPeopleAndSave}
          testIdPrefix="chip-alignment-people"
        />

        <ReflectionChipRow
          label="Alignment — activities and what I value"
          options={ALIGNMENT_ACTIVITIES_OPTIONS}
          current={alignmentActivities}
          onPick={setAlignmentActivitiesAndSave}
          testIdPrefix="chip-alignment-activities"
        />

        {!reflectDone && (
          <div className="text-xs text-muted-foreground">
            Tap an arousal state and an energy level to mark this section done.
          </div>
        )}
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

      {/* Section 3: Top 3 + Eligible + Today's available time */}
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

        {/* Today's available time — what's left after work, family, transit */}
        <div className="pt-2" data-testid="section-available-hours-today">
          <header className="mb-3">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Today
            </div>
            <h3 className="text-base font-semibold mt-1">
              How much time I have today.
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              What's left after paid work, family, and transit.
            </p>
          </header>
          <AvailableHoursTodayCard />
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

      {/* Section 4: Life issues */}
      <section className="space-y-4 mb-12" data-testid="section-morning-issues">
        <header>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            04 — Life issues
          </div>
          <h2 className="text-xl font-semibold mt-1">Anything pressing?</h2>
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

      {/* Bottom-of-page reflective prompts: gratitude, free notes, things avoiding */}
      {!express && (
        <section className="space-y-4 mb-12" data-testid="section-bottom-reflective">
          <header>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Closing notes
            </div>
            <h2 className="text-xl font-semibold mt-1">Before you head off</h2>
          </header>

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">One thing I'm grateful for</label>
            <Input
              placeholder="One thing I'm grateful for…"
              value={gratitude}
              onChange={(e) => setGratitude(e.target.value)}
              onBlur={() => queuePatch({ gratitude })}
              data-testid="input-gratitude"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Free notes</label>
            <Textarea
              placeholder="Free notes…"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => queuePatch({ notes })}
              data-testid="textarea-morning-notes"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">What am I avoiding?</label>
            <Input
              placeholder="What am I avoiding?"
              value={avoided}
              onChange={(e) => setAvoided(e.target.value)}
              onBlur={() => queuePatch({ avoidedTask: avoided })}
              data-testid="input-avoided"
            />
          </div>
        </section>
      )}

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

function HabitRow({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      htmlFor={id}
      className="flex items-center gap-3 px-4 py-3 cursor-pointer hover-elevate"
      data-testid={`row-${id}`}
    >
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        data-testid={`checkbox-${id}`}
      />
      <span className={cn("text-sm flex-1", checked && "line-through text-muted-foreground")}>
        {label}
      </span>
    </label>
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
