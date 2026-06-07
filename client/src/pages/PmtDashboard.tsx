// filepath: client/src/pages/PmtDashboard.tsx
// Stage 20 — PMT governance status register dashboard.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ---- Types mirroring server/pmt-dashboard.ts ----

interface PmtItem {
  id: number;
  name: string;
  kind: string | null;
  parentId: number | null;
  pmtLabel: string | null;
  pmtStatus: string | null;
  nextAction: string | null;
  fileStatus: string | null;
  latestThreadUrl: string | null;
  pmtNotes: string | null;
  seedKey: string | null;
}

interface LabeledProjectEntry {
  project: PmtItem;
  subProjects: PmtItem[];
  issues: PmtItem[];
}

interface LabelGroup {
  label: string;
  items: LabeledProjectEntry[];
  orphanIssues: PmtItem[];
  statusCounts: Record<string, number>;
  fileStatusCounts: Record<string, number>;
}

interface DashboardTotals {
  open: number;
  active: number;
  complete: number;
  parked: number;
  needsFiles: number;
  partial: number;
  present: number;
  total: number;
}

interface DashboardData {
  labels: LabelGroup[];
  totals: DashboardTotals;
}

// ---- Helpers ----

type FileStatusFilter = "all" | "needs files" | "partial" | "present";

function fileStatusBadge(fs: string | null) {
  if (!fs) return null;
  if (fs === "needs files")
    return <Badge variant="destructive" className="text-xs">needs files</Badge>;
  if (fs === "partial")
    return (
      <Badge
        variant="outline"
        className="text-xs border-amber-500 text-amber-700 dark:text-amber-400"
      >
        partial
      </Badge>
    );
  if (fs === "present")
    return (
      <Badge
        variant="outline"
        className="text-xs border-green-600 text-green-700 dark:text-green-400"
      >
        present
      </Badge>
    );
  return <Badge variant="outline" className="text-xs">{fs}</Badge>;
}

function pmtStatusBadge(ps: string | null) {
  if (!ps) return null;
  const variantMap: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
    Active: "default",
    Open: "secondary",
    Complete: "outline",
    Parked: "outline",
  };
  return (
    <Badge variant={variantMap[ps] ?? "outline"} className="text-xs">
      {ps}
    </Badge>
  );
}

function kindLabel(kind: string | null) {
  if (kind === "sub-project") return "Sub-project";
  if (kind === "issue") return "Issue";
  return "Project";
}

function matchesFilter(item: PmtItem, filter: FileStatusFilter): boolean {
  if (filter === "all") return true;
  return (item.fileStatus ?? "") === filter;
}

// ---- Task creation affordance ----

