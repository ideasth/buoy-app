// Stage 8 (2026-05-10) — /checkin page.
//
// A purpose-built quick check-in surface usable any time of day (carpark
// between theatre cases, between consults, etc.). Reads/writes the
// unified daily_check_ins table introduced in Stage 7. Five chip rows
// by default (mood, energy, cognitive load, focus, arousal state); a
// collapsible More group exposes sleep + alignment chips for when the
// user wants the full set. One optional note input. Single Save button.
//
// Phase is auto-derived from the local Melbourne clock with an explicit
// override dropdown — morning 04:00–11:00, midday 11:00–16:30,
// evening 16:30–22:00, adhoc anything outside or manual.

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
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
import type { DailyCheckIn } from "@shared/schema";

type Phase = "morning" | "midday" | "evening" | "adhoc";

// Returns YYYY-MM-DD in Australia/Melbourne for the supplied (or current)
// instant. Mirrors server/morning-helpers.ts:melbourneDateStr.
function melbourneDateStr(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Melbourne",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${day}`;
}

// Returns the current Melbourne hour:minute as decimal hours (e.g. 17.5
// for 17:30). Used by phaseFromClock below.
function melbourneClockDecimal(): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Australia/Melbourne",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return h + m / 60;
}

// Phase windows per master prompt: morning 04:00–11:00, midday 11:00–16:30,
// evening 16:30–22:00, adhoc otherwise.
function phaseFromClock(): Phase {
  const h = melbourneClockDecimal();
  if (h >= 4 && h < 11) return "morning";
  if (h >= 11 && h < 16.5) return "midday";
  if (h >= 16.5 && h < 22) return "evening";
  return "adhoc";
}

const PHASE_LABELS: Record<Phase, string> = {
  morning: "Morning",
  midday: "Midday",
  evening: "Evening",
  adhoc: "Ad-hoc",
};

