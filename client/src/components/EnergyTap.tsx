import { useState } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { todayDateStr } from "@/lib/anchor";
import { useToast } from "@/hooks/use-toast";

const LEVELS: Array<{ value: number; emoji: string; label: string; state: string }> = [
  { value: 1, emoji: "🪫", label: "Drained", state: "flat" },
  { value: 2, emoji: "😶", label: "Low", state: "flat" },
  { value: 3, emoji: "😐", label: "Even", state: "calm" },
  { value: 4, emoji: "🙂", label: "Good", state: "calm" },
  { value: 5, emoji: "⚡", label: "Buzzing", state: "scattered" },
];

export function EnergyTap() {
  const [picked, setPicked] = useState<number | null>(null);
  const { toast } = useToast();

  const tap = async (level: number, state: string) => {
    setPicked(level);
    try {
      await apiRequest("POST", "/api/reflections", {
        date: todayDateStr(),
        kind: "daily",
        energy: level,
        state,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/reflections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/briefing"] });
      toast({ title: "Energy logged", description: `Level ${level}` });
    } catch {
      toast({ title: "Couldn't save", variant: "destructive" });
    }
  };

  return (
    <div className="rounded-lg border border-card-border bg-card p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
        How's your energy right now?
      </div>
      <div className="flex flex-wrap gap-2">
        {LEVELS.map((l) => (
          <button
            key={l.value}
            onClick={() => tap(l.value, l.state)}
            data-testid={`button-energy-${l.value}`}
            className={`flex-1 min-w-[80px] rounded-md border py-2 text-sm hover-elevate active-elevate-2 ${
              picked === l.value
                ? "border-primary bg-primary/10"
                : "border-border bg-secondary"
            }`}
          >
            <div className="text-xl leading-none">{l.emoji}</div>
            <div className="text-xs mt-1 text-muted-foreground">{l.label}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
