import { useNow } from "@/hooks/use-now";
import { fmtClock, fmtTime, statusFor, fmtDuration } from "@/lib/anchor";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { Info, Zap, X } from "lucide-react";
import { useState, useRef } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";

interface CalEvent {
  uid: string;
  summary: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
}

interface TodayEventsRes {
  date: string;
  events: CalEvent[];
}

interface UsageTodayRes {
  estimatedCreditsLast24h: number;
  actualCreditsLast24h: number | null;
  lastBalance: { balance: number; recordedAt: number; ageHours: number } | null;
  runs24h: Record<string, number>;
  needsEntry: boolean;
}

function BalanceModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [balance, setBalance] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const overlayRef = useRef<HTMLDivElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const val = Number(balance);
    if (!Number.isFinite(val) || val < 0) {
      setError("Enter a valid credit balance.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await apiRequest("POST", "/api/usage/balance", { balance: val, note: note || undefined });
      onSaved();
      onClose();
    } catch {
      setError("Failed to save. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-sm mx-4 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-sm">Log credit balance</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            data-testid="button-balance-modal-close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Read your balance from the top of your Perplexity window and enter it below.
        </p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1">Credits remaining</label>
            <input
              type="number"
              min="0"
              placeholder="e.g. 8421"
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              autoFocus
              data-testid="input-credit-balance"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Note <span className="text-muted-foreground font-normal">(optional)</span></label>
            <input
              type="text"
              placeholder="e.g. after heavy agent session"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              data-testid="input-balance-note"
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-primary text-primary-foreground text-sm font-medium py-2 hover:opacity-90 disabled:opacity-50"
            data-testid="button-save-balance"
          >
            {loading ? "Saving…" : "Save balance"}
          </button>
        </form>
      </div>
    </div>
  );
}

function CreditChip() {
  const [, navigate] = useLocation();
  const [modalOpen, setModalOpen] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data } = useQuery<UsageTodayRes>({
    queryKey: ["/api/usage/today"],
    refetchInterval: 60_000,
  });

  if (!data) return null;

  const { estimatedCreditsLast24h, actualCreditsLast24h, lastBalance: lb, needsEntry } = data;

  const totalRuns = Object.values(data.runs24h).reduce((a, b) => a + b, 0);
  const calibAge = lb
    ? `${lb.ageHours}h ago`
    : "never";

  function handleChipClick() {
    navigate("/usage");
  }

  function handleSaved() {
    queryClient.invalidateQueries({ queryKey: ["/api/usage/today"] });
    queryClient.invalidateQueries({ queryKey: ["/api/usage/history"] });
    queryClient.invalidateQueries({ queryKey: ["/api/usage/balances"] });
  }

  if (needsEntry) {
    return (
      <>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20 transition-colors"
          data-testid="button-update-balance"
        >
          <Zap className="h-3 w-3" />
          Update balance
        </button>
        {modalOpen && <BalanceModal onClose={() => setModalOpen(false)} onSaved={handleSaved} />}
      </>
    );
  }

  return (
    <>
      <div className="relative inline-flex items-center gap-1.5">
        <button
          type="button"
          onClick={handleChipClick}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium bg-muted/60 text-muted-foreground hover:bg-muted transition-colors"
          data-testid="chip-credit-usage"
        >
          <Zap className="h-3 w-3" />
          ≈ {estimatedCreditsLast24h} credits / 24h
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setTooltipOpen((v) => !v); }}
            className="ml-0.5 text-muted-foreground/60 hover:text-muted-foreground"
            data-testid="button-credit-info"
          >
            <Info className="h-3 w-3" />
          </button>
        </button>

        {tooltipOpen && (
          <div
            className="absolute right-0 top-8 z-40 w-64 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg p-3 text-xs space-y-1"
            data-testid="tooltip-credit-info"
          >
            <button
              type="button"
              className="absolute top-2 right-2 text-muted-foreground hover:text-foreground"
              onClick={() => setTooltipOpen(false)}
            >
              <X className="h-3 w-3" />
            </button>
            <div className="font-medium">Credit usage (24h)</div>
            <div>Estimated from {totalRuns} cron run{totalRuns !== 1 ? "s" : ""}.</div>
            {actualCreditsLast24h !== null && (
              <div>Actual: <span className="font-medium">{actualCreditsLast24h}</span> credits used.</div>
            )}
            {lb && (
              <div className="text-muted-foreground">
                Last balance: {lb.balance.toLocaleString()} — recorded {calibAge}.
              </div>
            )}
            {actualCreditsLast24h === null && (
              <div className="text-muted-foreground">
                Log another balance to enable actual tracking.
              </div>
            )}
            <button
              type="button"
              onClick={() => { setTooltipOpen(false); setModalOpen(true); }}
              className="mt-1 w-full rounded bg-primary/10 text-primary px-2 py-1 font-medium hover:bg-primary/20"
            >
              Log balance now
            </button>
          </div>
        )}
      </div>
      {modalOpen && <BalanceModal onClose={() => setModalOpen(false)} onSaved={handleSaved} />}
    </>
  );
}

