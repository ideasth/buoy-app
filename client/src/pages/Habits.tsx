import { useQuery } from "@tanstack/react-query";
import type { Habit, HabitLog } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Flame, X } from "lucide-react";
import { useMemo, useState } from "react";
import { todayDateStr } from "@/lib/anchor";
import { useToast } from "@/hooks/use-toast";

function dateAddDays(date: string, n: number): string {
  const d = new Date(date + "T00:00:00");
  d.setDate(d.getDate() + n);
  return todayDateStr(d);
}

function lastNDays(n: number): string[] {
  const today = todayDateStr();
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(dateAddDays(today, -i));
  return out;
}

function streak(logs: HabitLog[], habitId: number): number {
  // count consecutive days ending today where done=1
  let s = 0;
  let d = todayDateStr();
  const map = new Map<string, HabitLog>();
  for (const l of logs.filter((x) => x.habitId === habitId)) map.set(l.date, l);
  while (true) {
    const log = map.get(d);
    if (log && log.done) {
      s++;
      d = dateAddDays(d, -1);
    } else if (s === 0 && d === todayDateStr()) {
      // allow today not yet done — start counting from yesterday
      d = dateAddDays(d, -1);
      const log2 = map.get(d);
      if (log2 && log2.done) {
        s++;
        d = dateAddDays(d, -1);
      } else {
        break;
      }
    } else {
      break;
    }
  }
  return s;
}

export default function HabitsPage() {
  const { toast } = useToast();
  const habitsQ = useQuery<Habit[]>({ queryKey: ["/api/habits"] });
  const logsQ = useQuery<HabitLog[]>({ queryKey: ["/api/habit-logs"] });
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");

  const days = useMemo(() => lastNDays(7), []);
  const today = todayDateStr();

  const logFor = (habitId: number, date: string) =>
    (logsQ.data ?? []).find((l) => l.habitId === habitId && l.date === date);

  const toggle = async (habitId: number, date: string) => {
    const existing = logFor(habitId, date);
    const newDone = existing?.done ? 0 : 1;
    await apiRequest("POST", "/api/habit-logs", { habitId, date, done: newDone });
    queryClient.invalidateQueries({ queryKey: ["/api/habit-logs"] });
  };

  const addHabit = async () => {
    if (!name.trim()) return;
    if ((habitsQ.data ?? []).length >= 5) {
      toast({
        title: "Five is the cap",
        description: "Archive one before adding another.",
        variant: "destructive",
      });
      return;
    }
    await apiRequest("POST", "/api/habits", { name: name.trim(), target: target.trim() });
    queryClient.invalidateQueries({ queryKey: ["/api/habits"] });
    setName("");
    setTarget("");
  };

  const remove = async (id: number) => {
    await apiRequest("DELETE", `/api/habits/${id}`);
    queryClient.invalidateQueries({ queryKey: ["/api/habits"] });
  };

  return (
    <div className="px-5 md:px-8 py-8 md:py-10 max-w-3xl space-y-8">
      <header>
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Habits</div>
        <h1 className="text-2xl font-semibold mt-1">Five keystone habits, no more.</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Tap a square to toggle done. Streaks help when momentum is gone.
        </p>
      </header>

      <div className="space-y-3">
        {(habitsQ.data ?? []).map((h) => {
          const s = streak(logsQ.data ?? [], h.id);
          return (
            <div
              key={h.id}
              className="rounded-lg border bg-card p-3 space-y-2"
              data-testid={`habit-row-${h.id}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{h.name}</div>
                  {h.target && (
                    <div className="text-xs text-muted-foreground truncate">{h.target}</div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div
                    className="inline-flex items-center gap-1 text-sm tabular-nums"
                    data-testid={`text-streak-${h.id}`}
                    title="Current streak"
                  >
                    <Flame className="h-3.5 w-3.5 text-primary" />
                    {s}
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => remove(h.id)}
                    data-testid={`button-remove-habit-${h.id}`}
                    aria-label={`Remove ${h.name}`}
                    className="h-7 w-7"
                  >
                    <X className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-7 gap-1.5">
                {days.map((d) => {
                  const log = logFor(h.id, d);
                  const isToday = d === today;
                  const dt = new Date(d + "T00:00:00");
                  return (
                    <button
                      key={d}
                      onClick={() => toggle(h.id, d)}
                      data-testid={`habit-cell-${h.id}-${d}`}
                      aria-label={`${h.name} ${d} ${log?.done ? "done" : "not done"}`}
                      className={`aspect-square rounded-md border text-xs flex flex-col items-center justify-center gap-0.5 hover-elevate active-elevate-2 ${
                        log?.done
                          ? "bg-primary text-primary-foreground border-primary"
                          : isToday
                            ? "border-primary/50 bg-secondary"
                            : "border-border bg-secondary text-muted-foreground"
                      }`}
                    >
                      <span className="text-[9px] uppercase tracking-wider opacity-70">
                        {dt.toLocaleDateString("en-AU", { weekday: "short" }).slice(0, 2)}
                      </span>
                      <span className="text-sm font-medium leading-none">
                        {log?.done ? "✓" : dt.getDate()}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        {(habitsQ.data ?? []).length === 0 && (
          <div className="text-sm text-muted-foreground italic rounded-lg border border-dashed p-6 text-center">
            No habits yet. Add your first below.
          </div>
        )}
      </div>

      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          Add habit ({(habitsQ.data ?? []).length}/5)
        </div>
        <div className="grid sm:grid-cols-2 gap-2">
          <Input
            placeholder="Name (e.g. Sleep)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid="input-habit-name"
          />
          <Input
            placeholder="Target (e.g. 7+ hours)"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            data-testid="input-habit-target"
          />
        </div>
        <Button onClick={addHabit} data-testid="button-add-habit">
          <Plus className="h-4 w-4 mr-1" />
          Add habit
        </Button>
      </div>
    </div>
  );
}
