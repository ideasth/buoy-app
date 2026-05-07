import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import type { Project } from "@shared/schema";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, FolderKanban } from "lucide-react";
import { cn } from "@/lib/utils";

type ProjectWithNext = Project & {
  nextAction: {
    id: number;
    title: string;
    deadline: string | null;
    phaseName: string | null;
    componentName: string | null;
  } | null;
};

function fmtDeadline(s: string | null): string {
  if (!s) return "";
  // Accept either ISO datetime or date-only
  try {
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      return new Intl.DateTimeFormat("en-AU", {
        timeZone: "Australia/Melbourne",
        day: "2-digit",
        month: "short",
      }).format(d);
    }
  } catch {}
  return s;
}

function priorityBucket(p: ProjectWithNext): number {
  if (p.status === "parked") return 3;
  if (p.priority === "high") return 0;
  return 1;
}

export default function Projects() {
  const q = useQuery<ProjectWithNext[]>({
    queryKey: ["/api/projects"],
    queryFn: async () => (await apiRequest("GET", "/api/projects")).json(),
  });

  const sorted = useMemo(() => {
    const list = [...(q.data ?? [])];
    list.sort((a, b) => {
      const d = priorityBucket(a) - priorityBucket(b);
      if (d !== 0) return d;
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [q.data]);

  const groups: { key: string; label: string; items: ProjectWithNext[] }[] = [
    { key: "high", label: "Active · High", items: sorted.filter((p) => p.status === "active" && p.priority === "high") },
    { key: "low", label: "Active · Low", items: sorted.filter((p) => p.status === "active" && p.priority !== "high") },
    { key: "parked", label: "Parked", items: sorted.filter((p) => p.status === "parked") },
  ];

  return (
    <div className="px-5 md:px-8 py-8 md:py-10 space-y-8">
      <header>
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Projects</div>
        <h1 className="text-2xl font-semibold mt-1">Active and parked.</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Synced from Microsoft To Do lists ending in <code className="text-xs">: Active</code> or <code className="text-xs">: Parked</code>. New imports start as Active-Low — promote here.
        </p>
      </header>

      {q.isLoading && (
        <div className="text-sm text-muted-foreground">Loading…</div>
      )}

      {!q.isLoading && sorted.length === 0 && (
        <div className="text-sm text-muted-foreground italic rounded-lg border border-dashed border-border p-8 text-center">
          <FolderKanban className="h-5 w-5 mx-auto mb-2 opacity-50" />
          No projects yet. The 6-hourly sync will populate from MS To Do.
        </div>
      )}

      {groups.map((g) =>
        g.items.length === 0 ? null : (
          <section key={g.key} className="space-y-3">
            <div className="flex items-baseline gap-2">
              <h2 className="text-base font-semibold">{g.label}</h2>
              <span className="text-xs text-muted-foreground">{g.items.length}</span>
            </div>
            <div className="rounded-lg border border-border bg-card divide-y divide-border">
              {g.items.map((p) => (
                <Link
                  key={p.id}
                  href={`/projects/${p.id}`}
                  className="block px-4 py-3 hover-elevate active-elevate-2"
                  data-testid={`project-row-${p.id}`}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="font-medium truncate">{p.name}</div>
                        <Badge
                          variant={p.priority === "high" ? "default" : "outline"}
                          className={cn(
                            "text-[10px] py-0 h-4",
                            p.status === "parked" && "opacity-60",
                          )}
                        >
                          {p.status === "parked" ? "parked" : p.priority === "high" ? "high" : "low"}
                        </Badge>
                      </div>
                      {p.nextAction ? (
                        <div className="text-xs text-muted-foreground mt-1 flex flex-wrap items-center gap-1.5">
                          <span className="text-foreground">Next:</span>
                          <span className="truncate max-w-[420px]">{p.nextAction.title}</span>
                          {p.nextAction.phaseName && (
                            <Badge variant="outline" className="text-[10px] py-0 h-4">
                              {p.nextAction.phaseName}
                            </Badge>
                          )}
                          {p.nextAction.componentName && (
                            <Badge variant="outline" className="text-[10px] py-0 h-4">
                              {p.nextAction.componentName}
                            </Badge>
                          )}
                          {p.nextAction.deadline && (
                            <span className="text-[11px]">· due {fmtDeadline(p.nextAction.deadline)}</span>
                          )}
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground mt-1 italic">
                          No Next Action set
                        </div>
                      )}
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ),
      )}
    </div>
  );
}
