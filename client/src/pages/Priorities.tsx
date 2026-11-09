// Stage 17c — Tasks/Priorities page.
//
// Page formerly known as /priorities. Now lives at /tasks (with /priorities
// redirecting for back-compat). Combines the existing top-three picker
// (unchanged) with a full task search/edit table below it.
//
// Features:
//   - Top-three slots and domain-grouped triage list (preserved verbatim)
//   - Search box matching title + notes + tag
//   - Filter chips: Domain, Status, Priority, Project (tag), include done/dropped
//   - Quick row toggles: status checkbox, project tag chip, "..." -> details drawer
//   - Details drawer: full edit form (title, status, priority, domain,
//     estimate, due date, notes, tag) + delete
//   - Tag typeahead suggests existing distinct tag values (case-insensitive,
//     deduped) with free-text "create new" for new projects.

import { useQuery } from "@tanstack/react-query";
import type { Task, TopThree } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { FileToProjectCard } from "@/components/FileToProjectCard";
import {
  domainLabel,
  todayDateStr,
  fmtDuration,
  DOMAIN_OPTIONS,
  PRIORITY_OPTIONS,
} from "@/lib/anchor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  ArrowDown,
  ArrowUp,
  Target,
  X,
  Check,
  Search,
  MoreHorizontal,
  Trash2,
  Tag as TagIcon,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useMemo, useState, useEffect } from "react";
import { cn } from "@/lib/utils";

const DOMAIN_GROUPS = [
  { key: "family", title: "Family first", subtitle: "Hilde · Axel · Marieke" },
  { key: "work", title: "Clinical work" },
  { key: "medicolegal", title: "Medicolegal" },
  { key: "health", title: "Health" },
  { key: "personal", title: "Personal" },
];

const STATUS_OPTIONS = [
  { value: "todo", label: "To do" },
  { value: "doing", label: "Doing" },
  { value: "done", label: "Done" },
  { value: "dropped", label: "Dropped" },
] as const;

type StatusValue = (typeof STATUS_OPTIONS)[number]["value"];

function statusLabel(s: string) {
  return STATUS_OPTIONS.find((x) => x.value === s)?.label ?? s;
}

