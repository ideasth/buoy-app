// /admin — read-only ops dashboard.
//
// Renders /api/admin/health: DB size + import flag, local backup directory
// state, and the static cron manifest. Refresh button re-fetches.

import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { queryClient } from "@/lib/queryClient";
import { RefreshCw } from "lucide-react";

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
    note: string | null;
  };
  crons: Array<{
    id: string;
    name: string;
    cron: string;
    note: string;
  }>;
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

export default function Admin() {
  const q = useQuery<HealthResponse>({ queryKey: ["/api/admin/health"] });

  const data = q.data;

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Admin</h1>
          <p className="text-sm text-muted-foreground">
            Read-only ops dashboard. DB, local backups, and scheduled crons.
          </p>
        </div>
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
              {data.backups.note && (
                <div className="text-xs text-muted-foreground italic mt-2">
                  {data.backups.note}
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
