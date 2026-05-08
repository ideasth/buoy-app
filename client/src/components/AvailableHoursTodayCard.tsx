// AvailableHoursTodayCard — surfaces today's project-time budget.
//
// Pulls /api/available-hours/today and shows a compact card:
//   "Project time available — today"  =  free minutes after subtracting paid
//   work events, family events, other committed events, and transit minutes
//   from the day's waking budget (16h, 07:00 – 23:00).
//
// Mirrors AvailableHoursCard's compact look, but for a single day and with
// a transit row added.

import { useQuery } from "@tanstack/react-query";
import { fmtDuration } from "@/lib/anchor";

interface AvailableHoursToday {
  todayYmd: string;
  totalDayMinutes: number;
  sleepMinutes: number;
  totalWakingMinutes: number;
  paidWorkMinutes: number;
  familyMinutes: number;
  otherCommittedMinutes: number;
  transitMinutes: number;
  freeMinutes: number;
  generatedAt: string;
}

export function AvailableHoursTodayCard() {
  const q = useQuery<AvailableHoursToday>({
    queryKey: ["/api/available-hours/today"],
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  if (q.isLoading) {
    return (
      <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        Loading today's hours…
      </div>
    );
  }
  if (q.isError || !q.data) {
    return (
      <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        Could not load today's hours.
      </div>
    );
  }
  const d = q.data;

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3" data-testid="available-hours-today-card">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Time for me — today
          </div>
          <div className="clock-numerals text-2xl font-medium mt-1 tabular-nums">
            {fmtDuration(d.freeMinutes)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Waking
          </div>
          <div className="text-sm tabular-nums mt-1 text-muted-foreground">
            {fmtDuration(d.totalWakingMinutes)}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <BreakdownItem label="Paid work" value={fmtDuration(d.paidWorkMinutes)} />
        <BreakdownItem label="Family" value={fmtDuration(d.familyMinutes)} />
        <BreakdownItem label="Transit" value={fmtDuration(d.transitMinutes)} />
        <BreakdownItem label="Other committed" value={fmtDuration(d.otherCommittedMinutes)} />
      </div>
      <div className="text-xs text-muted-foreground">
        Free time = waking ({fmtDuration(d.totalWakingMinutes)}) − paid work − family − transit − other
        commitments. Sleep assumed 23:00 – 07:00. Transit uses each event's
        leave-by allowance.
      </div>
    </div>
  );
}

function BreakdownItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="tabular-nums mt-0.5 text-sm">{value}</div>
    </div>
  );
}
