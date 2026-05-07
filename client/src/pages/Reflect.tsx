import { useQuery } from "@tanstack/react-query";
import type { Reflection } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { todayDateStr } from "@/lib/anchor";
import { useToast } from "@/hooks/use-toast";

const STATES = [
  { value: "calm", label: "Calm" },
  { value: "anxious", label: "Anxious" },
  { value: "scattered", label: "Scattered" },
  { value: "flat", label: "Flat" },
];

function isSunday(d = new Date()) {
  return d.getDay() === 0;
}

export default function Reflect() {
  const promptQ = useQuery<{ prompt: string }>({ queryKey: ["/api/reflection-prompt"] });
  const { toast } = useToast();

  const [energy, setEnergy] = useState<number>(3);
  const [state, setState] = useState<string>("calm");
  const [avoided, setAvoided] = useState("");
  const [notes, setNotes] = useState("");

  // Weekly fields
  const [wins, setWins] = useState("");
  const [slipped, setSlipped] = useState("");
  const [patterns, setPatterns] = useState("");
  const [nextAnchor, setNextAnchor] = useState("");
  const [drop, setDrop] = useState("");

  const submitDaily = async () => {
    await apiRequest("POST", "/api/reflections", {
      date: todayDateStr(),
      kind: "daily",
      energy,
      state,
      avoidedTask: avoided || null,
      notes: notes || null,
    });
    queryClient.invalidateQueries({ queryKey: ["/api/reflections"] });
    queryClient.invalidateQueries({ queryKey: ["/api/briefing"] });
    toast({ title: "Reflection saved" });
    setAvoided("");
    setNotes("");
  };

  const submitWeekly = async () => {
    const composed = JSON.stringify({ wins, slipped, patterns, nextAnchor, drop });
    await apiRequest("POST", "/api/reflections", {
      date: todayDateStr(),
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
    <div className="px-5 md:px-8 py-8 md:py-10 max-w-2xl space-y-10">
      <header>
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Reflect</div>
        <h1 className="text-2xl font-semibold mt-1">Two minutes before you switch off.</h1>
      </header>

      {/* Daily */}
      <section className="space-y-4">
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Today's prompt
          </div>
          <div className="text-lg mt-1 font-medium">
            {promptQ.data?.prompt ?? "What did you avoid today?"}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Energy</div>
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setEnergy(n)}
                data-testid={`button-reflect-energy-${n}`}
                className={`flex-1 rounded-md border py-3 text-sm hover-elevate ${
                  energy === n
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-secondary border-border"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">State</div>
          <div className="flex flex-wrap gap-2">
            {STATES.map((s) => (
              <button
                key={s.value}
                onClick={() => setState(s.value)}
                data-testid={`button-reflect-state-${s.value}`}
                className={`px-4 py-2 rounded-md border text-sm hover-elevate ${
                  state === s.value
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-secondary border-border"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            What I avoided
          </div>
          <Input
            value={avoided}
            onChange={(e) => setAvoided(e.target.value)}
            placeholder="The one thing I sidestepped today."
            data-testid="input-avoided-task"
          />
        </div>

        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Anything else
          </div>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Free notes — short."
            data-testid="textarea-reflection-notes"
          />
        </div>

        <Button onClick={submitDaily} data-testid="button-submit-daily">
          Save daily reflection
        </Button>
      </section>

      {/* Weekly */}
      <section className="space-y-3 border-t pt-8">
        <div>
          <h2 className="text-base font-semibold">Weekly review</h2>
          <p className="text-xs text-muted-foreground">
            {isSunday() ? "It's Sunday — perfect time." : "Anytime, but Sundays are best."}
          </p>
        </div>
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
