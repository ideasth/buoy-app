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
import { queryClient } from "@/lib/queryClient";
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

function HealthDashboard() {
  const q = useQuery<HealthResponse>({ queryKey: ["/api/admin/health"] });
  const data = q.data;

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
                <span
                  className={
                    "text-xs font-normal " +
                    (data.coachTelemetryEnabled === false
                      ? "text-muted-foreground"
                      : "text-emerald-500")
                  }
                >
                  Telemetry: {data.coachTelemetryEnabled === false ? "disabled" : "enabled"}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-1">
              <div className="text-xs text-muted-foreground mb-2">
                Bundle keys the model actually referenced in plan/reflect responses.
                Higher hits = the field is doing real work. Toggle the kill switch via
                Settings (<code>coach_telemetry_enabled</code>). Retention sweeps run
                daily at 04:30 server-local; default 90 days.
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
                  {data.coachTelemetryEnabled === false
                    ? "Disabled \u2014 no rows recorded."
                    : "No rows yet. Telemetry rows appear after the next coach turn."}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Scheduled crons</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-3">
              {data.crons.length === 0 && (
                <div className="text-sm italic text-muted-foreground">No crons known.</div>
              )}
              {data.crons.map((c) => (
                <div key={c.id} className="rounded-md border p-3">
                  <div className="flex items-baseline justify-between gap-2 flex-wrap">
                    <div className="font-medium">{c.name}</div>
                    <code className="text-xs text-muted-foreground">{c.id}</code>
                  </div>
                  <div className="text-xs mt-1">
                    Schedule: <code className="font-mono">{c.cron}</code>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">{c.note}</div>
                </div>
              ))}
              <div className="text-xs text-muted-foreground italic">
                Live run history is in the Perplexity scheduler UI — this dashboard
                only shows static cron metadata baked into the build.
              </div>
            </CardContent>
          </Card>

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