// ---------- Tag (project) typeahead ----------
// Used in the details drawer and inline tag editor. Shows distinct existing
// tag values pulled from the current /api/tasks data, case-insensitive
// deduped. Lets the user type free-text to "create" a new project tag.
function TagTypeahead({
  value,
  onChange,
  allTags,
  testId,
}: {
  value: string;
  onChange: (next: string) => void;
  allTags: string[];
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  const lower = draft.trim().toLowerCase();
  const suggestions = useMemo(() => {
    if (!lower) return allTags.slice(0, 8);
    return allTags
      .filter((t) => t.toLowerCase().includes(lower))
      .slice(0, 8);
  }, [allTags, lower]);

  const showCreate =
    !!lower && !allTags.some((t) => t.toLowerCase() === lower);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 max-w-[180px] truncate font-normal"
          data-testid={testId}
        >
          <TagIcon className="h-3 w-3 mr-1 shrink-0" />
          <span className="truncate">{value ? value : "Add project"}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="start">
        <Input
          autoFocus
          placeholder="Search or create project…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="h-8"
          data-testid="tag-typeahead-input"
        />
        <div className="mt-2 max-h-56 overflow-y-auto space-y-1">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              className="w-full text-left text-sm rounded px-2 py-1 hover:bg-muted"
              onClick={() => {
                onChange(s);
                setOpen(false);
              }}
              data-testid={`tag-suggestion-${s}`}
            >
              {s}
            </button>
          ))}
          {showCreate && (
            <button
              type="button"
              className="w-full text-left text-sm rounded px-2 py-1 hover:bg-muted text-primary"
              onClick={() => {
                onChange(draft.trim());
                setOpen(false);
              }}
              data-testid="tag-create-new"
            >
              + Create “{draft.trim()}”
            </button>
          )}
          {value && (
            <button
              type="button"
              className="w-full text-left text-sm rounded px-2 py-1 hover:bg-muted text-muted-foreground"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
              data-testid="tag-clear"
            >
              Clear project
            </button>
          )}
          {suggestions.length === 0 && !showCreate && !value && (
            <div className="text-xs text-muted-foreground px-2 py-1 italic">
              No projects yet. Type to create one.
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ---------- Details drawer ----------
// Slide-in side panel with full edit form for a single task. Saves on
// blur for free-text fields, immediately for selects. Delete button at
// the bottom.
function TaskDetailsDrawer({
  task,
  open,
  onClose,
  allTags,
}: {
  task: Task | null;
  open: boolean;
  onClose: () => void;
  allTags: string[];
}) {
  const { toast } = useToast();
  const [local, setLocal] = useState<Task | null>(task);
  useEffect(() => {
    setLocal(task);
  }, [task]);

  if (!task || !local) return null;

  const patch = async (body: Partial<Task>) => {
    await apiRequest("PATCH", `/api/tasks/${task.id}`, body);
    queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
  };

  const remove = async () => {
    if (!confirm("Delete this task? This can't be undone.")) return;
    await apiRequest("DELETE", `/api/tasks/${task.id}`);
    queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
    toast({ title: "Task deleted" });
    onClose();
  };

  const dueLocal = local.dueAt
    ? new Date(local.dueAt).toISOString().slice(0, 16)
    : "";

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md overflow-y-auto"
        data-testid="task-details-drawer"
      >
        <SheetHeader>
          <SheetTitle>Edit task</SheetTitle>
          <SheetDescription>Update any field. Saves immediately.</SheetDescription>
        </SheetHeader>
        <div className="mt-6 space-y-4">
          {(task.tag ?? "").toLowerCase() === "check" && (task.status === "todo" || task.status === "doing") && (
            <FileToProjectCard taskId={task.id} onFiled={onClose} />
          )}
          <div className="space-y-1.5">
            <Label htmlFor="task-title">Title</Label>
            <Input
              id="task-title"
              data-testid="drawer-title"
              value={local.title}
              onChange={(e) => setLocal({ ...local, title: e.target.value })}
              onBlur={() => {
                if (local.title !== task.title) patch({ title: local.title });
              }}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select
                value={local.status}
                onValueChange={(v) => {
                  setLocal({ ...local, status: v });
                  patch({ status: v });
                }}
              >
                <SelectTrigger data-testid="drawer-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select
                value={local.priority}
                onValueChange={(v) => {
                  setLocal({ ...local, priority: v });
                  patch({ priority: v });
                }}
              >
                <SelectTrigger data-testid="drawer-priority"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Domain</Label>
              <Select
                value={local.domain}
                onValueChange={(v) => {
                  setLocal({ ...local, domain: v });
                  patch({ domain: v });
                }}
              >
                <SelectTrigger data-testid="drawer-domain"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DOMAIN_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="task-estimate">Estimate (min)</Label>
              <Input
                id="task-estimate"
                data-testid="drawer-estimate"
                type="number"
                min={0}
                value={local.estimateMinutes}
                onChange={(e) =>
                  setLocal({ ...local, estimateMinutes: Number(e.target.value) || 0 })
                }
                onBlur={() => {
                  if (local.estimateMinutes !== task.estimateMinutes) {
                    patch({ estimateMinutes: local.estimateMinutes });
                  }
                }}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="task-due">Due</Label>
            <Input
              id="task-due"
              data-testid="drawer-due"
              type="datetime-local"
              value={dueLocal}
              onChange={(e) => {
                const v = e.target.value;
                const ms = v ? new Date(v).getTime() : null;
                setLocal({ ...local, dueAt: ms });
                patch({ dueAt: ms });
              }}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Project</Label>
            <div>
              <TagTypeahead
                value={local.tag ?? ""}
                onChange={(next) => {
                  setLocal({ ...local, tag: next || null });
                  patch({ tag: next || null });
                }}
                allTags={allTags}
                testId="drawer-tag"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="task-notes">Notes</Label>
            <Textarea
              id="task-notes"
              data-testid="drawer-notes"
              value={local.notes ?? ""}
              rows={5}
              onChange={(e) => setLocal({ ...local, notes: e.target.value })}
              onBlur={() => {
                if ((local.notes ?? "") !== (task.notes ?? "")) {
                  patch({ notes: local.notes ?? "" });
                }
              }}
            />
          </div>

          <div className="pt-4 border-t border-border">
            <Button
              variant="destructive"
              onClick={remove}
              data-testid="drawer-delete"
              className="w-full"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete task
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function Priorities() {
  const date = todayDateStr();
  const tasksQ = useQuery<Task[]>({ queryKey: ["/api/tasks"] });
  const topQ = useQuery<TopThree>({
    queryKey: ["/api/top-three", date],
    queryFn: async () => (await apiRequest("GET", `/api/top-three?date=${date}`)).json(),
  });
  const { toast } = useToast();
  const [order, setOrder] = useState<number[] | null>(null);

  // --- Search + filter state for the task table ---
  const [searchText, setSearchText] = useState("");
  const [filterDomain, setFilterDomain] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("open"); // "open" = todo|doing
  const [filterPriority, setFilterPriority] = useState<string>("all");
  const [filterTag, setFilterTag] = useState<string>("all");
  const [drawerTaskId, setDrawerTaskId] = useState<number | null>(null);

  const allTasks = tasksQ.data ?? [];

  // Distinct tag values across all tasks (case-insensitive dedup, preserves
  // first-seen casing). Used for filter chip + typeahead suggestions.
  const allTags = useMemo(() => {
    const seen = new Map<string, string>();
    for (const t of allTasks) {
      const tag = (t.tag ?? "").trim();
      if (!tag) continue;
      const key = tag.toLowerCase();
      if (!seen.has(key)) seen.set(key, tag);
    }
    return Array.from(seen.values()).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  }, [allTasks]);

  // --- Top three slot logic (unchanged from previous Priorities) ---
  const open = useMemo(
    () => allTasks.filter((t) => t.status === "todo" || t.status === "doing"),
    [allTasks],
  );
  const initial = useMemo(() => open.map((t) => t.id), [open]);
  const ids = order ?? initial;
  const tasksById = useMemo(() => {
    const m = new Map<number, Task>();
    for (const t of allTasks) m.set(t.id, t);
    return m;
  }, [allTasks]);
  const ordered = ids.map((id) => tasksById.get(id)).filter((t): t is Task => !!t);

  const move = (idx: number, dir: -1 | 1) => {
    const next = [...ids];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    setOrder(next);
  };

  const setSlot = async (taskId: number, slot: 1 | 2 | 3) => {
    const cur = topQ.data ?? { taskId1: null, taskId2: null, taskId3: null };
    const next: any = {
      taskId1: cur.taskId1,
      taskId2: cur.taskId2,
      taskId3: cur.taskId3,
    };
    for (const k of ["taskId1", "taskId2", "taskId3"] as const) {
      if (next[k] === taskId) next[k] = null;
    }
    next[`taskId${slot}`] = taskId;
    await apiRequest("PUT", "/api/top-three", { date, ...next });
    queryClient.invalidateQueries({ queryKey: ["/api/top-three", date] });
    toast({ title: `Set as #${slot}` });
  };

  const drop = async (id: number) => {
    await apiRequest("PATCH", `/api/tasks/${id}`, { status: "dropped" });
    queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
  };
  const done = async (id: number) => {
    await apiRequest("PATCH", `/api/tasks/${id}`, { status: "done" });
    queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
  };
  const setStatus = async (id: number, status: StatusValue) => {
    await apiRequest("PATCH", `/api/tasks/${id}`, { status });
    queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
  };
  const setTag = async (id: number, tag: string) => {
    await apiRequest("PATCH", `/api/tasks/${id}`, { tag: tag || null });
    queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
  };

  const slotMap = new Map<number, number>();
  if (topQ.data?.taskId1) slotMap.set(topQ.data.taskId1, 1);
  if (topQ.data?.taskId2) slotMap.set(topQ.data.taskId2, 2);
  if (topQ.data?.taskId3) slotMap.set(topQ.data.taskId3, 3);

  // --- Filtered task list for the search table ---
  const filtered = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return allTasks.filter((t) => {
      // Status filter
      if (filterStatus === "open") {
        if (t.status !== "todo" && t.status !== "doing") return false;
      } else if (filterStatus !== "all") {
        if (t.status !== filterStatus) return false;
      }
      // Domain
      if (filterDomain !== "all" && t.domain !== filterDomain) return false;
      // Priority
      if (filterPriority !== "all" && t.priority !== filterPriority) return false;
      // Tag
      if (filterTag !== "all") {
        if (filterTag === "__none__") {
          if (t.tag && t.tag.trim()) return false;
        } else if ((t.tag ?? "").toLowerCase() !== filterTag.toLowerCase()) {
          return false;
        }
      }
      // Text match across title + notes + tag
      if (q) {
        const hay = [t.title, t.notes ?? "", t.tag ?? ""].join("\n").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allTasks, searchText, filterDomain, filterStatus, filterPriority, filterTag]);
  const needsALookCount = useMemo(
    () => allTasks.filter((t) => (t.tag ?? "").toLowerCase() === "check" && (t.status === "todo" || t.status === "doing")).length,
    [allTasks],
  );

  const drawerTask = drawerTaskId != null ? tasksById.get(drawerTaskId) ?? null : null;

  return (
    <div className="px-5 md:px-8 py-8 md:py-10 space-y-10">
      <header>
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          Tasks &amp; Priorities
        </div>
        <h1 className="text-2xl font-semibold mt-1">Family first triage.</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Pick three. Move the rest down. Drop anything you can.
        </p>
      </header>

      {/* ============= TOP THREE + DOMAIN TRIAGE (UNCHANGED) ============= */}

      {/* Top 3 summary */}
      <div className="grid grid-cols-3 gap-2">
        {[1, 2, 3].map((s) => {
          const id = (topQ.data as any)?.[`taskId${s}`];
          const t = id ? tasksById.get(id) : null;
          return (
            <div
              key={s}
              className={cn(
                "rounded-lg border p-3 min-h-[72px]",
                t ? "border-primary/40 bg-primary/5" : "border-dashed border-border",
              )}
              data-testid={`top-slot-${s}`}
            >
              <div className="text-xs uppercase tracking-wider text-muted-foreground">#{s}</div>
              <div className="text-sm font-medium truncate mt-1">
                {t ? t.title : "empty"}
              </div>
            </div>
          );
        })}
      </div>

      {/* Domain groups (family-first) */}
      {DOMAIN_GROUPS.map((g) => {
        const items = ordered.filter((t) => t.domain === g.key);
        if (items.length === 0) return null;
        return (
          <section key={g.key}>
            <div className="mb-3">
              <h2 className="text-base font-semibold">{g.title}</h2>
              {g.subtitle && (
                <div className="text-xs text-muted-foreground">{g.subtitle}</div>
              )}
            </div>
            <div className="space-y-2">
              {items.map((t) => {
                const idxInIds = ids.indexOf(t.id);
                const slot = slotMap.get(t.id);
                return (
                  <div
                    key={t.id}
                    className={cn(
                      "rounded-lg border bg-card p-3 space-y-2",
                      slot && "border-primary/40 bg-primary/5",
                    )}
                    data-testid={`priority-row-${t.id}`}
                  >
                    <div className="flex items-start gap-2">
                      <div className="flex flex-col gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => move(idxInIds, -1)}
                          aria-label="Move up"
                          data-testid={`button-up-${t.id}`}
                          className="h-6 w-6"
                        >
                          <ArrowUp className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => move(idxInIds, 1)}
                          aria-label="Move down"
                          data-testid={`button-down-${t.id}`}
                          className="h-6 w-6"
                        >
                          <ArrowDown className="h-3 w-3" />
                        </Button>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium leading-snug [overflow-wrap:anywhere]">{t.title}</div>
                        <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap items-center gap-2">
                          <span>
                            {domainLabel(t.domain)} · est {fmtDuration(t.estimateMinutes)}
                            {slot ? ` · in top ${slot}` : ""}
                          </span>
                          {t.tag && (
                            <span
                              className="rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px]"
                              title={t.tag}
                              data-testid={`tag-priority-${t.id}`}
                            >
                              {t.tag.length > 22 ? `${t.tag.slice(0, 21)}…` : t.tag}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1 pl-8">
                      {[1, 2, 3].map((s) => (
                        <Button
                          key={s}
                          size="sm"
                          variant={slot === s ? "default" : "outline"}
                          onClick={() => setSlot(t.id, s as 1 | 2 | 3)}
                          data-testid={`button-set-slot-${s}-${t.id}`}
                          className="h-7 px-2.5"
                        >
                          <Target className="h-3 w-3 mr-1" />
                          {s}
                        </Button>
                      ))}
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => done(t.id)}
                        data-testid={`button-priority-done-${t.id}`}
                        aria-label="Mark done"
                        className="h-7 w-7"
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => drop(t.id)}
                        data-testid={`button-priority-drop-${t.id}`}
                        aria-label="Drop"
                        className="h-7 w-7"
                      >
                        <X className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      {ordered.length === 0 && (
        <div className="text-sm text-muted-foreground italic rounded-lg border border-dashed border-border p-6 text-center">
          No open tasks. Capture something on /capture.
        </div>
      )}

      {/* ============= NEW: SEARCH + EDIT TABLE ============= */}

      <section className="space-y-3" data-testid="task-search-section">
        <div>
          <h2 className="text-base font-semibold">All tasks</h2>
          <div className="text-xs text-muted-foreground">
            Search, filter, edit. Tag a task with a project to roll it up.
          </div>
        </div>

        {/* Search bar + filter chips */}
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              data-testid="task-search-input"
              placeholder="Search title, notes or project…"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {/* Stage 26b — captured items waiting to be sorted (tag "check"). */}
            <Button
              variant={filterTag.toLowerCase() === "check" ? "default" : "outline"}
              size="sm"
              className="h-8 text-xs"
              onClick={() => setFilterTag(filterTag.toLowerCase() === "check" ? "all" : "check")}
              data-testid="filter-needs-a-look"
            >
              Needs a look
              {needsALookCount > 0 && (
                <span className="ml-1.5 rounded-full bg-muted px-1.5 text-[10px] text-foreground">{needsALookCount}</span>
              )}
            </Button>
            <Select value={filterDomain} onValueChange={setFilterDomain}>
              <SelectTrigger className="h-8 w-auto" data-testid="filter-domain">
                <SelectValue placeholder="Domain" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All domains</SelectItem>
                {DOMAIN_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="h-8 w-auto" data-testid="filter-status">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open (todo + doing)</SelectItem>
                <SelectItem value="all">All statuses</SelectItem>
                {STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterPriority} onValueChange={setFilterPriority}>
              <SelectTrigger className="h-8 w-auto" data-testid="filter-priority">
                <SelectValue placeholder="Priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All priorities</SelectItem>
                {PRIORITY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterTag} onValueChange={setFilterTag}>
              <SelectTrigger className="h-8 w-auto max-w-[180px]" data-testid="filter-tag">
                <SelectValue placeholder="Project" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All projects</SelectItem>
                <SelectItem value="__none__">No project</SelectItem>
                {allTags.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(searchText ||
              filterDomain !== "all" ||
              filterStatus !== "open" ||
              filterPriority !== "all" ||
              filterTag !== "all") && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearchText("");
                  setFilterDomain("all");
                  setFilterStatus("open");
                  setFilterPriority("all");
                  setFilterTag("all");
                }}
                data-testid="filter-clear"
                className="h-8 text-xs"
              >
                Clear filters
              </Button>
            )}
          </div>
          <div
            className="text-xs text-muted-foreground"
            data-testid="task-result-count"
          >
            {filtered.length} task{filtered.length === 1 ? "" : "s"}
          </div>
        </div>

        {/* Task list */}
        <div className="space-y-2">
          {filtered.map((t) => {
            const isDone = t.status === "done" || t.status === "dropped";
            return (
              <div
                key={t.id}
                className={cn(
                  "rounded-lg border bg-card p-3 flex items-start gap-3",
                  isDone && "opacity-60",
                )}
                data-testid={`task-row-${t.id}`}
              >
                <button
                  type="button"
                  onClick={() =>
                    setStatus(t.id, t.status === "done" ? "todo" : "done")
                  }
                  aria-label={t.status === "done" ? "Mark open" : "Mark done"}
                  data-testid={`task-toggle-${t.id}`}
                  className={cn(
                    "mt-0.5 h-5 w-5 shrink-0 rounded border border-border flex items-center justify-center",
                    t.status === "done" && "bg-primary border-primary text-primary-foreground",
                  )}
                >
                  {t.status === "done" && <Check className="h-3 w-3" />}
                </button>
                <div className="flex-1 min-w-0">
                  <div
                    className={cn(
                      "text-sm font-medium leading-snug [overflow-wrap:anywhere]",
                      isDone && "line-through",
                    )}
                  >
                    {t.title}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-border/60 px-2 py-0.5 text-[11px]">
                      {domainLabel(t.domain)}
                    </span>
                    <span className="rounded-full border border-border/60 px-2 py-0.5 text-[11px]">
                      {statusLabel(t.status)}
                    </span>
                    <TagTypeahead
                      value={t.tag ?? ""}
                      onChange={(next) => setTag(t.id, next)}
                      allTags={allTags}
                      testId={`row-tag-${t.id}`}
                    />
                    <span>est {fmtDuration(t.estimateMinutes)}</span>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setDrawerTaskId(t.id)}
                  aria-label="Edit task"
                  data-testid={`task-edit-${t.id}`}
                  className="h-8 w-8"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="text-sm text-muted-foreground italic rounded-lg border border-dashed border-border p-6 text-center">
              No tasks match these filters.
            </div>
          )}
        </div>
      </section>

      <TaskDetailsDrawer
        task={drawerTask}
        open={drawerTaskId != null}
        onClose={() => setDrawerTaskId(null)}
        allTags={allTags}
      />
    </div>
  );
}
