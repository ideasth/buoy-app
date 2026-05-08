// /admin — combined ops + usage + settings.
//
// Three tabs share this URL: Health (read-only ops dashboard backed by
// /api/admin/health), Usage (token/cost telemetry), and Settings (user prefs).
// Tab state is mirrored in the URL hash query (?tab=health|usage|settings)
// so deep-links and the back button both work, and the legacy /settings and
// /usage paths can route in via #/admin?tab=settings.

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { RefreshCw } from "lucide-react";
import Usage from "@/pages/Usage";
import SettingsPage from "@/pages/Settings";

type AdminTab = "health" | "usage" | "settings";

function readTabFromHash(): AdminTab {
  if (typeof window === "undefined") return "health";
  const hash = window.location.hash || "";
  const qIdx = hash.indexOf("?");
  if (qIdx < 0) return "health";
  const params = new URLSearchParams(hash.slice(qIdx + 1));
  const t = params.get("tab");
  if (t === "usage" || t === "settings" || t === "health") return t;
  return "health";
}

function writeTabToHash(tab: AdminTab) {
  if (typeof window === "undefined") return;
  const hash = window.location.hash || "#/admin";
  const [path] = hash.split("?");
  const next = tab === "health" ? path : `${path}?tab=${tab}`;
  if (next !== hash) {
    // replaceState avoids polluting back history with each tab switch
    window.history.replaceState(null, "", next);
  }
}