function AddTaskButton({ item, onCreated }: { item: PmtItem; onCreated: () => void }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      await apiRequest("POST", `/api/projects/${item.id}/tasks`, {
        title: `Update file space for: ${item.name}`,
      });
      toast({ title: "Task created", description: `"Update file space for: ${item.name}"` });
      onCreated();
    } catch {
      toast({ title: "Failed to create task", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
      onClick={handleClick}
      disabled={loading}
    >
      + task
    </Button>
  );
}

// ---- Row renderers ----

function ItemRow({
  item,
  indent = 0,
  onTaskCreated,
}: {
  item: PmtItem;
  indent?: number;
  onTaskCreated: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 py-2 border-b border-border last:border-0",
        indent === 1 && "pl-6",
        indent === 2 && "pl-12",
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <Link
            href={`/projects/${item.id}`}
            className="text-sm font-medium hover:underline"
          >
            {item.name}
          </Link>
          <span className="text-xs text-muted-foreground hidden sm:inline">
            ({kindLabel(item.kind)})
          </span>
          {pmtStatusBadge(item.pmtStatus)}
          {fileStatusBadge(item.fileStatus)}
        </div>
        {item.nextAction && (
          <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
            {item.nextAction}
          </p>
        )}
        {item.latestThreadUrl && (
          <a
            href={item.latestThreadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline mt-0.5 inline-block"
          >
            Thread
          </a>
        )}
      </div>
      <div className="flex-shrink-0 flex items-center gap-1">
        <AddTaskButton item={item} onCreated={onTaskCreated} />
      </div>
    </div>
  );
}

// ---- Label group ----

function LabelSection({
  group,
  filter,
  onTaskCreated,
}: {
  group: LabelGroup;
  filter: FileStatusFilter;
  onTaskCreated: () => void;
}) {
  // Flatten all items to get a count of those that pass the filter.
  const allItems: PmtItem[] = [
    ...group.orphanIssues,
    ...group.items.flatMap((e) => [e.project, ...e.subProjects, ...e.issues]),
  ];
  const filteredCount = allItems.filter((i) => matchesFilter(i, filter)).length;

  if (filter !== "all" && filteredCount === 0) return null;

  return (
    <section className="rounded-lg border border-card-border bg-card">
      <div className="px-4 py-3 border-b border-border flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold">{group.label}</h2>
        <span className="text-xs text-muted-foreground">{allItems.length} items</span>
        <div className="flex flex-wrap gap-1 ml-auto">
          {Object.entries(group.statusCounts).map(([s, n]) => (
            <span key={s} className="text-xs text-muted-foreground">
              {s}: {n}
            </span>
          ))}
        </div>
      </div>
      <div className="divide-y divide-border px-4">
        {/* Orphan issues rendered first */}
        {group.orphanIssues
          .filter((i) => matchesFilter(i, filter))
          .map((issue) => (
            <ItemRow key={issue.id} item={issue} indent={0} onTaskCreated={onTaskCreated} />
          ))}
        {/* Projects + nested sub-projects + nested issues */}
        {group.items
          .filter(
            (entry) =>
              filter === "all" ||
              matchesFilter(entry.project, filter) ||
              entry.subProjects.some((sp) => matchesFilter(sp, filter)) ||
              entry.issues.some((iss) => matchesFilter(iss, filter)),
          )
          .map((entry) => (
            <div key={entry.project.id}>
              {(filter === "all" || matchesFilter(entry.project, filter)) && (
                <ItemRow item={entry.project} indent={0} onTaskCreated={onTaskCreated} />
              )}
              {entry.subProjects
                .filter((sp) => matchesFilter(sp, filter))
                .map((sp) => (
                  <ItemRow key={sp.id} item={sp} indent={1} onTaskCreated={onTaskCreated} />
                ))}
              {entry.issues
                .filter((iss) => matchesFilter(iss, filter))
                .map((iss) => (
                  <ItemRow key={iss.id} item={iss} indent={1} onTaskCreated={onTaskCreated} />
                ))}
            </div>
          ))}
      </div>
    </section>
  );
}

// ---- Main page ----

export default function PmtDashboard() {
  const [filter, setFilter] = useState<FileStatusFilter>("all");
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery<DashboardData>({
    queryKey: ["/api/pmt/dashboard"],
    queryFn: async () => (await apiRequest("GET", "/api/pmt/dashboard")).json(),
  });

  function handleTaskCreated() {
    queryClient.invalidateQueries({ queryKey: ["/api/pmt/dashboard"] });
  }

  const FILTERS: { key: FileStatusFilter; label: string }[] = [
    { key: "all", label: "All file statuses" },
    { key: "needs files", label: "Needs files" },
    { key: "partial", label: "Partial" },
    { key: "present", label: "Present" },
  ];

  return (
    <div className="px-5 md:px-8 py-8 md:py-10 space-y-8">
      <header>
        <div className="text-xs uppercase tracking-wider text-muted-foreground">PMT</div>
        <h1 className="text-2xl font-semibold mt-1">PMT — governance status register</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Label &gt; Project &gt; Sub-project &gt; Issue. Live tracker in Buoy; markdown mirror in
          the Life Management Space (PMT_STATUS_REGISTER.md).
        </p>
      </header>

      {/* Totals summary */}
      {data?.totals && (
        <Card>
          <CardContent className="pt-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Status</div>
                <div className="mt-1 space-y-0.5">
                  <div>Open: <span className="font-medium">{data.totals.open}</span></div>
                  <div>Active: <span className="font-medium">{data.totals.active}</span></div>
                  <div>Complete: <span className="font-medium">{data.totals.complete}</span></div>
                  <div>Parked: <span className="font-medium">{data.totals.parked}</span></div>
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Files</div>
                <div className="mt-1 space-y-0.5">
                  <div className="text-destructive">Needs files: <span className="font-medium">{data.totals.needsFiles}</span></div>
                  <div className="text-amber-700 dark:text-amber-400">Partial: <span className="font-medium">{data.totals.partial}</span></div>
                  <div className="text-green-700 dark:text-green-400">Present: <span className="font-medium">{data.totals.present}</span></div>
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Total</div>
                <div className="mt-1 text-2xl font-semibold">{data.totals.total}</div>
                <div className="text-xs text-muted-foreground">tracked items</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filter chip row */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={cn(
              "px-3 py-1 rounded-full text-xs border transition-colors",
              filter === key
                ? "bg-foreground text-background border-foreground"
                : "bg-transparent text-muted-foreground border-border hover:border-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading && (
        <div className="text-sm text-muted-foreground italic">Loading…</div>
      )}
      {isError && (
        <div className="text-sm text-destructive">Failed to load dashboard.</div>
      )}
      {data && (
        <div className="space-y-6">
          {data.labels.map((group) => (
            <LabelSection
              key={group.label}
              group={group}
              filter={filter}
              onTaskCreated={handleTaskCreated}
            />
          ))}
          {data.labels.length === 0 && (
            <p className="text-sm text-muted-foreground">No PMT items found.</p>
          )}
        </div>
      )}
    </div>
  );
}
