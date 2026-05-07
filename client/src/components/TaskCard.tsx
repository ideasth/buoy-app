import { Task } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Check, Play, X, Clock } from "lucide-react";
import { domainLabel, domainTone, fmtDuration } from "@/lib/anchor";
import { cn } from "@/lib/utils";

export function TaskCard({
  task,
  highlight = false,
  showFocus = true,
  onFocus,
  onComplete,
  onDrop,
}: {
  task: Task;
  highlight?: boolean;
  showFocus?: boolean;
  onFocus?: (t: Task) => void;
  onComplete?: (t: Task) => void;
  onDrop?: (t: Task) => void;
}) {
  const done = task.status === "done";
  const dropped = task.status === "dropped";

  return (
    <div
      data-testid={`card-task-${task.id}`}
      className={cn(
        "rounded-lg border p-4 transition-colors",
        highlight
          ? "border-primary/40 bg-primary/5"
          : "border-card-border bg-card",
        done && "opacity-60",
        dropped && "opacity-40 line-through",
      )}
    >
      <div className="flex items-start gap-3">
        <button
          onClick={() => onComplete?.(task)}
          aria-label="Mark complete"
          data-testid={`button-complete-${task.id}`}
          className={cn(
            "mt-0.5 h-5 w-5 rounded-full border flex items-center justify-center shrink-0",
            done
              ? "bg-primary text-primary-foreground border-primary"
              : "border-input hover-elevate",
          )}
        >
          {done && <Check className="h-3 w-3" />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="font-medium leading-snug" data-testid={`text-task-title-${task.id}`}>
            {task.title}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span
              className={cn(
                "rounded-full border px-2 py-0.5",
                domainTone(task.domain),
              )}
            >
              {domainLabel(task.domain)}
            </span>
            <span className="rounded-full border border-border px-2 py-0.5 text-muted-foreground inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              est {fmtDuration(task.estimateMinutes)}
              {task.actualMinutes ? ` · actual ${fmtDuration(task.actualMinutes)}` : ""}
            </span>
            {task.priority !== "iftime" && (
              <span className="rounded-full border border-border px-2 py-0.5 text-muted-foreground capitalize">
                {task.priority}
              </span>
            )}
            {task.tag && (
              <span
                className="rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground"
                title={task.tag}
                data-testid={`tag-task-${task.id}`}
              >
                {task.tag.length > 22 ? `${task.tag.slice(0, 21)}…` : task.tag}
              </span>
            )}
          </div>
          {task.notes && (
            <div className="mt-2 text-xs text-muted-foreground line-clamp-2">{task.notes}</div>
          )}
        </div>

        <div className="flex items-center gap-1">
          {showFocus && !done && !dropped && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onFocus?.(task)}
              data-testid={`button-focus-${task.id}`}
            >
              <Play className="h-3 w-3 mr-1" />
              Focus
            </Button>
          )}
          {onDrop && !done && !dropped && (
            <Button
              size="icon"
              variant="ghost"
              onClick={() => onDrop?.(task)}
              data-testid={`button-drop-${task.id}`}
              aria-label="Drop task"
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