// Format a unix-ms timestamp as Melbourne local HH:mm for the recent-strip.
function fmtTime(ms: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Australia/Melbourne",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

interface ChipState {
  mood: string | null;
  energyLabel: string | null;
  cognitiveLoad: string | null;
  focus: string | null;
  arousalState: string | null;
  sleepLabel: string | null;
  alignmentPeople: string | null;
  alignmentActivities: string | null;
}

const EMPTY_CHIPS: ChipState = {
  mood: null,
  energyLabel: null,
  cognitiveLoad: null,
  focus: null,
  arousalState: null,
  sleepLabel: null,
  alignmentPeople: null,
  alignmentActivities: null,
};

export default function CheckIn() {
  const today = melbourneDateStr();
  const [phase, setPhase] = useState<Phase>(() => phaseFromClock());
  const [phaseAuto, setPhaseAuto] = useState(true);
  const [chips, setChips] = useState<ChipState>(EMPTY_CHIPS);
  const [note, setNote] = useState("");
  const [showMore, setShowMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  // Recompute the auto phase every minute so a user lingering on the
  // page across a window boundary (e.g. 16:29 → 16:30) sees the chip
  // catch up. Skipped while the user has manually overridden.
  useEffect(() => {
    if (!phaseAuto) return;
    const id = window.setInterval(() => {
      setPhase((cur) => {
        const next = phaseFromClock();
        return next === cur ? cur : next;
      });
    }, 60_000);
    return () => window.clearInterval(id);
  }, [phaseAuto]);

  // Recent check-ins for today, refreshed on POST success below.
  const recentQ = useQuery<DailyCheckIn[]>({
    queryKey: ["/api/checkins", today],
    queryFn: async () =>
      (await apiRequest("GET", `/api/checkins?date=${today}`)).json(),
  });

  const anyChipSet = useMemo(
    () => Object.values(chips).some((v) => v !== null && v !== ""),
    [chips],
  );

  function pick<K extends keyof ChipState>(key: K, value: string) {
    setChips((c) => ({ ...c, [key]: c[key] === value ? null : value }));
  }

  async function save() {
    if (!anyChipSet || saving) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        date: today,
        phase,
        source: "checkin_page",
      };
      // Only include chip fields the user has actually set; null ones
      // are omitted so we don't write empty strings into the DB.
      for (const [k, v] of Object.entries(chips)) {
        if (v !== null && v !== "") body[k] = v;
      }
      if (note.trim()) body.note = note.trim();
      await apiRequest("POST", "/api/checkins", body);
      toast({ title: "Check-in saved" });
      setChips(EMPTY_CHIPS);
      setNote("");
      await queryClient.invalidateQueries({ queryKey: ["/api/checkins", today] });
      // Stage 9b's Coach pre-session modal will read /api/checkins/latest.
      await queryClient.invalidateQueries({
        queryKey: ["/api/checkins/latest", today],
      });
    } catch (err: any) {
      toast({
        title: "Save failed",
        description: err?.message ?? "Could not save check-in",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="px-4 md:px-8 py-6 max-w-2xl mx-auto space-y-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Quick check-in
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            A few chips, optional one-liner. Saves to today's record and
            shows up alongside Morning + Evening.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground" htmlFor="phase">
            Phase
          </label>
          <select
            id="phase"
            data-testid="select-checkin-phase"
            value={phase}
            onChange={(e) => {
              setPhase(e.target.value as Phase);
              setPhaseAuto(false);
            }}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm"
          >
            {(Object.keys(PHASE_LABELS) as Phase[]).map((p) => (
              <option key={p} value={p}>
                {PHASE_LABELS[p]}
                {phaseAuto && p === phase ? " (auto)" : ""}
              </option>
            ))}
          </select>
        </div>
      </header>

      <Card>
        <CardContent className="pt-6 space-y-5">
          <ReflectionChipRow
            label="Mood"
            options={MOOD_OPTIONS}
            current={chips.mood}
            onPick={(v) => pick("mood", v)}
            testIdPrefix="chip-checkin-mood"
          />
          <ReflectionChipRow
            label="Energy"
            options={ENERGY_OPTIONS}
            current={chips.energyLabel}
            onPick={(v) => pick("energyLabel", v)}
            testIdPrefix="chip-checkin-energy"
          />
          <ReflectionChipRow
            label="Cognitive load"
            options={COGNITIVE_LOAD_OPTIONS}
            current={chips.cognitiveLoad}
            onPick={(v) => pick("cognitiveLoad", v)}
            testIdPrefix="chip-checkin-cognitive-load"
          />
          <ReflectionChipRow
            label="Focus"
            options={FOCUS_OPTIONS}
            current={chips.focus}
            onPick={(v) => pick("focus", v)}
            testIdPrefix="chip-checkin-focus"
          />
          <ReflectionChipRow
            label="Arousal state"
            options={AROUSAL_STATE_OPTIONS}
            current={chips.arousalState}
            onPick={(v) => pick("arousalState", v)}
            testIdPrefix="chip-checkin-arousal-state"
          />

          <div className="pt-1">
            <button
              type="button"
              data-testid="button-checkin-toggle-more"
              onClick={() => setShowMore((s) => !s)}
              className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
            >
              {showMore ? "Hide" : "Show"} sleep + alignment
            </button>
          </div>
          {showMore && (
            <div className="space-y-5 pt-1" data-testid="section-checkin-more">
              <ReflectionChipRow
                label="Sleep"
                options={SLEEP_OPTIONS}
                current={chips.sleepLabel}
                onPick={(v) => pick("sleepLabel", v)}
                testIdPrefix="chip-checkin-sleep"
              />
              <ReflectionChipRow
                label="Alignment with people"
                options={ALIGNMENT_PEOPLE_OPTIONS}
                current={chips.alignmentPeople}
                onPick={(v) => pick("alignmentPeople", v)}
                testIdPrefix="chip-checkin-alignment-people"
              />
              <ReflectionChipRow
                label="Alignment with activities"
                options={ALIGNMENT_ACTIVITIES_OPTIONS}
                current={chips.alignmentActivities}
                onPick={(v) => pick("alignmentActivities", v)}
                testIdPrefix="chip-checkin-alignment-activities"
              />
            </div>
          )}

          <div className="space-y-2">
            <label
              htmlFor="checkin-note"
              className="text-sm text-muted-foreground"
            >
              Note (optional)
            </label>
            <Input
              id="checkin-note"
              data-testid="input-checkin-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="One-liner — what's the moment?"
              maxLength={200}
            />
          </div>

          <div className="flex items-center justify-end pt-2">
            <Button
              type="button"
              data-testid="button-save-checkin"
              disabled={!anyChipSet || saving}
              onClick={save}
            >
              {saving ? "Saving…" : "Save check-in"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Recent check-ins today */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          Today's check-ins
        </h2>
        {recentQ.isLoading ? (
          <div className="text-sm text-muted-foreground italic">Loading…</div>
        ) : !recentQ.data || recentQ.data.length === 0 ? (
          <div className="text-sm text-muted-foreground italic">
            None yet — your first save will appear here.
          </div>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {recentQ.data.map((row) => (
              <RecentCard key={row.id} row={row} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// Compact horizontal card showing time, phase, and the most-set chips.
// Source label appears as a small caption so the user can tell a
// coach_pre_session row apart from a checkin_page one at a glance.
function RecentCard({ row }: { row: DailyCheckIn }) {
  const chipSummary = [
    row.mood,
    row.energyLabel,
    row.cognitiveLoad,
    row.focus,
    row.arousalState,
  ]
    .filter((v): v is string => Boolean(v))
    .slice(0, 3)
    .join(" · ");
  const sourceLabel =
    row.source === "checkin_page"
      ? "Quick"
      : row.source === "morning_page"
        ? "Morning"
        : row.source === "evening_page"
          ? "Evening"
          : row.source === "coach_pre_session"
            ? "Coach"
            : row.source;
  return (
    <div
      data-testid={`card-recent-checkin-${row.id}`}
      className="shrink-0 min-w-[160px] rounded-md border border-border bg-card px-3 py-2"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{fmtTime(row.capturedAt)}</span>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {PHASE_LABELS[row.phase as Phase] ?? row.phase}
        </span>
      </div>
      <div className="text-xs text-muted-foreground mt-0.5">{sourceLabel}</div>
      {chipSummary ? (
        <div className="text-xs mt-1 text-foreground/80">{chipSummary}</div>
      ) : null}
      {row.note ? (
        <div className="text-xs italic mt-1 text-muted-foreground line-clamp-2">
          {row.note}
        </div>
      ) : null}
    </div>
  );
}