export function StatusHeader() {
  const now = useNow(1000);
  const { hh, mm, ss } = fmtClock(now);

  const { data } = useQuery<TodayEventsRes>({
    queryKey: ["/api/today-events"],
    refetchInterval: 60_000,
  });

  // Find next upcoming non-allday event
  const next = (data?.events ?? [])
    .filter((e) => !e.allDay && new Date(e.end) > now)
    .sort((a, b) => +new Date(a.start) - +new Date(b.start))[0];

  const minutesUntil = next
    ? Math.round((+new Date(next.start) - +now) / 60000)
    : null;
  const status = statusFor(minutesUntil);

  const statusColor =
    status === "red"
      ? "bg-[hsl(var(--status-red))] text-white"
      : status === "amber"
        ? "bg-[hsl(var(--status-amber))] text-[hsl(35_90%_10%)]"
        : "bg-[hsl(var(--status-green))] text-white";

  const dateStr = now.toLocaleDateString("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Australia/Melbourne",
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div
          className={cn(
            "rounded-lg px-4 py-2 inline-flex items-center gap-3 text-sm font-medium",
            statusColor,
          )}
          data-testid="status-pill"
        >
          <span className="h-2 w-2 rounded-full bg-current opacity-80" />
          {status === "green" && "On track"}
          {status === "amber" && "Soon — wrap up"}
          {status === "red" && "Overdue / running late"}
        </div>
        <CreditChip />
      </div>

      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <div
            className="clock-numerals text-6xl md:text-8xl font-medium leading-none"
            data-testid="text-clock"
          >
            {hh}:{mm}
            <span className="text-2xl md:text-3xl text-muted-foreground ml-2">{ss}</span>
          </div>
          <div className="text-sm text-muted-foreground mt-2" data-testid="text-date">
            {dateStr} · Australia/Melbourne
          </div>
        </div>

        <div className="md:text-right">
          {next ? (
            <>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Next event
              </div>
              <div
                className={cn(
                  "clock-numerals text-3xl md:text-5xl font-medium",
                  status === "amber" && "text-[hsl(var(--status-amber))]",
                  status === "red" && "text-[hsl(var(--status-red))]",
                )}
                data-testid="text-minutes-until-next"
              >
                {minutesUntil !== null && minutesUntil >= 0
                  ? fmtDuration(minutesUntil)
                  : "now"}
              </div>
              <div className="text-sm text-foreground/80 max-w-xs md:ml-auto truncate">
                {next.summary}
              </div>
              <div className="text-xs text-muted-foreground">
                {fmtTime(next.start)}–{fmtTime(next.end)}
                {next.location ? ` · ${next.location}` : ""}
              </div>
            </>
          ) : (
            <>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Next event
              </div>
              <div className="clock-numerals text-3xl md:text-5xl text-muted-foreground">
                —
              </div>
              <div className="text-sm text-muted-foreground">
                Nothing more on the calendar today
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