export default function Admin() {
  const [tab, setTab] = useState<AdminTab>(() => readTabFromHash());

  // Listen for back/forward navigation and external hash changes
  useEffect(() => {
    const onHash = () => setTab(readTabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const change = (next: string) => {
    const t = (next as AdminTab) ?? "health";
    setTab(t);
    writeTabToHash(t);
  };

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Admin</h1>
        <p className="text-sm text-muted-foreground">
          Ops health, usage telemetry, and user settings.
        </p>
      </div>

      <Tabs value={tab} onValueChange={change}>
        <TabsList>
          <TabsTrigger value="health" data-testid="tab-health">
            Health
          </TabsTrigger>
          <TabsTrigger value="usage" data-testid="tab-usage">
            Usage
          </TabsTrigger>
          <TabsTrigger value="settings" data-testid="tab-settings">
            Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="health" className="mt-4">
          <HealthDashboard />
        </TabsContent>

        <TabsContent value="usage" className="mt-4">
          {/* Re-uses the standalone Usage page component verbatim. */}
          <Usage />
        </TabsContent>

        <TabsContent value="settings" className="mt-4">
          {/* Re-uses the standalone Settings page component verbatim. */}
          <SettingsPage />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ----- Health dashboard (was the entire Admin page before consolidation) -----

interface RecentErrorsResponse {
  ringSize: number;
  errors: Array<{
    createdAt: number;
    statusCode: number | null;
    method: string | null;
    path: string | null;
    message: string;
    stack: string | null;
  }>;
}

interface HealthResponse {
  generatedAt: number;
  db: {
    path: string;
    exists: boolean;
    sizeBytes: number;
    importEnabled: boolean;
  };
  backups: {
    dir: string;
    readable: boolean;
    count: number;
    lastLocalMtime: number | null;
    lastLocalPath: string | null;
    lastReceipt: {
      id: number;
      onedriveUrl: string;
      mtime: number | null;
      sizeBytes: number | null;
      note: string | null;
      createdAt: number;
    } | null;
    note: string | null;
  };
  crons: Array<{
    id: string;
    name: string;
    cron: string;
    note: string;
  }>;
  cronHeartbeats?: Array<{
    cronId: string;
    ranAt: number | null;
    anomalyReason: string | null;
    createdAt: number | null;
  }>;
  icsFeeds?: Array<{
    label: string;
    url: string | null; // present only when authed via X-Anchor-Sync-Secret
    urlMasked: string;
    hasUrl: boolean;
    lastFetchedAt: number | null;
    eventCount: number | null;
    cacheStatus: "fresh" | "stale" | "never";
  }>;
  coachContextUsage?: Array<{ key: string; hits: number; sessions: number }>;
  coachTelemetryEnabled?: boolean;
}

function fmtBytes(n: number): string {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function fmtAbs(ms: number | null | undefined): string {
  if (!ms) return "—";
  try {
    return new Date(ms).toLocaleString("en-AU", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "—";
  }
}

function fmtRelative(ms: number | null | undefined): string {
  if (!ms) return "";
  const diff = Date.now() - ms;
  if (diff < 0) return " (in the future)";
  const mins = Math.round(diff / 60000);
  if (mins < 60) return ` (${mins}m ago)`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return ` (${hours}h ago)`;
  const days = Math.round(hours / 24);
  return ` (${days}d ago)`;
}

function RecentErrorsCard() {
  const q = useQuery<RecentErrorsResponse>({ queryKey: ["/api/admin/recent-errors"] });
  const data = q.data;
  const errors = data?.errors ?? [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-baseline justify-between gap-2 flex-wrap">
          <span>Recent errors</span>
          <span className="text-xs font-normal text-muted-foreground">
            {q.isLoading
              ? "loading…"
              : `${errors.length} / ${data?.ringSize ?? 100} in ring`}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm space-y-2">
        <div className="text-xs text-muted-foreground">
          In-memory ring of the last 100 server errors. Resets when the sandbox
          restarts. No request bodies, headers, or query strings are recorded
          — only method, path, status, message, and stack.
        </div>
        {errors.length === 0 ? (
          <div className="text-xs italic text-muted-foreground">
            {q.isError ? "Failed to load recent errors." : "No errors recorded since last restart."}
          </div>
        ) : (
          <div className="space-y-2">
            {errors.slice(0, 20).map((e, idx) => (
              <details
                key={`${e.createdAt}-${idx}`}
                className="text-xs border rounded-md p-2 bg-muted/30"
                data-testid={`recent-error-${idx}`}
              >
                <summary className="cursor-pointer flex items-baseline gap-2 flex-wrap">
                  <span className="font-mono text-destructive">
                    {e.statusCode ?? "?"}
                  </span>
                  <span className="font-mono">{e.method ?? ""}</span>
                  <code className="truncate">{e.path ?? ""}</code>
                  <span className="text-muted-foreground">
                    {fmtAbs(e.createdAt)}
                  </span>
                </summary>
                <div className="mt-2 space-y-1">
                  <div className="font-medium">{e.message}</div>
                  {e.stack && (
                    <pre className="text-[10px] leading-tight whitespace-pre-wrap break-all bg-background p-2 rounded">
                      {e.stack}
                    </pre>
                  )}
                </div>
              </details>
            ))}
            {errors.length > 20 && (
              <div className="text-xs text-muted-foreground">
                Showing 20 of {errors.length}. Hit{" "}
                <code>/api/admin/recent-errors?limit=100</code> for more.
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function IcsFeedsCard({
  feeds,
}: {
  feeds: NonNullable<HealthResponse["icsFeeds"]>;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  async function copyUrl(label: string, url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(label);
      window.setTimeout(() => setCopied((c) => (c === label ? null : c)), 1500);
    } catch {
      // Some browsers block clipboard without HTTPS / user gesture; fall
      // back to selecting the text input so the user can copy manually.
      setCopied(null);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">ICS feeds</CardTitle>
      </CardHeader>
      <CardContent className="text-sm space-y-3">
        <div className="text-xs text-muted-foreground">
          These are the upstream ICS calendars Anchor reads from to populate
          the Calendar view. Anchor itself does not publish an outbound ICS
          feed — to see the same events in Apple Calendar, Outlook, or your
          phone, subscribe each device directly to the URLs below. Full URLs
          are only shown when this page is loaded with the sync secret;
          otherwise the credential portion is masked.
        </div>

        {feeds.length === 0 && (
          <div className="text-sm italic text-muted-foreground">
            No ICS feeds configured.
          </div>
        )}

        {feeds.map((f) => {
          const displayUrl = f.url ?? f.urlMasked;
          const canCopy = Boolean(f.url);
          const dotClass =
            f.cacheStatus === "fresh"
              ? "bg-emerald-500"
              : f.cacheStatus === "stale"
                ? "bg-amber-500"
                : "bg-muted-foreground";
          const cacheLabel =
            f.cacheStatus === "fresh"
              ? "fresh"
              : f.cacheStatus === "stale"
                ? "stale"
                : "not yet fetched";
          return (
            <div
              key={f.label}
              className="rounded-md border p-3 space-y-2"
              data-testid={`ics-feed-${f.label}`}
            >
              <div className="flex items-baseline justify-between gap-2 flex-wrap">
                <div className="font-medium flex items-center gap-2">
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${dotClass}`}
                    title={cacheLabel}
                  />
                  {f.label}
                </div>
                <span className="text-xs text-muted-foreground">
                  {f.eventCount === null
                    ? "— events"
                    : `${f.eventCount} event${f.eventCount === 1 ? "" : "s"}`}
                </span>
              </div>

              {!f.hasUrl ? (
                <div className="text-xs italic text-muted-foreground">
                  No URL configured. Set it in Settings.
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 flex-wrap">
                    <code
                      className="text-[11px] font-mono break-all bg-muted/40 rounded px-2 py-1 flex-1 min-w-0"
                      data-testid={`ics-url-${f.label}`}
                    >
                      {displayUrl || "(empty)"}
                    </code>
                    {canCopy ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => copyUrl(f.label, f.url!)}
                        data-testid={`copy-ics-${f.label}`}
                      >
                        {copied === f.label ? "Copied" : "Copy"}
                      </Button>
                    ) : (
                      <span
                        className="text-[11px] text-muted-foreground italic"
                        title="Reload this page with the X-Anchor-Sync-Secret header to reveal the full URL."
                      >
                        masked
                      </span>
                    )}
                  </div>

                  <div className="text-xs text-muted-foreground">
                    Last fetched: {fmtAbs(f.lastFetchedAt)}
                    {fmtRelative(f.lastFetchedAt)} — {cacheLabel}
                  </div>
                </>
              )}
            </div>
          );
        })}

        <details className="text-xs border rounded-md p-2 bg-muted/30">
          <summary className="cursor-pointer font-medium">
            Subscribe instructions (per device)
          </summary>
          <div className="mt-2 space-y-3">
            <div>
              <div className="font-medium">Apple Calendar (macOS)</div>
              <ol className="list-decimal pl-5 space-y-0.5">
                <li>Open Calendar.</li>
                <li>File → New Calendar Subscription…</li>
                <li>Paste the URL above and click Subscribe.</li>
                <li>
                  Set Auto-refresh to Every 15 minutes (or shorter) and
                  Untick Alerts and Attachments.
                </li>
              </ol>
            </div>
            <div>
              <div className="font-medium">Apple Calendar (iOS / iPadOS)</div>
              <ol className="list-decimal pl-5 space-y-0.5">
                <li>Settings → Calendar → Accounts → Add Account.</li>
                <li>Choose Other → Add Subscribed Calendar.</li>
                <li>Paste the URL into Server, then Next → Save.</li>
              </ol>
            </div>
            <div>
              <div className="font-medium">Outlook (web)</div>
              <ol className="list-decimal pl-5 space-y-0.5">
                <li>Open the Calendar view.</li>
                <li>Add calendar → Subscribe from web.</li>
                <li>Paste the URL, give it a name, choose colour → Import.</li>
              </ol>
            </div>
            <div>
              <div className="font-medium">Outlook (desktop, Windows / Mac)</div>
              <ol className="list-decimal pl-5 space-y-0.5">
                <li>Switch to the Calendar.</li>
                <li>Add Calendar → From Internet…</li>
                <li>Paste the URL and confirm.</li>
              </ol>
            </div>
            <div className="text-muted-foreground italic">
              Subscribed calendars are read-only on every platform. Refresh
              cadence is controlled by the client — typical defaults are
              every 1 to 24 hours, which can lag Anchor's own 15-minute
              cache.
            </div>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

function HealthDashboard() {
  const q = useQuery<HealthResponse>({ queryKey: ["/api/admin/health"] });
  const data = q.data;

  // Telemetry kill-switch toggle: pending state for the confirm dialog and
  // an in-flight flag so we can disable the buttons during the PATCH.
  // The dialog only opens for the disable->enable->disable flip; reading
  // is via /api/admin/health and writing via PATCH /api/settings (whitelist
  // includes coach_telemetry_enabled).
  const [telemetryDialogOpen, setTelemetryDialogOpen] = useState(false);
  const [telemetryPatching, setTelemetryPatching] = useState(false);
  const [telemetryError, setTelemetryError] = useState<string | null>(null);
  const telemetryEnabled = data?.coachTelemetryEnabled !== false; // undefined treated as enabled
  const telemetryNextValue = !telemetryEnabled;

  async function applyTelemetryToggle(nextValue: boolean) {
    setTelemetryPatching(true);
    setTelemetryError(null);
    try {
      const res = await apiRequest("PATCH", "/api/settings", {
        coach_telemetry_enabled: nextValue,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`PATCH /api/settings failed: ${res.status} ${text.slice(0, 200)}`);
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/health"] });
      setTelemetryDialogOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTelemetryError(msg);
    } finally {
      setTelemetryPatching(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted-foreground">
          Read-only ops dashboard. DB, local backups, and scheduled crons.
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            queryClient.invalidateQueries({ queryKey: ["/api/admin/health"] })
          }
        >
          <RefreshCw className="w-4 h-4 mr-1" />
          Refresh
        </Button>
      </div>

      {q.isError && (
        <Card className="border-red-300/60 bg-red-50/60 dark:bg-red-900/10">
          <CardContent className="pt-4 text-sm">
            Failed to load /api/admin/health.{" "}
            <span className="font-mono text-xs">
              {String((q.error as any)?.message ?? q.error)}
            </span>
          </CardContent>
        </Card>
      )}

      {q.isLoading && (
        <Card>
          <CardContent className="pt-4 text-sm text-muted-foreground italic">
            Loading...
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Database</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-1">
              <Row k="Path" v={<code className="text-xs">{data.db.path}</code>} />
              <Row
                k="Exists"
                v={data.db.exists ? "yes" : <span className="text-red-600">no</span>}
              />
              <Row k="Size" v={fmtBytes(data.db.sizeBytes)} />
              <Row
                k="Import endpoint"
                v={
                  data.db.importEnabled ? (
                    <span className="text-amber-700 dark:text-amber-300">
                      ENABLED — destructive writes possible
                    </span>
                  ) : (
                    "disabled (default)"
                  )
                }
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Local backups</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-1">
              <Row k="Directory" v={<code className="text-xs">{data.backups.dir}</code>} />
              <Row
                k="Readable from server"
                v={
                  data.backups.readable
                    ? "yes"
                    : <span className="text-muted-foreground">no</span>
                }
              />
              <Row k="Count" v={String(data.backups.count)} />
              <Row
                k="Last mtime"
                v={
                  <>
                    {fmtAbs(data.backups.lastLocalMtime)}
                    <span className="text-muted-foreground">
                      {fmtRelative(data.backups.lastLocalMtime)}
                    </span>
                  </>
                }
              />
              {data.backups.lastLocalPath && (
                <Row
                  k="Last path"
                  v={<code className="text-xs">{data.backups.lastLocalPath}</code>}
                />
              )}
              {data.backups.lastReceipt && (
                <>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground mt-3">
                    Last OneDrive backup
                  </div>
                  <Row
                    k="Recorded"
                    v={
                      <>
                        {fmtAbs(data.backups.lastReceipt.createdAt)}
                        <span className="text-muted-foreground">
                          {fmtRelative(data.backups.lastReceipt.createdAt)}
                        </span>
                      </>
                    }
                  />
                  <Row
                    k="OneDrive URL"
                    v={
                      <a
                        href={data.backups.lastReceipt.onedriveUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs underline break-all"
                      >
                        {data.backups.lastReceipt.onedriveUrl}
                      </a>
                    }
                  />
                  {data.backups.lastReceipt.sizeBytes != null && (
                    <Row
                      k="Size"
                      v={fmtBytes(data.backups.lastReceipt.sizeBytes)}
                    />
                  )}
                  {data.backups.lastReceipt.note && (
                    <div className="text-xs text-muted-foreground italic">
                      {data.backups.lastReceipt.note}
                    </div>
                  )}
                </>
              )}
              {!data.backups.lastReceipt && (
                <div className="text-xs text-muted-foreground italic mt-2">
                  No OneDrive backup receipt recorded yet. The cron will POST one
                  on its next successful run.
                </div>
              )}
              {data.backups.note && (
                <div className="text-xs text-muted-foreground italic mt-2">
                  {data.backups.note}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-baseline justify-between gap-2 flex-wrap">
                <span>Coach context usage (last 30 days)</span>
                <div className="flex items-center gap-2">
                  <span
                    className={
                      "text-xs font-normal " +
                      (telemetryEnabled
                        ? "text-emerald-500"
                        : "text-muted-foreground")
                    }
                  >
                    Telemetry: {telemetryEnabled ? "enabled" : "disabled"}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-xs"
                    onClick={() => {
                      setTelemetryError(null);
                      setTelemetryDialogOpen(true);
                    }}
                    disabled={telemetryPatching}
                    data-testid="toggle-coach-telemetry"
                  >
                    {telemetryEnabled ? "Disable" : "Enable"}
                  </Button>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-1">
              <div className="text-xs text-muted-foreground mb-2">
                Bundle keys the model actually referenced in plan/reflect responses.
                Higher hits = the field is doing real work. Toggle the kill switch via
                the button above (writes <code>coach_telemetry_enabled</code> to settings).
                Retention sweeps run daily at 04:30 server-local; default 90 days.
              </div>
              {data.coachContextUsage && data.coachContextUsage.length > 0 ? (
                data.coachContextUsage.map((row) => (
                  <div key={row.key} className="flex items-baseline gap-3">
                    <code className="text-xs flex-1 min-w-0 break-words">{row.key}</code>
                    <div className="text-xs text-muted-foreground tabular-nums">
                      {row.hits} hits / {row.sessions} sessions
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-xs italic text-muted-foreground">
                  {telemetryEnabled
                    ? "No rows yet. Telemetry rows appear after the next coach turn."
                    : "Disabled \u2014 no rows recorded."}
                </div>
              )}
            </CardContent>
          </Card>

          <AlertDialog open={telemetryDialogOpen} onOpenChange={setTelemetryDialogOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {telemetryNextValue ? "Enable" : "Disable"} coach telemetry?
                </AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2 text-sm">
                    <div>
                      {telemetryNextValue
                        ? "Recording of bundle-key hit counts will resume on the next coach turn."
                        : "Recording stops immediately. Existing rows remain until the next 04:30 server-local sweep removes anything past the 90-day retention window."}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      This writes <code>coach_telemetry_enabled = {String(telemetryNextValue)}</code>{" "}
                      via PATCH <code>/api/settings</code>. Reversible at any time.
                    </div>
                    {telemetryError && (
                      <div className="text-xs text-destructive" data-testid="telemetry-toggle-error">
                        {telemetryError}
                      </div>
                    )}
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={telemetryPatching}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    // Prevent radix from auto-closing before the PATCH resolves.
                    e.preventDefault();
                    void applyTelemetryToggle(telemetryNextValue);
                  }}
                  disabled={telemetryPatching}
                  data-testid="confirm-toggle-coach-telemetry"
                >
                  {telemetryPatching
                    ? "Applying…"
                    : telemetryNextValue
                      ? "Enable telemetry"
                      : "Disable telemetry"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <RecentErrorsCard />

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Scheduled crons</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-3">
              {data.crons.length === 0 && (
                <div className="text-sm italic text-muted-foreground">No crons known.</div>
              )}
              {data.crons.map((c) => {
                const hb = (data.cronHeartbeats ?? []).find(
                  (h) => h.cronId === c.id,
                );
                const hasAnomaly = !!hb?.anomalyReason;
                return (
                  <div key={c.id} className="rounded-md border p-3">
                    <div className="flex items-baseline justify-between gap-2 flex-wrap">
                      <div className="font-medium flex items-center gap-2">
                        {hasAnomaly && (
                          <span
                            className="inline-block h-2 w-2 rounded-full bg-destructive"
                            title="Last heartbeat had an anomaly"
                            data-testid={`cron-anomaly-dot-${c.id}`}
                          />
                        )}
                        {c.name}
                      </div>
                      <code className="text-xs text-muted-foreground">{c.id}</code>
                    </div>
                    <div className="text-xs mt-1">
                      Schedule: <code className="font-mono">{c.cron}</code>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">{c.note}</div>
                    {hb && (
                      <div className="text-xs mt-2 space-y-1">
                        <div className="text-muted-foreground">
                          Last heartbeat:{" "}
                          {fmtAbs(hb.createdAt ?? null)}
                          {fmtRelative(hb.createdAt ?? null)}
                        </div>
                        {hb.anomalyReason && (
                          <div
                            className="text-destructive font-mono text-[11px]"
                            data-testid={`cron-anomaly-reason-${c.id}`}
                          >
                            anomaly: {hb.anomalyReason}
                          </div>
                        )}
                      </div>
                    )}
                    {!hb && (
                      <div className="text-xs text-muted-foreground italic mt-2">
                        No heartbeat recorded yet.
                      </div>
                    )}
                  </div>
                );
              })}
              <div className="text-xs text-muted-foreground italic">
                Live run history is in the Perplexity scheduler UI — this dashboard
                only shows static cron metadata baked into the build, plus the
                most-recent heartbeat per cron.
              </div>
            </CardContent>
          </Card>

          {data.icsFeeds && (
            <IcsFeedsCard feeds={data.icsFeeds} />
          )}

          <div className="text-xs text-muted-foreground">
            Generated {fmtAbs(data.generatedAt)}
            {fmtRelative(data.generatedAt)}.
          </div>
        </>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <div className="text-xs uppercase tracking-wider text-muted-foreground w-32 shrink-0">
        {k}
      </div>
      <div className="flex-1 min-w-0 break-words">{v}</div>
    </div>
  );
}
