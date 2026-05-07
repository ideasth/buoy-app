import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ESTIMATE_PRESETS, fmtDuration } from "@/lib/anchor";
import { Progress } from "@/components/ui/progress";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Task } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

type Phase = "pick" | "running" | "overrun" | "complete";

export function FocusSession({
  task,
  open,
  onOpenChange,
}: {
  task: Task | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [phase, setPhase] = useState<Phase>("pick");
  const [duration, setDuration] = useState<number>(30);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [actual, setActual] = useState<number>(30);
  const notifiedRef = useRef<{ p75?: boolean; p100?: boolean; overrun?: boolean }>({});
  const { toast } = useToast();

  useEffect(() => {
    if (!open) {
      setPhase("pick");
      setStartedAt(null);
      notifiedRef.current = {};
    } else if (task?.estimateMinutes) {
      setDuration(task.estimateMinutes);
      setActual(task.estimateMinutes);
    }
  }, [open, task]);

  useEffect(() => {
    if (phase !== "running" && phase !== "overrun") return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [phase]);

  const elapsedMs = startedAt ? now - startedAt : 0;
  const totalMs = duration * 60_000;
  const remainingMs = totalMs - elapsedMs;
  const overrunMs = elapsedMs - totalMs;
  const ratio = Math.min(1, elapsedMs / Math.max(1, totalMs));

  // milestone notifications
  useEffect(() => {
    if (phase !== "running") return;
    if (!notifiedRef.current.p75 && ratio >= 0.75) {
      notifiedRef.current.p75 = true;
      try {
        navigator.vibrate?.(80);
      } catch {}
      toast({ title: "75% through", description: "Start wrapping up." });
    }
    if (!notifiedRef.current.p100 && ratio >= 1) {
      notifiedRef.current.p100 = true;
      try {
        navigator.vibrate?.([100, 60, 100]);
      } catch {}
      toast({ title: "Time's up", description: "Step out, breathe, log it." });
    }
    if (phase === "running" && elapsedMs >= totalMs * 1.25) {
      notifiedRef.current.overrun = true;
      setPhase("overrun");
    }
  }, [ratio, elapsedMs, totalMs, phase, toast]);

  const start = (mins: number) => {
    setDuration(mins);
    setActual(mins);
    setStartedAt(Date.now());
    setNow(Date.now());
    notifiedRef.current = {};
    setPhase("running");
  };

  const stop = () => {
    const minsActual = Math.max(1, Math.round(elapsedMs / 60000));
    setActual(minsActual);
    setPhase("complete");
  };

  const extend = () => {
    setDuration((d) => d + 15);
    setPhase("running");
  };

  const completeTask = async () => {
    if (!task) return;
    try {
      await apiRequest("PATCH", `/api/tasks/${task.id}`, {
        status: "done",
        actualMinutes: actual,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/briefing"] });
      toast({ title: "Logged", description: `${task.title} · ${actual}m actual` });
      onOpenChange(false);
    } catch (err) {
      toast({ title: "Save failed", description: String(err), variant: "destructive" });
    }
  };

  const skipComplete = async () => {
    if (!task) return;
    // Just log time block, don't mark done
    if (startedAt) {
      try {
        await apiRequest("POST", "/api/time-blocks", {
          taskId: task.id,
          plannedStart: startedAt,
          plannedEnd: startedAt + duration * 60_000,
          actualStart: startedAt,
          actualEnd: Date.now(),
          kind: "focus",
        });
      } catch {}
    }
    onOpenChange(false);
  };

  if (!task) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        {phase === "pick" && (
          <div className="space-y-5 p-2">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Focus on
              </div>
              <div className="text-xl font-semibold mt-1" data-testid="text-focus-task">
                {task.title}
              </div>
            </div>
            <div className="text-sm text-muted-foreground">
              How long? Pick a hard timer — the timer is the commitment.
            </div>
            <div className="grid grid-cols-5 gap-2">
              {ESTIMATE_PRESETS.map((m) => (
                <button
                  key={m}
                  onClick={() => start(m)}
                  data-testid={`button-focus-${m}`}
                  className="rounded-md border bg-secondary text-secondary-foreground py-3 text-base font-medium hover-elevate active-elevate-2"
                >
                  {m}m
                </button>
              ))}
            </div>
            <div className="text-xs text-muted-foreground">
              Default estimate: {task.estimateMinutes}m. Pick something you'll actually finish in.
            </div>
          </div>
        )}

        {phase === "running" && (
          <FocusRunning
            task={task}
            durationMs={totalMs}
            remainingMs={remainingMs}
            ratio={ratio}
            onStop={stop}
          />
        )}

        {phase === "overrun" && (
          <div className="space-y-4 p-2 text-center">
            <div className="text-xs uppercase tracking-wider text-[hsl(var(--status-red))]">
              Hyperfocus warning
            </div>
            <div className="text-xl font-semibold">25% over committed time</div>
            <div className="text-sm text-muted-foreground">
              You're {fmtDuration(overrunMs / 60000)} past the timer.
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={stop} data-testid="button-overrun-stop">
                Stop now
              </Button>
              <Button className="flex-1" onClick={extend} data-testid="button-overrun-extend">
                Extend 15m
              </Button>
            </div>
          </div>
        )}

        {phase === "complete" && (
          <div className="space-y-4 p-2">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Log actual minutes
              </div>
              <div className="text-lg font-medium mt-1">{task.title}</div>
              <div className="text-xs text-muted-foreground">
                Estimated: {task.estimateMinutes}m
              </div>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {ESTIMATE_PRESETS.map((m) => (
                <button
                  key={m}
                  onClick={() => setActual(m)}
                  data-testid={`button-actual-${m}`}
                  className={`rounded-md border py-2 text-sm ${
                    actual === m
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-secondary text-secondary-foreground hover-elevate"
                  }`}
                >
                  {m}m
                </button>
              ))}
            </div>
            <input
              type="number"
              min={1}
              value={actual}
              onChange={(e) => setActual(Number(e.target.value))}
              className="w-full rounded-md border bg-background px-3 py-2"
              data-testid="input-actual-minutes"
            />
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={skipComplete} data-testid="button-skip-complete">
                Pause (don't mark done)
              </Button>
              <Button className="flex-1" onClick={completeTask} data-testid="button-confirm-complete">
                Mark done · {actual}m
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FocusRunning({
  task,
  durationMs,
  remainingMs,
  ratio,
  onStop,
}: {
  task: Task;
  durationMs: number;
  remainingMs: number;
  ratio: number;
  onStop: () => void;
}) {
  const total = Math.max(0, remainingMs);
  const m = Math.floor(total / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  return (
    <div className="space-y-4 text-center p-2">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        Focus · {fmtDuration(durationMs / 60000)}
      </div>
      <div className="text-base font-medium truncate">{task.title}</div>
      <div
        className="clock-numerals text-7xl md:text-8xl font-medium tabular-nums"
        data-testid="text-focus-countdown"
      >
        {String(Math.max(0, m)).padStart(2, "0")}:{String(Math.max(0, s)).padStart(2, "0")}
      </div>
      <Progress value={Math.min(100, ratio * 100)} className="h-2" />
      <div className="flex gap-2 justify-center">
        <Button variant="outline" onClick={onStop} data-testid="button-focus-stop">
          Stop & log
        </Button>
      </div>
    </div>
  );
}
