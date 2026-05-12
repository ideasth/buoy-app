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
import Relationships from "@/pages/Relationships";

type AdminTab = "health" | "usage" | "relationships" | "settings";

function readTabFromHash(): AdminTab {
  if (typeof window === "undefined") return "health";
  const hash = window.location.hash || "";
  const qIdx = hash.indexOf("?");
  if (qIdx < 0) return "health";
  const params = new URLSearchParams(hash.slice(qIdx + 1));
  const t = params.get("tab");
  if (
    t === "usage" ||
    t === "settings" ||
    t === "relationships" ||
    t === "health"
  )
    return t;
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
          <TabsTrigger value="relationships" data-testid="tab-relationships">
            Relationships
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

        <TabsContent value="relationships" className="mt-4">
          {/* Stage 14b — CRUD for the relationships table. */}
          <Relationships />
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
    lastReceipt: {
      id: number;
      onedriveUrl: string;
      mtime: number | null;
      sizeBytes: number | null;
      note: string | null;
      createdAt: number;
    } | null;
    recent: Array<{
      id: number;
      onedriveUrl: string;
      mtime: number | null;
      sizeBytes: number | null;
      note: string | null;
      createdAt: number;
    }>;
    note: string | null;
  };
  perplexityCrons: Array<{
    id: string;
    name: string;
    cron: string;
    note: string;
  }>;
  systemdTimers: Array<{
    name: string;
    schedule: string;
    description: string;
  }>;
  cronHeartbeats?: Array<{
    cronId: string;
    ranAt: number | null;
    anomalyReason: string | null;
    createdAt: number | null;
  }>;
  icsFeeds?: Array<{
    label: string;
    // Stage 12c: the raw URL is no longer returned from /api/admin/health
    // even when the request authed via X-Anchor-Sync-Secret. The user
    // maintains the URLs in Settings; the masked URL is enough for the
    // dashboard cache-status display.
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
  // Tolerate small clock skew between server and client — a ~2-minute
  // negative diff is almost certainly clock drift, not a real future
  // timestamp. Only show "in the future" when the value is more than
  // 2 minutes ahead of the client clock.
  if (diff < -2 * 60 * 1000) return " (in the future)";
  if (diff < 0) return " (just now)";
  const mins = Math.round(diff / 60000);
  if (mins < 1) return " (just now)";
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

// Published ICS feeds the user can subscribe to from any calendar app.
// These are stable GitHub raw URLs from the cal-07ec8bc0 publish repo —
// no credentials, no JWT, no expiry. Add new feeds by appending here.
const PUBLISHED_FEEDS: Array<{
  label: string;
  url: string;
  description: string;
}> = [
  {
    label: "Oliver — Work",
    url: "https://raw.githubusercontent.com/ideasth/cal-07ec8bc0/main/Oliver-Work.ics",
    description: "Sandy / Elgin / Peninsula clinics, on-call, travel, medicolegal.",
  },
  {
    label: "Oliver — Personal",
    url: "https://raw.githubusercontent.com/ideasth/cal-07ec8bc0/main/Oliver-Personal.ics",
    description: "Personal (non-work): GP, dental, gym, errands, etc.",
  },
  {
    label: "Family",
    url: "https://raw.githubusercontent.com/ideasth/cal-07ec8bc0/main/Family-Group.ics",
    description:
      "Kids rotation, school terms, holidays, kids' activities, couple time.",
  },
  {
    label: "Marieke — Art",
    url: "https://raw.githubusercontent.com/ideasth/cal-07ec8bc0/main/Marieke-Art.ics",
    description:
      "Art class, studio time, and Wallan artist-in-residence dates.",
  },
  {
    label: "Marieke — Personal",
    url: "https://raw.githubusercontent.com/ideasth/cal-07ec8bc0/main/Marieke-Personal.ics",
    description: "Events from Marieke's iCloud calendar feed.",
  },
  {
    label: "Master (everything in one)",
    url: "https://raw.githubusercontent.com/ideasth/cal-07ec8bc0/main/Oliver-Daly-MASTER.ics",
    description: "All of the above merged into a single subscribable feed.",
  },
];

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
      <CardContent className="text-sm space-y-4">
        <div className="text-xs text-muted-foreground">
          Two parts: the upstream feeds Buoy reads to populate its own
          Calendar view, and the published per-category feeds you can
          subscribe to from Apple Calendar, Outlook, or your phone.
        </div>

        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Upstream feeds (Buoy reads these)
        </div>
        <div className="text-xs text-muted-foreground -mt-3">
          The credential portion of the URL is always masked here. Manage the
          raw URLs in Settings.
        </div>

        {feeds.length === 0 && (
          <div className="text-sm italic text-muted-foreground">
            No ICS feeds configured.
          </div>
        )}

        {feeds.map((f) => {
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
                      {f.urlMasked || "(empty)"}
                    </code>
                    <span
                      className="text-[11px] text-muted-foreground italic"
                      title="The credential portion of the URL is masked here. Manage the raw URL in Settings."
                    >
                      masked
                    </span>
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

        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pt-2">
          Subscribe to your calendars
        </div>
        <div className="text-xs text-muted-foreground -mt-3">
          Stable GitHub raw URLs — no credentials, no expiry. Subscribe
          your phone, iPad, or Mac to any of these to mirror Buoy's
          calendar data into your native calendar app.
        </div>

        {PUBLISHED_FEEDS.map((f) => (
          <div
            key={f.label}
            className="rounded-md border p-3 space-y-2"
            data-testid={`published-feed-${f.label}`}
          >
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
              <div className="font-medium">{f.label}</div>
              <a
                href={f.url}
                className="text-xs underline text-muted-foreground hover:text-foreground"
                target="_blank"
                rel="noopener noreferrer"
                data-testid={`published-feed-link-${f.label}`}
              >
                {f.url.split("/").pop()}
              </a>
            </div>
            <div className="text-xs text-muted-foreground">
              {f.description}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <code
                className="text-[11px] font-mono break-all bg-muted/40 rounded px-2 py-1 flex-1 min-w-0"
                data-testid={`published-url-${f.label}`}
              >
                {f.url}
              </code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => copyUrl(`pub:${f.label}`, f.url)}
                data-testid={`copy-published-${f.label}`}
              >
                {copied === `pub:${f.label}` ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
        ))}

        <details className="text-xs border rounded-md p-2 bg-muted/30">
          <summary className="cursor-pointer font-medium">
            Setup — iPhone / iPad
          </summary>
          <ol className="list-decimal pl-5 space-y-0.5 mt-2">
            <li>
              Settings → Calendar → Accounts → Add Account → Other →
              Add Subscribed Calendar.
            </li>
            <li>
              Long-press one of the URLs above on your phone and choose
              Copy. Paste it into the Server field.
            </li>
            <li>Tap Next → Save. Repeat for each calendar you want.</li>
            <li>
              In the Calendar app, tick the new calendars under
              “Subscribed”.
            </li>
          </ol>
        </details>

        <details className="text-xs border rounded-md p-2 bg-muted/30">
          <summary className="cursor-pointer font-medium">
            Setup — Mac
          </summary>
          <ol className="list-decimal pl-5 space-y-0.5 mt-2">
            <li>Calendar app → File → New Calendar Subscription…</li>
            <li>Paste a URL → Subscribe.</li>
            <li>Set Auto-refresh to “Every hour”.</li>
            <li>Untick Alerts and Attachments. Repeat for each URL.</li>
          </ol>
        </details>

        <details className="text-xs border rounded-md p-2 bg-muted/30">
          <summary className="cursor-pointer font-medium">
            Setup — Outlook (web and desktop)
          </summary>
          <div className="mt-2 space-y-3">
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
              every 1 to 24 hours, which can lag Buoy's own 15-minute
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
          Read-only ops dashboard. DB, OneDrive backups, Perplexity crons, and wmu systemd timers.
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
              <CardTitle className="text-base">OneDrive backups</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-1">
              {data.backups.lastReceipt ? (
                <>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">
                    Last backup
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
                      <code className="text-xs break-all">
                        {data.backups.lastReceipt.onedriveUrl}
                      </code>
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
              ) : (
                <div className="text-xs text-muted-foreground italic">
                  No OneDrive backup receipt recorded yet. The systemd timer
                  on wmu will POST one on its next successful run.
                </div>
              )}

              {data.backups.recent.length > 1 && (
                <>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground mt-3">
                    Last {data.backups.recent.length} backups
                  </div>
                  <div className="space-y-1">
                    {data.backups.recent.map((r) => (
                      <div
                        key={r.id}
                        className="text-xs flex items-baseline gap-3 flex-wrap"
                        data-testid={`backup-receipt-${r.id}`}
                      >
                        <span className="tabular-nums text-muted-foreground w-44 shrink-0">
                          {fmtAbs(r.createdAt)}
                        </span>
                        <code className="text-[11px] flex-1 min-w-0 break-all">
                          {r.onedriveUrl}
                        </code>
                        {r.sizeBytes != null && (
                          <span className="text-muted-foreground tabular-nums">
                            {fmtBytes(r.sizeBytes)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </>
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
              <CardTitle className="text-base">Perplexity crons</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-3">
              {data.perplexityCrons.length === 0 && (
                <div className="text-sm italic text-muted-foreground">No crons known.</div>
              )}
              {data.perplexityCrons.map((c) => {
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
                      Schedule (UTC): <code className="font-mono">{c.cron}</code>
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

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">VPS systemd timers (wmu)</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-3">
              <div className="text-xs text-muted-foreground">
                These six timers replaced the corresponding Perplexity crons
                during the Stage 12b migration. Schedules are Melbourne local
                time — systemd handles the AEDT cutover automatically.
                Run <code>systemctl list-timers anchor-*</code> on wmu to see
                live state.
              </div>
              {data.systemdTimers.length === 0 && (
                <div className="text-sm italic text-muted-foreground">No timers known.</div>
              )}
              {data.systemdTimers.map((t) => (
                <div key={t.name} className="rounded-md border p-3">
                  <div className="flex items-baseline justify-between gap-2 flex-wrap">
                    <code className="font-medium text-xs">{t.name}</code>
                    <span className="text-xs text-muted-foreground">{t.schedule}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">{t.description}</div>
                </div>
              ))}
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
