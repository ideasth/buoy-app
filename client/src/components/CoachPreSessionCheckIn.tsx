// Stage 9b (2026-05-10) — Coach pre-session check-in modal.
//
// Shown immediately before a Plan or Reflect session is opened, so the
// model has fresh chip state to anchor the conversation. The host page
// (Coach) decides whether to show the modal by calling
// /api/checkins/latest first and skipping if the most recent row is
// within the last 90 minutes (FRESHNESS_MS below).
//
// Four chip rows only — mood, energy, cognitive load, focus — kept
// shorter than the Morning/Evening pages so it doesn't feel like a
// ritual. Two buttons:
//   - Save and continue: POST /api/checkins (source=coach_pre_session,
//     phase auto-derived) then call onContinue.
//   - Skip: just call onContinue without writing.
//
// Phase auto-derivation matches CheckIn.tsx exactly so a row written
// here lines up with rows written on /checkin in the same window.
//
// data-testids: modal-coach-pre-checkin, chip-precheckin-{field}-{value},
// button-precheckin-save, button-precheckin-skip.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  MOOD_OPTIONS,
  COGNITIVE_LOAD_OPTIONS,
  ENERGY_OPTIONS,
  FOCUS_OPTIONS,
  ReflectionChipRow,
} from "@/lib/morningOptions";

// Match CheckIn.tsx — duplicate the helpers here so this component is
// drop-in-usable from anywhere without depending on the page module.
type Phase = "morning" | "midday" | "evening" | "adhoc";

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
function phaseFromClock(): Phase {
  const h = melbourneClockDecimal();
  if (h >= 4 && h < 11) return "morning";
  if (h >= 11 && h < 16.5) return "midday";
  if (h >= 16.5 && h < 22) return "evening";
  return "adhoc";
}

// 90-minute freshness window + predicate live in /shared so they're
// importable in node-environment tests without dragging the @/-aliased
// React component graph along. Re-exported here for convenience.
export { CHECKIN_FRESHNESS_MS, isCheckinFresh } from "@shared/checkin-mapping";

interface ChipState {
  mood: string | null;
  energyLabel: string | null;
  cognitiveLoad: string | null;
  focus: string | null;
}
const EMPTY: ChipState = {
  mood: null,
  energyLabel: null,
  cognitiveLoad: null,
  focus: null,
};

export interface CoachPreSessionCheckInProps {
  open: boolean;
  // Called when the user finishes (after Save or Skip). The host should
  // then proceed with starting the Coach session it had queued.
  onContinue: () => void;
  // Called if the user dismisses the dialog (e.g. clicks outside or
  // hits Escape). Treated the same as Skip by the host in practice.
  onCancel?: () => void;
}

export function CoachPreSessionCheckIn({
  open,
  onContinue,
  onCancel,
}: CoachPreSessionCheckInProps) {
  const [chips, setChips] = useState<ChipState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  function pick<K extends keyof ChipState>(key: K, value: string) {
    setChips((c) => ({ ...c, [key]: c[key] === value ? null : value }));
  }

  function reset() {
    setChips(EMPTY);
  }

  async function saveAndContinue() {
    if (saving) return;
    const anySet = Object.values(chips).some((v) => v !== null);
    if (!anySet) {
      // Nothing to save — treat as skip.
      reset();
      onContinue();
      return;
    }
    setSaving(true);
    try {
      const today = melbourneDateStr();
      const body: Record<string, unknown> = {
        date: today,
        phase: phaseFromClock(),
        source: "coach_pre_session",
      };
      for (const [k, v] of Object.entries(chips)) {
        if (v !== null) body[k] = v;
      }
      await apiRequest("POST", "/api/checkins", body);
      // Prime the cache the host page will read for the next 90 min
      // freshness gate.
      await queryClient.invalidateQueries({
        queryKey: ["/api/checkins/latest", today],
      });
      await queryClient.invalidateQueries({
        queryKey: ["/api/checkins", today],
      });
      reset();
      onContinue();
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

  function skip() {
    reset();
    onContinue();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          // Dialog closed via outside click or Escape. Treat as skip
          // unless the host wants different cancel semantics.
          if (onCancel) onCancel();
          else skip();
        }
      }}
    >
      <DialogContent
        className="max-w-md"
        data-testid="modal-coach-pre-checkin"
      >
        <DialogHeader>
          <DialogTitle>Quick check-in before we start</DialogTitle>
        </DialogHeader>
        <div className="text-sm text-muted-foreground -mt-2">
          Helps Coach anchor the conversation. Skip if you've already
          captured this in the last hour or so.
        </div>
        <div className="space-y-5 pt-2">
          <ReflectionChipRow
            label="Mood"
            options={MOOD_OPTIONS}
            current={chips.mood}
            onPick={(v) => pick("mood", v)}
            testIdPrefix="chip-precheckin-mood"
          />
          <ReflectionChipRow
            label="Energy"
            options={ENERGY_OPTIONS}
            current={chips.energyLabel}
            onPick={(v) => pick("energyLabel", v)}
            testIdPrefix="chip-precheckin-energy"
          />
          <ReflectionChipRow
            label="Cognitive load"
            options={COGNITIVE_LOAD_OPTIONS}
            current={chips.cognitiveLoad}
            onPick={(v) => pick("cognitiveLoad", v)}
            testIdPrefix="chip-precheckin-cognitive-load"
          />
          <ReflectionChipRow
            label="Focus"
            options={FOCUS_OPTIONS}
            current={chips.focus}
            onPick={(v) => pick("focus", v)}
            testIdPrefix="chip-precheckin-focus"
          />
        </div>
        <DialogFooter className="gap-2">
          <Button
            variant="ghost"
            data-testid="button-precheckin-skip"
            onClick={skip}
            disabled={saving}
          >
            Skip
          </Button>
          <Button
            data-testid="button-precheckin-save"
            onClick={saveAndContinue}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save and continue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
