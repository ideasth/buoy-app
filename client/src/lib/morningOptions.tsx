// Shared chip-style reflection options used by both the Morning page and
// the Reflect page (Stage 6 — 2026-05-09). Extracted from Morning.tsx so
// the two pages stay aligned automatically as the option sets evolve.
//
// Where an option corresponds to a Reflect Mood-and-Factors measure
// (client/src/lib/factors.ts), we use the same value strings and icons so
// Morning + Reflect tracking is comparable and visually consistent.
// Icons are user-facing per design spec; code comments stay emoji-free.

import { cn } from "@/lib/utils";

export type ChipOption = { value: string; label: string; icon?: string };

// Arousal state — Morning + Reflect (no Reflect Mood-and-Factors counterpart).
// Plain icons chosen to match the chip aesthetic without inventing new
// clinical semantics.
export const AROUSAL_STATE_OPTIONS: ChipOption[] = [
  { value: "hypo", label: "Hypo", icon: "\u{1F53D}" },
  { value: "calm", label: "Calm", icon: "\u{1F7E2}" },
  { value: "hyper", label: "Hyper", icon: "\u{1F53C}" },
];

export const MOOD_OPTIONS: ChipOption[] = [
  { value: "positive", label: "Positive", icon: "\u{1F642}" },
  { value: "neutral", label: "Neutral", icon: "\u{1F610}" },
  { value: "strained", label: "Strained", icon: "\u{1F624}" },
];

export const COGNITIVE_LOAD_OPTIONS: ChipOption[] = [
  { value: "low", label: "Low / clear", icon: "\u{1F7E2}" },
  { value: "moderate", label: "Moderate", icon: "\u{1F7E1}" },
  { value: "high", label: "High (overloaded)", icon: "\u{1F534}" },
];

// Reflect-aligned option sets. Values + icons match factors.ts so Morning +
// Reflect tracking compares cleanly.
export const ENERGY_OPTIONS: ChipOption[] = [
  { value: "low", label: "Low", icon: "\u26A1" },
  { value: "moderate", label: "Moderate", icon: "\u26A1\u26A1" },
  { value: "high", label: "High", icon: "\u26A1\u26A1\u26A1" },
];

export const SLEEP_OPTIONS: ChipOption[] = [
  { value: "restorative", label: "Restorative", icon: "\u{1F642}" },
  { value: "adequate", label: "Adequate", icon: "\u{1F610}" },
  { value: "poor", label: "Poor / disrupted", icon: "\u{1F635}\u200D\u{1F4AB}" },
];

export const FOCUS_OPTIONS: ChipOption[] = [
  { value: "focused", label: "Focused", icon: "\u{1F3AF}" },
  { value: "scattered", label: "Scattered", icon: "\u{1F635}\u200D\u{1F4AB}" },
];

// Two-axis alignment split — replaces legacy yes/no.
export const ALIGNMENT_PEOPLE_OPTIONS: ChipOption[] = [
  { value: "aligned", label: "Aligned", icon: "\u2705" },
  { value: "neutral", label: "Neutral", icon: "\u26AA" },
  { value: "disconnected", label: "Disconnected", icon: "\u274C" },
];

export const ALIGNMENT_ACTIVITIES_OPTIONS: ChipOption[] = [
  { value: "aligned", label: "Aligned", icon: "\u2705" },
  { value: "neutral", label: "Neutral", icon: "\u26AA" },
  { value: "misaligned", label: "Misaligned", icon: "\u274C" },
];

// Shared chip row used across Morning + Reflect reflection items so the
// visual style matches between pages.
export function ReflectionChipRow({
  label,
  options,
  current,
  onPick,
  testIdPrefix,
}: {
  label: string;
  options: ChipOption[];
  current: string | null;
  onPick: (value: string) => void;
  testIdPrefix: string;
}) {
  return (
    <div className="space-y-2">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const selected = current === o.value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onPick(o.value)}
              aria-pressed={selected}
              aria-label={o.label}
              title={o.label}
              data-testid={`${testIdPrefix}-${o.value}`}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm transition-colors hover-elevate active-elevate-2",
                selected
                  ? "border-primary bg-primary/10 text-foreground font-medium ring-1 ring-primary/40"
                  : "border-border bg-background text-muted-foreground hover:text-foreground",
              )}
            >
              {o.icon && <span aria-hidden="true">{o.icon}</span>}
              <span>{o.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
