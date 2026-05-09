import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import type { Reflection, Task, TopThree } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { todayDateStr } from "@/lib/anchor";
import { useToast } from "@/hooks/use-toast";
import { IssueQuickAdd } from "@/components/IssueQuickAdd";
import { IssueList } from "@/components/IssueList";
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
import { cn } from "@/lib/utils";

function isSunday(d = new Date()) {
  return d.getDay() === 0;
}

export default function Reflect() {
  const date = todayDateStr();
  const promptQ = useQuery<{ prompt: string }>({ queryKey: ["/api/reflection-prompt"] });
  const { toast } = useToast();

  // ---------- Section 1: Evening habits ----------
  const [medicationDone, setMedicationDone] = useState(false);
  const [bedBy11pmDone, setBedBy11pmDone] = useState(false);

  // ---------- Section 2: Reflection chips (mirrors Morning) ----------
  const [arousalState, setArousalState] = useState<string | null>(null);
  const [mood, setMood] = useState<string | null>(null);
  const [cognitiveLoad, setCognitiveLoad] = useState<string | null>(null);
  const [energyLabel, setEnergyLabel] = useState<string | null>(null);
  const [sleepLabel, setSleepLabel] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [alignmentPeople, setAlignmentPeople] = useState<string | null>(null);
  const [alignmentActivities, setAlignmentActivities] = useState<string | null>(null);

  // ---------- Section 3: Today's top 3 ----------
  const tasksQ = useQuery<Task[]>({ queryKey: ["/api/tasks"] });
  const topQ = useQuery<TopThree>({
    queryKey: ["/api/top-three", date],
    queryFn: async () => (await apiRequest("GET", `/api/top-three?date=${date}`)).json(),
  });
  const tasksById = useMemo(() => {
    const m = new Map<number, Task>();
    for (const t of tasksQ.data ?? []) m.set(t.id, t);
    return m;
  }, [tasksQ.data]);
  const topSlots: { slot: 1 | 2 | 3; task: Task | null }[] = [1, 2, 3].map((s) => {
    const id = (topQ.data as any)?.[`taskId${s}`] as number | null | undefined;
    return { slot: s as 1 | 2 | 3, task: id ? tasksById.get(id) ?? null : null };
  });
  const completeTopTask = async (id: number) => {
    try {
      await apiRequest("PATCH", `/api/tasks/${id}`, { status: "done" });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: "Marked done" });
    } catch (err) {
      toast({ title: "Update failed", description: String(err), variant: "destructive" });
    }
  };
  const reopenTopTask = async (id: number) => {
    try {
      await apiRequest("PATCH", `/api/tasks/${id}`, { status: "todo" });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: "Re-opened" });
    } catch (err) {
      toast({ title: "Update failed", description: String(err), variant: "destructive" });
    }
  };

  // ---------- Section 4: Braindump (optional evening capture) ----------
  const [braindump, setBraindump] = useState("");

  // ---------- Section 5: Issues — uses existing IssueQuickAdd / IssueList ----------

  // ---------- Section 6: Weekly review ----------
  const [wins, setWins] = useState("");
  const [slipped, setSlipped] = useState("");
  const [patterns, setPatterns] = useState("");
  const [nextAnchor, setNextAnchor] = useState("");
  const [drop, setDrop] = useState("");

  // ---------- Closing prompts (kept from previous Reflect) ----------
  const [avoided, setAvoided] = useState("");
  const [notes, setNotes] = useState("");

  // ---------- Hydrate from today's existing reflection (if any) ----------
  // Pull today's daily reflection so revisiting the page restores prior taps.
  // Read from /api/reflections (full list, then filter) — matches existing API
  // surface; no new endpoint required for Stage 6.
  const reflectionsQ = useQuery<Reflection[]>({ queryKey: ["/api/reflections"] });
  const todayDaily = useMemo(() => {
    return (reflectionsQ.data ?? []).find(
      (r) => r.date === date && r.kind === "daily",
    );
  }, [reflectionsQ.data, date]);
  const hydrated = useRef(false);
  useEffect(() => {
    if (!todayDaily || hydrated.current) return;
    hydrated.current = true;
    setMedicationDone(((todayDaily as any).medicationDone ?? 0) === 1);
    setBedBy11pmDone(((todayDaily as any).bedBy11pmDone ?? 0) === 1);
    setArousalState((todayDaily as any).arousalState ?? null);
    setMood((todayDaily as any).mood ?? null);
    setCognitiveLoad((todayDaily as any).cognitiveLoad ?? null);
    setEnergyLabel((todayDaily as any).energyLabel ?? null);
    setSleepLabel((todayDaily as any).sleepLabel ?? null);
    setFocus((todayDaily as any).focus ?? null);
    setAlignmentPeople((todayDaily as any).alignmentPeople ?? null);
    setAlignmentActivities((todayDaily as any).alignmentActivities ?? null);
    setBraindump(((todayDaily as any).braindumpRaw ?? "") as string);
    setAvoided(todayDaily.avoidedTask ?? "");
    setNotes(todayDaily.notes ?? "");
  }, [todayDaily]);

  // ---------- Save daily reflection ----------
  // One POST captures everything (or PATCH if a row already exists today).
  // Idempotent for the user: re-saving simply overwrites today's row.
  const [saving, setSaving] = useState(false);
  const submitDaily = async () => {
    setSaving(true);
    try {
      const payload = {
        date,
        kind: "daily" as const,
        // Legacy fields kept null — new submissions use the chip fields below.
        energy: null,
        state: null,
        avoidedTask: avoided || null,
        notes: notes || null,
        // Stage 6 fields:
        medicationDone: medicationDone ? 1 : 0,
        bedBy11pmDone: bedBy11pmDone ? 1 : 0,
        arousalState,
        mood,
        cognitiveLoad,
        energyLabel,
        sleepLabel,
        focus,
        alignmentPeople,
        alignmentActivities,
        braindumpRaw: braindump || null,
      };
      if (todayDaily) {
        await apiRequest("PATCH", `/api/reflections/${todayDaily.id}`, payload);
      } else {
        await apiRequest("POST", "/api/reflections", payload);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/reflections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/briefing"] });
      toast({ title: "Reflection saved" });
    } catch (err) {
      toast({ title: "Save failed", description: String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const submitWeekly = async () => {
    const composed = JSON.stringify({ wins, slipped, patterns, nextAnchor, drop });
    await apiRequest("POST", "/api/reflections", {
      date,
      kind: "weekly",
      notes: composed,
    });
    queryClient.invalidateQueries({ queryKey: ["/api/reflections"] });
    toast({ title: "Weekly review saved" });
    setWins("");
    setSlipped("");
    setPatterns("");
    setNextAnchor("");
    setDrop("");
  };

  return (
    <div className="px-5 md:px-8 py-8 md:py-10 max-w-2xl space-y-12">
      <header>
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Reflect</div>
        <h1 className="text-2xl font-semibold mt-1">Two minutes before you switch off.</h1>
      </header>

      {/* Section 1: Evening habits */}
      <section className="space-y-4" data-testid="section-reflect-habits">
        <header>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Evening habits
          </div>
          <h2 className="text-xl font-semibold mt-1">Tick when done</h2>
        </header>
        <div className="rounded-lg border bg-card divide-y divide-border/60">
          <HabitRow
            id="reflect-habit-medication"
            label="Medication"
            checked={medicationDone}
            onChange={setMedicationDone}
          />
          <HabitRow
            id="reflect-habit-bed-by-11pm"
            label="Bed by 11pm"
            checked={bedBy11pmDone}
            onChange={setBedBy11pmDone}
          />
        </div>
      </section>

      {/* Section 2: Reflection — same chips as Morning */}
      <section className="space-y-5" data-testid="section-reflect-reflection">
        <header>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            01 — Reflection
          </div>
          <h2 className="text-xl font-semibold mt-1">How did the day land?</h2>
          {promptQ.data?.prompt && (
            <p className="text-sm text-muted-foreground mt-1">{promptQ.data.prompt}</p>
          )}
        </header>

        <ReflectionChipRow
          label="Arousal state"
          options={AROUSAL_STATE_OPTIONS}
          current={arousalState}
          onPick={(v) => setArousalState(arousalState === v ? null : v)}
          testIdPrefix="chip-reflect-arousal"
        />

        <ReflectionChipRow
          label="Energy"
          options={ENERGY_OPTIONS}
          current={energyLabel}
          onPick={(v) => setEnergyLabel(energyLabel === v ? null : v)}
          testIdPrefix="chip-reflect-energy"
        />

        <ReflectionChipRow
          label="Sleep quality"
          options={SLEEP_OPTIONS}
          current={sleepLabel}
          onPick={(v) => setSleepLabel(sleepLabel === v ? null : v)}
          testIdPrefix="chip-reflect-sleep"
        />

        <ReflectionChipRow
          label="Mood"
          options={MOOD_OPTIONS}
          current={mood}
          onPick={(v) => setMood(mood === v ? null : v)}
          testIdPrefix="chip-reflect-mood"
        />

        <ReflectionChipRow
          label="Cognitive load"
          options={COGNITIVE_LOAD_OPTIONS}
          current={cognitiveLoad}
          onPick={(v) => setCognitiveLoad(cognitiveLoad === v ? null : v)}
          testIdPrefix="chip-reflect-cognitive"
        />

        <ReflectionChipRow
          label="Focus"
          options={FOCUS_OPTIONS}
          current={focus}
          onPick={(v) => setFocus(focus === v ? null : v)}
          testIdPrefix="chip-reflect-focus"
        />

        <ReflectionChipRow
          label="Alignment — with those around me"
          options={ALIGNMENT_PEOPLE_OPTIONS}
          current={alignmentPeople}
          onPick={(v) => setAlignmentPeople(alignmentPeople === v ? null : v)}
          testIdPrefix="chip-reflect-alignment-people"
        />

        <ReflectionChipRow
          label="Alignment — activities and what I value"
          options={ALIGNMENT_ACTIVITIES_OPTIONS}
          current={alignmentActivities}
          onPick={(v) => setAlignmentActivities(alignmentActivities === v ? null : v)}
          testIdPrefix="chip-reflect-alignment-activities"
        />

        <div className="space-y-2 pt-2">
          <div className="text-sm text-muted-foreground">What I avoided</div>
          <Input
            value={avoided}
            onChange={(e) => setAvoided(e.target.value)}
            placeholder="The one thing I sidestepped today."
            data-testid="input-avoided-task"
          />
        </div>

        <div className="space-y-2">
          <div className="text-sm text-muted-foreground">Anything else</div>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Free notes — short."
            data-testid="textarea-reflection-notes"
          />
        </div>

        <Button onClick={submitDaily} disabled={saving} data-testid="button-submit-daily">
          {saving ? "Saving…" : "Save daily reflection"}
        </Button>
      </section>

      {/* Section 3: Today's top 3 — status, tick to mark done, click to edit */}
      <section className="space-y-4 border-t pt-8" data-testid="section-reflect-top-three">
        <header>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            02 — Today's top 3
          </div>
          <h2 className="text-xl font-semibold mt-1">How did the three things go?</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Tick to mark done. Tap a row to edit on Priorities.
          </p>
        </header>

        <div className="space-y-2 rounded-lg border bg-card p-4">
          {topSlots.map(({ slot, task }) => {
            if (!task) {
              return (
                <div
                  key={slot}
                  className="flex items-center gap-3 rounded-md px-3 py-2 text-sm border border-dashed border-border text-muted-foreground"
                  data-testid={`reflect-top-slot-${slot}`}
                >
                  <span className="w-5 text-xs font-mono">{slot}.</span>
                  <span className="flex-1">No task locked for slot {slot}.</span>
                </div>
              );
            }
            const done = task.status === "done";
            const dropped = task.status === "dropped";
            return (
              <div
                key={slot}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  done
                    ? "bg-primary/5 border border-primary/30"
                    : dropped
                    ? "bg-muted/40 border border-border opacity-70"
                    : "bg-background border border-border hover-elevate",
                )}
                data-testid={`reflect-top-slot-${slot}`}
              >
                <span className="w-5 text-xs font-mono">{slot}.</span>
                <Checkbox
                  checked={done}
                  onCheckedChange={(v) => {
                    if (v === true) completeTopTask(task.id);
                    else reopenTopTask(task.id);
                  }}
                  data-testid={`checkbox-reflect-top-${task.id}`}
                  aria-label={done ? "Mark not done" : "Mark done"}
                />
                <Link
                  href="/priorities"
                  className={cn(
                    "flex-1 min-w-0 truncate text-left",
                    done && "line-through text-muted-foreground",
                    dropped && "line-through text-muted-foreground",
                  )}
                  data-testid={`link-reflect-top-${task.id}`}
                  title="Open on Priorities"
                >
                  {task.title}
                </Link>
                <span className="text-xs text-muted-foreground capitalize shrink-0">
                  {done ? "done" : dropped ? "dropped" : task.status}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Section 4: Braindump — optional evening capture */}
      <section className="space-y-3 border-t pt-8" data-testid="section-reflect-braindump">
        <header>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            03 — Braindump
          </div>
          <h2 className="text-xl font-semibold mt-1">
            One thought per line — empty the head before bed
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Captured with the daily reflection. Sort tomorrow on Morning.
          </p>
        </header>
        <Textarea
          rows={6}
          className="text-base leading-relaxed"
          placeholder={"Email pathology re: theatre list\nBook Hilde dentist\n…"}
          value={braindump}
          onChange={(e) => setBraindump(e.target.value)}
          data-testid="textarea-reflect-braindump"
        />
      </section>

      {/* Section 5: Life issues */}
      <section className="space-y-4 border-t pt-8" data-testid="section-reflect-issues">
        <header>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            04 — Life issues
          </div>
          <h2 className="text-xl font-semibold mt-1">Anything pressing?</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Tag any pressure that's present. Multiple categories are fine. Manage the
            full log on the Issues page.
          </p>
        </header>
        <div className="rounded-lg border border-card-border bg-card p-4">
          <IssueQuickAdd sourcePage="reflect" defaultDate={date} />
        </div>
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Today's issues
          </div>
          <IssueList
            from={date}
            to={date}
            emptyText="Nothing logged for today yet."
            showDate={false}
          />
        </div>
      </section>

      {/* Section 6: Weekly review */}
      <section className="space-y-3 border-t pt-8" data-testid="section-reflect-weekly">
        <header>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            05 — Weekly review
          </div>
          <h2 className="text-xl font-semibold mt-1">
            {isSunday() ? "It's Sunday — perfect time." : "Anytime, but Sundays are best."}
          </h2>
        </header>
        {(
          [
            ["Wins", wins, setWins, "What's worth keeping?"],
            ["What slipped", slipped, setSlipped, "What didn't get done? Why?"],
            ["Patterns", patterns, setPatterns, "What keeps showing up?"],
            ["Next week's anchor", nextAnchor, setNextAnchor, "The one thing that has to happen."],
            ["One thing to drop", drop, setDrop, "What can I stop doing?"],
          ] as const
        ).map(([label, val, set, ph]) => (
          <div key={label} className="space-y-1.5">
            <label className="text-xs uppercase tracking-wider text-muted-foreground">
              {label}
            </label>
            <Textarea
              value={val}
              onChange={(e) => set(e.target.value)}
              placeholder={ph}
              data-testid={`textarea-weekly-${label.toLowerCase().replace(/\s+/g, "-")}`}
              className="min-h-[60px]"
            />
          </div>
        ))}
        <Button onClick={submitWeekly} variant="outline" data-testid="button-submit-weekly">
          Save weekly review
        </Button>
      </section>
    </div>
  );
}

// Local habit row mirroring the Morning page's HabitRow visual style.
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
