import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Trash2, Zap, RefreshCw } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface UsageTodayRes {
  estimatedCreditsLast24h: number;
  actualCreditsLast24h: number | null;
  lastBalance: { balance: number; recordedAt: number; ageHours: number } | null;
  runs24h: Record<string, number>;
  needsEntry: boolean;
}

interface HistoryDay {
  date: string;
  estimated: number;
  actual: number | null;
  runs: Record<string, number>;
}

interface HistoryRes {
  days: HistoryDay[];
}

interface Estimate {
  cronType: string;
  perRunCredits: number;
  sampleCount: number;
  lastUpdatedAt: number | null;
}

interface BalanceRow {
  id: number;
  recordedAt: number;
  balance: number;
  note: string | null;
}

function fmtDate(ts: number) {
  return new Date(ts).toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Australia/Melbourne",
  });
}

function fmtShortDate(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
}

function AddBalanceForm({ onSaved }: { onSaved: () => void }) {
  const [balance, setBalance] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const val = Number(balance);
    if (!Number.isFinite(val) || val < 0) {
      setError("Enter a valid non-negative number.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await apiRequest("POST", "/api/usage/balance", { balance: val, note: note || undefined });
      setBalance("");
      setNote("");
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
      onSaved();
    } catch {
      setError("Failed to save balance.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1">
          <label className="block text-xs font-medium mb-1">Credits remaining</label>
          <input
            type="number"
            min="0"
            placeholder="e.g. 8421"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            data-testid="input-usage-balance"
          />
        </div>
        <div className="flex-1">
          <label className="block text-xs font-medium mb-1">Note <span className="text-muted-foreground">(optional)</span></label>
          <input
            type="text"
            placeholder="e.g. after heavy session"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            data-testid="input-usage-note"
          />
        </div>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {success && <p className="text-xs text-green-600 dark:text-green-400">Balance saved.</p>}
      <button
        type="submit"
        disabled={loading}
        className="rounded-md bg-primary text-primary-foreground text-sm font-medium px-4 py-2 hover:opacity-90 disabled:opacity-50"
        data-testid="button-usage-save-balance"
      >
        {loading ? "Saving…" : "Save balance"}
      </button>
      <p className="text-xs text-muted-foreground">
        Read your balance from the top of your Perplexity window.
      </p>
    </form>
  );
}

export default function Usage() {
  const queryClient = useQueryClient();

  const { data: today, isLoading: todayLoading } = useQuery<UsageTodayRes>({
    queryKey: ["/api/usage/today"],
    refetchInterval: 60_000,
  });

  const { data: history } = useQuery<HistoryRes>({
    queryKey: ["/api/usage/history"],
    refetchInterval: 60_000,
  });

  const { data: estimates } = useQuery<Estimate[]>({
    queryKey: ["/api/usage/estimates"],
    refetchInterval: 120_000,
  });

  // Build balance history by fetching today data and history for deltas
  const { data: recentBalancesRaw } = useQuery<BalanceRow[]>({
    queryKey: ["/api/usage/balances"],
    queryFn: async () => {
      // We'll use the history endpoint with more days and extract balance info
      // Actually we need a dedicated endpoint — use a workaround by calling the balance endpoint
      // The spec says DELETE /api/usage/balance/:id exists, so we know there's balance data
      // Let's use a custom fetch for the balance history
      const res = await apiRequest("GET", "/api/usage/balances");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ["/api/usage/today"] });
    queryClient.invalidateQueries({ queryKey: ["/api/usage/history"] });
    queryClient.invalidateQueries({ queryKey: ["/api/usage/estimates"] });
    queryClient.invalidateQueries({ queryKey: ["/api/usage/balances"] });
  }

  async function deleteBalance(id: number) {
    try {
      await apiRequest("DELETE", `/api/usage/balance/${id}`);
      invalidateAll();
    } catch {
      // ignore
    }
  }

  const chartData = (history?.days ?? []).map((d) => ({
    name: fmtShortDate(d.date),
    estimated: d.estimated,
    actual: d.actual,
  }));

  const runs24h = today?.runs24h ?? {};
  const estimates24h: Record<string, number> = {};
  if (estimates) {
    for (const e of estimates) estimates24h[e.cronType] = e.perRunCredits;
  }

  const breakdown = Object.entries(runs24h).map(([cronType, runs]) => ({
    cronType,
    runs,
    estimatedCredits: Math.round(runs * (estimates24h[cronType] ?? 0)),
    perRun: estimates24h[cronType] ?? 0,
  }));

  // Build balance rows with deltas from the recent balances
  const balanceRows = (recentBalancesRaw ?? []).map((row, i, arr) => {
    const prev = arr[i + 1];
    const delta = prev ? row.balance - prev.balance : null;
    return { ...row, delta };
  });

  if (todayLoading) {
    return (
      <div className="px-4 py-8">
        <div className="text-muted-foreground text-sm">Loading…</div>
      </div>
    );
  }

  return (
    <div className="px-4 py-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Zap className="h-5 w-5 text-primary" />
          Credit usage
        </h1>
        <button
          type="button"
          onClick={invalidateAll}
          className="text-muted-foreground hover:text-foreground"
          data-testid="button-usage-refresh"
          title="Refresh"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {/* Hero numbers */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-card p-5 space-y-1">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Estimated last 24h
          </div>
          <div className="text-4xl font-semibold tabular-nums" data-testid="text-estimated-24h">
            {today?.estimatedCreditsLast24h ?? 0}
          </div>
          <div className="text-xs text-muted-foreground">
            credits · from {Object.values(runs24h).reduce((a, b) => a + b, 0)} cron runs
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-5 space-y-1">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Actual (calibrated)
          </div>
          {today?.actualCreditsLast24h !== null && today?.actualCreditsLast24h !== undefined ? (
            <>
              <div className="text-4xl font-semibold tabular-nums text-primary" data-testid="text-actual-24h">
                {today.actualCreditsLast24h}
              </div>
              <div className="text-xs text-muted-foreground">
                credits consumed · from balance entries
              </div>
            </>
          ) : (
            <>
              <div className="text-2xl font-medium text-muted-foreground" data-testid="text-actual-24h">
                —
              </div>
              <div className="text-xs text-muted-foreground">
                Add another balance entry to calibrate
              </div>
            </>
          )}
        </div>
      </div>

      {today?.lastBalance && (
        <div className="text-xs text-muted-foreground">
          Last balance: <span className="font-medium text-foreground">{today.lastBalance.balance.toLocaleString()}</span> credits
          {" "}· logged {today.lastBalance.ageHours}h ago
        </div>
      )}

      {/* 7-day trend chart */}
      <div>
        <h2 className="text-sm font-semibold mb-3">7-day trend</h2>
        <div className="rounded-xl border border-border bg-card p-4">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
                width={32}
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                  fontSize: "12px",
                  color: "hsl(var(--popover-foreground))",
                }}
              />
              <Legend wrapperStyle={{ fontSize: "12px" }} />
              <Line
                type="monotone"
                dataKey="estimated"
                name="Estimated"
                stroke="hsl(var(--muted-foreground))"
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={false}
                connectNulls
              />
              <Line
                type="monotone"
                dataKey="actual"
                name="Actual"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Per-cron breakdown */}
      <div>
        <h2 className="text-sm font-semibold mb-3">Per-cron breakdown (24h)</h2>
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {breakdown.length === 0 ? (
            <div className="px-4 py-6 text-sm text-muted-foreground text-center">
              No cron runs logged in the last 24h.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-2 font-medium text-xs text-muted-foreground">Cron type</th>
                  <th className="text-right px-4 py-2 font-medium text-xs text-muted-foreground">Runs</th>
                  <th className="text-right px-4 py-2 font-medium text-xs text-muted-foreground">Est. credits</th>
                  <th className="text-right px-4 py-2 font-medium text-xs text-muted-foreground">Per run</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.map((row) => (
                  <tr key={row.cronType} className="border-b border-border last:border-0">
                    <td className="px-4 py-2 font-mono text-xs">{row.cronType}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{row.runs}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{row.estimatedCredits}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{row.perRun.toFixed(1)}</td>
                  </tr>
                ))}
                <tr className="bg-muted/20">
                  <td className="px-4 py-2 font-medium text-xs">Total</td>
                  <td className="px-4 py-2 text-right font-medium tabular-nums">
                    {breakdown.reduce((a, r) => a + r.runs, 0)}
                  </td>
                  <td className="px-4 py-2 text-right font-medium tabular-nums">
                    {breakdown.reduce((a, r) => a + r.estimatedCredits, 0)}
                  </td>
                  <td className="px-4 py-2" />
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Estimates table */}
      {estimates && estimates.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold mb-3">Learned estimates (all cron types)</h2>
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-2 font-medium text-xs text-muted-foreground">Cron type</th>
                  <th className="text-right px-4 py-2 font-medium text-xs text-muted-foreground">Per-run est.</th>
                  <th className="text-right px-4 py-2 font-medium text-xs text-muted-foreground">Calibrations</th>
                  <th className="text-right px-4 py-2 font-medium text-xs text-muted-foreground">Last updated</th>
                </tr>
              </thead>
              <tbody>
                {estimates.map((e) => (
                  <tr key={e.cronType} className="border-b border-border last:border-0">
                    <td className="px-4 py-2 font-mono text-xs">{e.cronType}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{e.perRunCredits.toFixed(2)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{e.sampleCount}</td>
                    <td className="px-4 py-2 text-right text-muted-foreground text-xs">
                      {e.lastUpdatedAt ? fmtDate(e.lastUpdatedAt) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Balance history */}
      <div>
        <h2 className="text-sm font-semibold mb-3">Balance history</h2>
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {balanceRows.length === 0 ? (
            <div className="px-4 py-6 text-sm text-muted-foreground text-center">
              No balance entries yet. Add your first one below.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-2 font-medium text-xs text-muted-foreground">When</th>
                  <th className="text-right px-4 py-2 font-medium text-xs text-muted-foreground">Balance</th>
                  <th className="text-right px-4 py-2 font-medium text-xs text-muted-foreground">Change</th>
                  <th className="text-left px-4 py-2 font-medium text-xs text-muted-foreground">Note</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {balanceRows.map((row) => (
                  <tr key={row.id} className="border-b border-border last:border-0" data-testid={`row-balance-${row.id}`}>
                    <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">
                      {fmtDate(row.recordedAt)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums font-medium">
                      {row.balance.toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-xs">
                      {row.delta !== null ? (
                        <span className={row.delta < 0 ? "text-destructive" : "text-green-600 dark:text-green-400"}>
                          {row.delta > 0 ? "+" : ""}{row.delta.toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground max-w-[160px] truncate">
                      {row.note ?? ""}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => deleteBalance(row.id)}
                        className="text-muted-foreground/50 hover:text-destructive transition-colors"
                        data-testid={`button-delete-balance-${row.id}`}
                        title="Delete entry"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Add balance form */}
      <div>
        <h2 className="text-sm font-semibold mb-3">Add balance entry</h2>
        <div className="rounded-xl border border-border bg-card p-5">
          <AddBalanceForm onSaved={invalidateAll} />
        </div>
      </div>
    </div>
  );
}
