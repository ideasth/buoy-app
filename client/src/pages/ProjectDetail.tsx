import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type {
  Project,
  ProjectPhase,
  ProjectComponent,
  ProjectTask,
} from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Plus, Target, Trash2, Pencil, Check, X, Inbox, Star, DollarSign,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatAUDPerHour, formatAUDAnnualised } from "@/lib/projectValues";

type ProjectDetailResponse = {
  project: Project;
  phases: ProjectPhase[];
  components: ProjectComponent[];
  tasks: ProjectTask[];
  unassigned: ProjectTask[];
};

function fmtDeadline(s: string | null): string {
  if (!s) return "";
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

// Full date-time in Australia/Melbourne for last-updated stamps.
function fmtDateTimeMelbourne(ms: number | null): string {
  if (ms == null) return "";
  try {
    return new Intl.DateTimeFormat("en-AU", {
      timeZone: "Australia/Melbourne",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(ms));
  } catch {
    return "";
  }
}

// Date-only in Australia/Melbourne for note-date rows.
function fmtNoteDate(s: string | null): string {
  if (!s) return "";
  try {
    const d = new Date(s.length <= 10 ? s + "T00:00:00" : s);
    if (!isNaN(d.getTime())) {
      return new Intl.DateTimeFormat("en-AU", {
        timeZone: "Australia/Melbourne",
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).format(d);
    }
  } catch {}
  return s;
}

// Today's date as YYYY-MM-DD in Australia/Melbourne, for note-date defaults.
function todayMelbourne(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Melbourne",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

interface ComponentNote {
  id: number;
  componentType: string;
  componentId: number;
  noteDate: string;
  title: string | null;
  body: string;
  sourceUrl: string | null;
  sourceLabel: string | null;
}

export default function ProjectDetail() {
  const [, params] = useRoute<{ id: string }>("/projects/:id");
  const id = params ? parseInt(params.id, 10) : NaN;
  const { toast } = useToast();
  const qkey = ["/api/projects", id];

  const q = useQuery<ProjectDetailResponse>({
    queryKey: qkey,
    enabled: Number.isFinite(id),
    queryFn: async () => (await apiRequest("GET", `/api/projects/${id}`)).json(),
  });

  const notesKey = ["/api/projects", id, "notes"];
  const notesQ = useQuery<ComponentNote[]>({
    queryKey: notesKey,
    enabled: Number.isFinite(id),
    queryFn: async () => (await apiRequest("GET", `/api/projects/${id}/notes`)).json(),
  });
  // Space editor draft.
  const [spaceEditing, setSpaceEditing] = useState(false);
  const [spaceNameDraft, setSpaceNameDraft] = useState("");
  const [spaceUrlDraft, setSpaceUrlDraft] = useState("");
  // Narrative status editor draft.
  const [narrativeEditing, setNarrativeEditing] = useState(false);
  const [narrativeDraft, setNarrativeDraft] = useState("");
  const [narrativeUrlDraft, setNarrativeUrlDraft] = useState("");
  const [narrativeLabelDraft, setNarrativeLabelDraft] = useState("");
  // New component note draft. sourceUrl doubles as the thread pointer; its
  // label (the page title) is fetched server-side, so there is no label input.
  const [newNote, setNewNote] = useState({ noteDate: todayMelbourne(), title: "", body: "", sourceUrl: "" });
  // Phase description drafts, keyed by phase id.
  const [phaseDescEditing, setPhaseDescEditing] = useState<number | null>(null);
  const [phaseDescDraft, setPhaseDescDraft] = useState("");

  const [newPhaseName, setNewPhaseName] = useState("");
  const [newComponent, setNewComponent] = useState<{ name: string; phaseId: number | null }>({
    name: "",
    phaseId: null,
  });
  const [newTask, setNewTask] = useState<{ title: string; componentId: number | null }>({
    title: "",
    componentId: null,
  });
  const [editingTask, setEditingTask] = useState<number | null>(null);
  const [editTaskState, setEditTaskState] = useState<Record<number, { notes: string; deadline: string }>>({});
  const [descEditing, setDescEditing] = useState(false);
  const [descDraft, setDescDraft] = useState("");
  // Feature 2 — values editor draft state (string so blank input is allowed mid-edit).
  const [rateDraft, setRateDraft] = useState<string | null>(null);
  const [futureDraft, setFutureDraft] = useState<string | null>(null);
  // Slider draft state — local for smooth dragging, PATCH only fires on release.
  const [benefitDraft, setBenefitDraft] = useState<number | null>(null);
  const [kudosDraft, setKudosDraft] = useState<number | null>(null);

  if (!Number.isFinite(id)) return <div className="p-8">Invalid project</div>;
  if (q.isLoading) return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (!q.data) return <div className="p-8 text-muted-foreground">Not found.</div>;

  const { project, phases, components, tasks, unassigned } = q.data;
  const refresh = () => queryClient.invalidateQueries({ queryKey: qkey });

  const patchProject = async (body: Partial<Project>) => {
    await apiRequest("PATCH", `/api/projects/${id}`, body);
    refresh();
    queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
  };

  const refreshNotes = () => queryClient.invalidateQueries({ queryKey: notesKey });

  const saveNarrativeStatus = async () => {
    const text = narrativeDraft.trim();
    if (!text) {
      toast({ title: "Status required", description: "Enter a narrative status." });
      return;
    }
    await apiRequest("PATCH", `/api/projects/${id}/narrative-status`, {
      latestNarrativeStatus: text,
      latestNarrativeStatusSourceUrl: narrativeUrlDraft.trim() || undefined,
      latestNarrativeStatusSourceLabel: narrativeLabelDraft.trim() || undefined,
    });
    setNarrativeEditing(false);
    refresh();
  };

  const saveSpace = async () => {
    const name = spaceNameDraft.trim();
    const url = spaceUrlDraft.trim();
    try {
      await apiRequest("PATCH", `/api/projects/${id}`, {
        spaceName: name || null,
        spaceUrl: url || null,
      });
    } catch {
      toast({ title: "Could not save space", description: "Enter a valid http(s) URL or leave it blank." });
      return;
    }
    setSpaceEditing(false);
    refresh();
    queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
  };

  const addNote = async () => {
    const body = newNote.body.trim();
    if (!body) return;
    try {
      await apiRequest("POST", `/api/projects/${id}/notes`, {
        noteDate: newNote.noteDate || todayMelbourne(),
        title: newNote.title.trim() || undefined,
        body,
        sourceUrl: newNote.sourceUrl.trim() || undefined,
      });
    } catch {
      toast({ title: "Could not add note", description: "Enter a valid http(s) thread URL or leave it blank." });
      return;
    }
    setNewNote({ noteDate: todayMelbourne(), title: "", body: "", sourceUrl: "" });
    refreshNotes();
  };

  const deleteNote = async (noteId: number) => {
    if (!confirm("Delete this note?")) return;
    await apiRequest("DELETE", `/api/component-notes/${noteId}`);
    refreshNotes();
  };

  const savePhaseDescription = async (phaseId: number) => {
    const text = phaseDescDraft.trim();
    if (!text) {
      toast({ title: "Description required", description: "Enter a phase description." });
      return;
    }
    await apiRequest("PATCH", `/api/phases/${phaseId}/description`, { description: text });
    setPhaseDescEditing(null);
    refresh();
  };

  const setPriority = (value: string) => {
    // "focus" ⇒ focus-of-week (high + flag); "high"/"low" ⇒ clear the flag.
    if (value === "focus") return patchProject({ priority: "high", focusOfWeek: true } as any);
    if (value === "high") return patchProject({ priority: "high", focusOfWeek: false } as any);
    return patchProject({ priority: "low", focusOfWeek: false } as any);
  };
  const setNextAction = (taskId: number | null) => patchProject({ nextActionTaskId: taskId } as any);
  const setCurrentPhase = (phaseId: number | null) => patchProject({ currentPhaseId: phaseId } as any);

  const addPhase = async () => {
    const name = newPhaseName.trim();
    if (!name) return;
    await apiRequest("POST", `/api/projects/${id}/phases`, { name, orderIndex: phases.length });
    setNewPhaseName("");
    refresh();
  };

  const deletePhase = async (phaseId: number) => {
    if (!confirm("Delete this phase?")) return;
    await apiRequest("DELETE", `/api/phases/${phaseId}`);
    refresh();
  };

  const addComponent = async () => {
    const name = newComponent.name.trim();
    if (!name) return;
    await apiRequest("POST", `/api/projects/${id}/components`, {
      name,
      phaseId: newComponent.phaseId,
      orderIndex: components.length,
    });
    setNewComponent({ name: "", phaseId: null });
    refresh();
  };

  const setComponentPhase = async (componentId: number, phaseId: number | null) => {
    await apiRequest("PATCH", `/api/components/${componentId}`, { phaseId });
    refresh();
  };

  const deleteComponent = async (componentId: number) => {
    if (!confirm("Delete this component? Tasks will move to Unassigned.")) return;
    await apiRequest("DELETE", `/api/components/${componentId}`);
    refresh();
  };

  const addTask = async () => {
    const title = newTask.title.trim();
    if (!title) return;
    await apiRequest("POST", `/api/projects/${id}/tasks`, {
      title,
      componentId: newTask.componentId,
    });
    setNewTask({ title: "", componentId: null });
    refresh();
  };

  const placeTask = async (taskId: number, componentId: number | null) => {
    await apiRequest("PATCH", `/api/tasks/project/${taskId}`, { componentId });
    refresh();
  };

  const toggleTaskCompleted = async (t: ProjectTask) => {
    await apiRequest("PATCH", `/api/tasks/project/${t.id}`, { completed: t.completed ? 0 : 1 });
    refresh();
  };

  const deleteTask = async (taskId: number) => {
    if (!confirm("Delete task?")) return;
    await apiRequest("DELETE", `/api/tasks/project/${taskId}`);
    refresh();
  };

  const startEditTask = (t: ProjectTask) => {
    setEditingTask(t.id);
    setEditTaskState({
      ...editTaskState,
      [t.id]: { notes: t.notes ?? "", deadline: t.deadline ?? "" },
    });
  };

  const saveEditTask = async (taskId: number) => {
    const v = editTaskState[taskId];
    if (!v) return;
    await apiRequest("PATCH", `/api/tasks/project/${taskId}`, {
      notes: v.notes,
      deadline: v.deadline || null,
    });
    setEditingTask(null);
    refresh();
  };

  const componentsByPhase = (phaseId: number | null) =>
    components.filter((c) => (phaseId == null ? c.phaseId == null : c.phaseId === phaseId));

  const tasksByComponent = (componentId: number) =>
    tasks.filter((t) => t.componentId === componentId);

  const nextActionTask = project.nextActionTaskId
    ? tasks.find((t) => t.id === project.nextActionTaskId)
    : null;
  const currentPhase = project.currentPhaseId
    ? phases.find((p) => p.id === project.currentPhaseId)
    : null;

  return (
    <div className="px-5 md:px-8 py-8 md:py-10 space-y-8 max-w-4xl">
      {/* Header */}
      <div>
        <Link
          href="/projects"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-3"
          data-testid="link-back"
        >
          <ArrowLeft className="h-3 w-3" />
          All projects
        </Link>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Project</div>
            <h1 className="text-2xl font-semibold mt-1 break-words">{project.name}</h1>
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0">
            <div className="text-xs text-muted-foreground text-right">PMT status</div>
            <Select
              value={project.pmtStatus === "Open" ? "Active" : (project.pmtStatus ?? "")}
              onValueChange={(v) => patchProject({ pmtStatus: v } as any)}
            >
              <SelectTrigger className="h-8 w-[130px]" data-testid="select-pmt-status">
                <SelectValue placeholder="Set status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Active">Active</SelectItem>
                <SelectItem value="Parked">Parked</SelectItem>
                <SelectItem value="Complete">Complete</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={project.focusOfWeekAt != null ? "focus" : project.priority}
              onValueChange={setPriority}
            >
              <SelectTrigger className="h-8 w-[130px]" data-testid="select-priority">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="focus">Focus of the week</SelectItem>
                <SelectItem value="high">High priority</SelectItem>
                <SelectItem value="low">Low priority</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Space */}
      <section
        className="rounded-lg border border-border bg-card p-4 space-y-2"
        data-testid="space-box"
      >
        <div className="flex items-center justify-between">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Space</div>
          {!spaceEditing && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setSpaceNameDraft(project.spaceName ?? "");
                setSpaceUrlDraft(project.spaceUrl ?? "");
                setSpaceEditing(true);
              }}
              data-testid="button-edit-space"
            >
              <Pencil className="h-3 w-3 mr-1" />
              Edit
            </Button>
          )}
        </div>
        {spaceEditing ? (
          <div className="space-y-2">
            <Input
              value={spaceNameDraft}
              onChange={(e) => setSpaceNameDraft(e.target.value)}
              placeholder="Space name"
              className="h-8 text-sm"
              data-testid="input-space-name"
            />
            <Input
              value={spaceUrlDraft}
              onChange={(e) => setSpaceUrlDraft(e.target.value)}
              placeholder="Space URL (optional)"
              className="h-8 text-sm"
              data-testid="input-space-url"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={saveSpace} data-testid="button-save-space">
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSpaceEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-sm" data-testid="text-space">
            {project.spaceName?.trim() || project.spaceUrl ? (
              project.spaceUrl ? (
                <a
                  href={project.spaceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 dark:text-blue-400 hover:underline"
                  data-testid="link-space"
                >
                  {project.spaceName?.trim() || project.spaceUrl}
                </a>
              ) : (
                <span>{project.spaceName?.trim()}</span>
              )
            ) : (
              <span className="italic text-muted-foreground">No space linked yet.</span>
            )}
          </div>
        )}
      </section>

      {/* Narrative status box */}
      <section
        className="rounded-lg border border-primary/40 bg-primary/5 p-4 space-y-3"
        data-testid="narrative-status-box"
      >
        <div className="flex items-center justify-between">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Narrative status</div>
          {!narrativeEditing && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setNarrativeDraft(project.latestNarrativeStatus ?? "");
                setNarrativeUrlDraft(project.latestNarrativeStatusSourceUrl ?? "");
                setNarrativeLabelDraft(project.latestNarrativeStatusSourceLabel ?? "");
                setNarrativeEditing(true);
              }}
              data-testid="button-edit-narrative-status"
            >
              <Pencil className="h-3 w-3 mr-1" />
              Edit
            </Button>
          )}
        </div>
        {narrativeEditing ? (
          <div className="space-y-2">
            <Textarea
              value={narrativeDraft}
              onChange={(e) => setNarrativeDraft(e.target.value)}
              maxLength={2000}
              placeholder="Where does this component stand right now?"
              className="min-h-[100px] text-sm"
              data-testid="textarea-narrative-status"
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <Input
                value={narrativeUrlDraft}
                onChange={(e) => setNarrativeUrlDraft(e.target.value)}
                placeholder="Source URL (optional)"
                className="h-8 text-xs"
                data-testid="input-narrative-source-url"
              />
              <Input
                value={narrativeLabelDraft}
                onChange={(e) => setNarrativeLabelDraft(e.target.value)}
                placeholder="Source label (optional)"
                className="h-8 text-xs"
                data-testid="input-narrative-source-label"
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={saveNarrativeStatus} data-testid="button-save-narrative-status">
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setNarrativeEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            <div className="text-sm whitespace-pre-wrap" data-testid="text-narrative-status">
              {project.latestNarrativeStatus?.trim() || (
                <span className="italic text-muted-foreground">No narrative status yet.</span>
              )}
            </div>
            {project.latestNarrativeStatusUpdatedAt != null && (
              <div className="text-[11px] text-muted-foreground">
                Updated {fmtDateTimeMelbourne(project.latestNarrativeStatusUpdatedAt)}
              </div>
            )}
            {project.latestNarrativeStatusSourceUrl && (
              <a
                href={project.latestNarrativeStatusSourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline inline-block"
              >
                {project.latestNarrativeStatusSourceLabel?.trim() || "Source"}
              </a>
            )}
          </div>
        )}
      </section>

      {/* Summary card */}
      <section className="rounded-lg border border-border bg-card p-4 space-y-4">
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Description</div>
            {!descEditing ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDescDraft(project.description ?? "");
                  setDescEditing(true);
                }}
                data-testid="button-edit-description"
              >
                <Pencil className="h-3 w-3 mr-1" />
                Edit
              </Button>
            ) : null}
          </div>
          {descEditing ? (
            <div className="space-y-2">
              <Textarea
                value={descDraft}
                onChange={(e) => setDescDraft(e.target.value)}
                className="min-h-[80px] text-sm"
                data-testid="textarea-description"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={async () => {
                    await patchProject({ description: descDraft } as any);
                    setDescEditing(false);
                  }}
                  data-testid="button-save-description"
                >
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDescEditing(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground whitespace-pre-wrap">
              {project.description?.trim() || <span className="italic">No description.</span>}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Current phase</div>
            <Select
              value={project.currentPhaseId ? String(project.currentPhaseId) : "none"}
              onValueChange={(v) => setCurrentPhase(v === "none" ? null : parseInt(v, 10))}
            >
              <SelectTrigger className="h-8" data-testid="select-current-phase">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {phases.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Next action</div>
            {nextActionTask ? (
              <div className="rounded border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
                <div className="font-medium">{nextActionTask.title}</div>
                <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap items-center gap-1.5">
                  {currentPhase && <Badge variant="outline" className="text-[10px] py-0 h-4">{currentPhase.name}</Badge>}
                  {nextActionTask.componentId && (
                    <Badge variant="outline" className="text-[10px] py-0 h-4">
                      {components.find((c) => c.id === nextActionTask.componentId)?.name ?? ""}
                    </Badge>
                  )}
                  {nextActionTask.deadline && <span>due {fmtDeadline(nextActionTask.deadline)}</span>}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-1 h-6 text-xs text-muted-foreground"
                  onClick={() => setNextAction(null)}
                  data-testid="button-clear-next-action"
                >
                  Clear
                </Button>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground italic">Pick a task below.</div>
            )}
          </div>
        </div>
      </section>

      {/* Feature 2 — Project values */}
      <section
        className="rounded-lg border border-border bg-card p-4 space-y-5"
        data-testid="section-project-values"
      >
        <div className="flex items-baseline justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Project values</div>
            <p className="text-xs text-muted-foreground mt-1">
              Quantify what this project pays, what it might pay, and what it gives back.
              Used by the morning briefing and (later) the coach page.
            </p>
          </div>
          {project.isPrimaryFutureIncome === 1 && (
            <Badge
              className="text-[10px] py-0 h-5 gap-0.5 bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/40"
              variant="outline"
              data-testid="badge-primary-detail"
            >
              <Star className="h-3 w-3" />
              Primary future income
            </Badge>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Current income per hour */}
          <div className="space-y-1.5">
            <Label htmlFor={`rate-${project.id}`} className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <DollarSign className="h-3 w-3" />
              Current income per hour (AUD)
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id={`rate-${project.id}`}
                type="number"
                inputMode="numeric"
                min={0}
                max={100000}
                step={10}
                placeholder="0"
                className="h-9 max-w-[180px]"
                value={
                  rateDraft != null
                    ? rateDraft
                    : project.currentIncomePerHour != null
                    ? String(project.currentIncomePerHour)
                    : ""
                }
                onChange={(e) => setRateDraft(e.target.value)}
                onBlur={async () => {
                  if (rateDraft == null) return;
                  const trimmed = rateDraft.trim();
                  const next: number | null = trimmed === "" ? null : Number(trimmed);
                  if (next != null && (!Number.isFinite(next) || next < 0 || next > 100000)) {
                    toast({ title: "Invalid rate", description: "Enter 0–100,000 or leave blank." });
                    setRateDraft(null);
                    return;
                  }
                  await patchProject({ currentIncomePerHour: next } as any);
                  setRateDraft(null);
                }}
                data-testid="input-current-rate"
              />
              {project.currentIncomePerHour != null && (
                <span className="text-sm text-muted-foreground">
                  = {formatAUDPerHour(project.currentIncomePerHour)}
                </span>
              )}
            </div>
            <div className="text-[11px] text-muted-foreground">0 if not income-generating. Leave blank to mark unscored.</div>
          </div>

          {/* Future income estimate */}
          <div className="space-y-1.5">
            <Label htmlFor={`future-${project.id}`} className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <DollarSign className="h-3 w-3" />
              Future income estimate (AUD/yr)
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id={`future-${project.id}`}
                type="number"
                inputMode="numeric"
                min={0}
                max={100000000}
                step={1000}
                placeholder="0"
                className="h-9 max-w-[200px]"
                value={
                  futureDraft != null
                    ? futureDraft
                    : project.futureIncomeEstimate != null
                    ? String(project.futureIncomeEstimate)
                    : ""
                }
                onChange={(e) => setFutureDraft(e.target.value)}
                onBlur={async () => {
                  if (futureDraft == null) return;
                  const trimmed = futureDraft.trim();
                  const next: number | null = trimmed === "" ? null : Number(trimmed);
                  if (next != null && (!Number.isFinite(next) || next < 0 || next > 100000000)) {
                    toast({ title: "Invalid estimate", description: "Enter 0–100,000,000 or leave blank." });
                    setFutureDraft(null);
                    return;
                  }
                  await patchProject({ futureIncomeEstimate: next } as any);
                  setFutureDraft(null);
                }}
                data-testid="input-future-estimate"
              />
              {project.futureIncomeEstimate != null && project.futureIncomeEstimate > 0 && (
                <span className="text-sm text-muted-foreground">
                  = {formatAUDAnnualised(project.futureIncomeEstimate)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Switch
                id={`primary-${project.id}`}
                checked={project.isPrimaryFutureIncome === 1}
                onCheckedChange={(checked) =>
                  patchProject({ isPrimaryFutureIncome: checked ? 1 : 0 } as any)
                }
                data-testid="switch-primary-future"
              />
              <Label
                htmlFor={`primary-${project.id}`}
                className="text-xs text-muted-foreground cursor-pointer"
              >
                Mark as primary future-income project (only one allowed)
              </Label>
            </div>
          </div>

          {/* Community benefit slider */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Community benefit
              </Label>
              <span className="text-sm tabular-nums" data-testid="text-community-benefit">
                {(() => {
                  const live = benefitDraft ?? project.communityBenefit;
                  if (live == null || live === 0) return "—";
                  return `${live}/5`;
                })()}
              </span>
            </div>
            <Slider
              value={[benefitDraft ?? project.communityBenefit ?? 0]}
              min={0}
              max={5}
              step={1}
              onValueChange={(v) => setBenefitDraft(v[0])}
              onValueCommit={(v) => {
                const score = v[0] === 0 ? null : v[0];
                setBenefitDraft(null);
                patchProject({ communityBenefit: score } as any);
              }}
              data-testid="slider-community-benefit"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>unscored</span>
              <span>1</span>
              <span>2</span>
              <span>3</span>
              <span>4</span>
              <span>5</span>
            </div>
          </div>

          {/* Professional kudos slider */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Professional kudos
              </Label>
              <span className="text-sm tabular-nums" data-testid="text-professional-kudos">
                {(() => {
                  const live = kudosDraft ?? project.professionalKudos;
                  if (live == null || live === 0) return "—";
                  return `${live}/5`;
                })()}
              </span>
            </div>
            <Slider
              value={[kudosDraft ?? project.professionalKudos ?? 0]}
              min={0}
              max={5}
              step={1}
              onValueChange={(v) => setKudosDraft(v[0])}
              onValueCommit={(v) => {
                const score = v[0] === 0 ? null : v[0];
                setKudosDraft(null);
                patchProject({ professionalKudos: score } as any);
              }}
              data-testid="slider-professional-kudos"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>unscored</span>
              <span>1</span>
              <span>2</span>
              <span>3</span>
              <span>4</span>
              <span>5</span>
            </div>
          </div>
        </div>
      </section>

      {/* Unassigned tray */}
      {unassigned.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Inbox className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-base font-semibold">Unassigned tasks</h2>
            <Badge variant="outline" className="text-[10px]">{unassigned.length}</Badge>
          </div>
          <div className="text-xs text-muted-foreground">
            From MS To Do. Place each into a component before it shows in the phase view.
          </div>
          <div className="rounded-lg border border-dashed border-border bg-muted/10 divide-y divide-border">
            {unassigned.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                components={components}
                phases={phases}
                isNext={project.nextActionTaskId === t.id}
                editing={editingTask === t.id}
                editState={editTaskState[t.id]}
                onPlace={placeTask}
                onToggleComplete={toggleTaskCompleted}
                onDelete={deleteTask}
                onStartEdit={startEditTask}
                onCancelEdit={() => setEditingTask(null)}
                onSaveEdit={saveEditTask}
                onSetEditState={(s) => setEditTaskState({ ...editTaskState, [t.id]: s })}
                onSetNext={(taskId) => setNextAction(taskId)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Phases + components + tasks */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold">Phases</h2>

        <div className="flex gap-2">
          <Input
            value={newPhaseName}
            onChange={(e) => setNewPhaseName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addPhase()}
            placeholder="New phase name"
            className="h-8 max-w-sm"
            data-testid="input-new-phase"
          />
          <Button size="sm" onClick={addPhase} disabled={!newPhaseName.trim()} data-testid="button-add-phase">
            <Plus className="h-3 w-3 mr-1" />
            Add phase
          </Button>
        </div>

        {[...phases, null as ProjectPhase | null].map((phase) => {
          const phaseId = phase ? phase.id : null;
          const phaseComps = componentsByPhase(phaseId);
          // Skip the "no-phase" bucket if there are no components in it
          if (phase == null && phaseComps.length === 0) return null;
          return (
            <div
              key={phase ? phase.id : "no-phase"}
              className={cn(
                "rounded-lg border bg-card p-3 space-y-3",
                project.currentPhaseId === phase?.id ? "border-primary/40 bg-primary/5" : "border-border",
              )}
              data-testid={`phase-${phase ? phase.id : "no-phase"}`}
            >
              <div className="flex items-center gap-2">
                <div className="font-medium">
                  {phase ? phase.name : <span className="text-muted-foreground italic">No phase</span>}
                </div>
                {phase && project.currentPhaseId === phase.id && (
                  <Badge className="text-[10px] py-0 h-4">current</Badge>
                )}
                {phase && (
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => deletePhase(phase.id)}
                    className="h-6 w-6 ml-auto text-muted-foreground"
                    data-testid={`button-delete-phase-${phase.id}`}
                    aria-label="Delete phase"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>

              {/* Phase description & objectives */}
              {phase && (
                <div className="pl-2" data-testid={`phase-description-${phase.id}`}>
                  {phaseDescEditing === phase.id ? (
                    <div className="space-y-2">
                      <Textarea
                        value={phaseDescDraft}
                        onChange={(e) => setPhaseDescDraft(e.target.value)}
                        maxLength={5000}
                        placeholder="Phase description & objectives"
                        className="min-h-[70px] text-sm"
                        data-testid={`textarea-phase-description-${phase.id}`}
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => savePhaseDescription(phase.id)}
                          data-testid={`button-save-phase-description-${phase.id}`}
                        >
                          Save
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setPhaseDescEditing(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2">
                      <div className="flex-1 text-xs text-muted-foreground whitespace-pre-wrap">
                        {phase.description?.trim() || <span className="italic">No description & objectives.</span>}
                        {phase.descriptionUpdatedAt != null && (
                          <span className="block text-[10px] mt-0.5">
                            Updated {fmtDateTimeMelbourne(phase.descriptionUpdatedAt)}
                          </span>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-xs"
                        onClick={() => {
                          setPhaseDescDraft(phase.description ?? "");
                          setPhaseDescEditing(phase.id);
                        }}
                        data-testid={`button-edit-phase-description-${phase.id}`}
                      >
                        <Pencil className="h-3 w-3 mr-1" />
                        Edit
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {phaseComps.length === 0 ? (
                <div className="text-xs text-muted-foreground italic pl-2">No components.</div>
              ) : (
                <div className="space-y-3 pl-2">
                  {phaseComps.map((c) => {
                    const compTasks = tasksByComponent(c.id);
                    return (
                      <div key={c.id} className="rounded border border-border bg-background p-3 space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="font-medium text-sm">{c.name}</div>
                          <Badge variant="outline" className="text-[10px] py-0 h-4">
                            {compTasks.length} task{compTasks.length === 1 ? "" : "s"}
                          </Badge>
                          <div className="ml-auto flex items-center gap-1">
                            <Select
                              value={c.phaseId ? String(c.phaseId) : "none"}
                              onValueChange={(v) =>
                                setComponentPhase(c.id, v === "none" ? null : parseInt(v, 10))
                              }
                            >
                              <SelectTrigger className="h-7 w-[140px] text-xs" data-testid={`select-component-phase-${c.id}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">No phase</SelectItem>
                                {phases.map((p) => (
                                  <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => deleteComponent(c.id)}
                              className="h-6 w-6 text-muted-foreground"
                              data-testid={`button-delete-component-${c.id}`}
                              aria-label="Delete component"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                        {compTasks.length === 0 ? (
                          <div className="text-xs text-muted-foreground italic pl-1">No tasks.</div>
                        ) : (
                          <div className="space-y-1.5">
                            {compTasks.map((t) => (
                              <TaskRow
                                key={t.id}
                                task={t}
                                components={components}
                                phases={phases}
                                isNext={project.nextActionTaskId === t.id}
                                editing={editingTask === t.id}
                                editState={editTaskState[t.id]}
                                onPlace={placeTask}
                                onToggleComplete={toggleTaskCompleted}
                                onDelete={deleteTask}
                                onStartEdit={startEditTask}
                                onCancelEdit={() => setEditingTask(null)}
                                onSaveEdit={saveEditTask}
                                onSetEditState={(s) => setEditTaskState({ ...editTaskState, [t.id]: s })}
                                onSetNext={(taskId) => setNextAction(taskId)}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {/* Add component */}
        <div className="rounded-lg border border-dashed border-border p-3 space-y-2">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Add component</div>
          <div className="flex flex-wrap gap-2">
            <Input
              value={newComponent.name}
              onChange={(e) => setNewComponent({ ...newComponent, name: e.target.value })}
              placeholder="Component name"
              className="h-8 max-w-xs"
              data-testid="input-new-component"
            />
            <Select
              value={newComponent.phaseId ? String(newComponent.phaseId) : "none"}
              onValueChange={(v) =>
                setNewComponent({ ...newComponent, phaseId: v === "none" ? null : parseInt(v, 10) })
              }
            >
              <SelectTrigger className="h-8 w-[180px]" data-testid="select-new-component-phase">
                <SelectValue placeholder="Phase" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No phase</SelectItem>
                {phases.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              onClick={addComponent}
              disabled={!newComponent.name.trim()}
              data-testid="button-add-component"
            >
              <Plus className="h-3 w-3 mr-1" />
              Add
            </Button>
          </div>
        </div>

        {/* Add task */}
        <div className="rounded-lg border border-dashed border-border p-3 space-y-2">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Add task</div>
          <div className="flex flex-wrap gap-2">
            <Input
              value={newTask.title}
              onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
              placeholder="Task title"
              className="h-8 max-w-xs"
              data-testid="input-new-task"
            />
            <Select
              value={newTask.componentId ? String(newTask.componentId) : "none"}
              onValueChange={(v) =>
                setNewTask({ ...newTask, componentId: v === "none" ? null : parseInt(v, 10) })
              }
            >
              <SelectTrigger className="h-8 w-[200px]" data-testid="select-new-task-component">
                <SelectValue placeholder="Component" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Unassigned</SelectItem>
                {components.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              onClick={addTask}
              disabled={!newTask.title.trim()}
              data-testid="button-add-task"
            >
              <Plus className="h-3 w-3 mr-1" />
              Add
            </Button>
          </div>
        </div>
      </section>

      {/* Notes timeline */}
      <section className="space-y-3" data-testid="section-component-notes">
        <h2 className="text-base font-semibold">Notes timeline</h2>
        <div className="rounded-lg border border-border bg-card divide-y divide-border">
          {(notesQ.data ?? []).length === 0 ? (
            <div className="p-3 text-sm text-muted-foreground italic">No notes yet.</div>
          ) : (
            (notesQ.data ?? []).map((n) => (
              <div key={n.id} className="p-3 space-y-1" data-testid={`note-row-${n.id}`}>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground">{fmtNoteDate(n.noteDate)}</span>
                  {n.title && <span className="text-sm font-medium">{n.title}</span>}
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => deleteNote(n.id)}
                    className="h-6 w-6 ml-auto text-muted-foreground"
                    aria-label="Delete note"
                    data-testid={`button-delete-note-${n.id}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
                <div className="text-sm whitespace-pre-wrap">{n.body}</div>
                {n.sourceUrl && (
                  <a
                    href={n.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline inline-block"
                    data-testid={`note-thread-${n.id}`}
                  >
                    {n.sourceLabel?.trim() || hostnameOrLink(n.sourceUrl)}
                  </a>
                )}
              </div>
            ))
          )}
        </div>
        {/* Add note */}
        <div className="rounded-lg border border-dashed border-border p-3 space-y-2">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Add note</div>
          <div className="flex flex-wrap gap-2">
            <Input
              type="date"
              value={newNote.noteDate}
              onChange={(e) => setNewNote({ ...newNote, noteDate: e.target.value })}
              className="h-8 max-w-[160px]"
              data-testid="input-new-note-date"
            />
            <Input
              value={newNote.title}
              onChange={(e) => setNewNote({ ...newNote, title: e.target.value })}
              placeholder="Title (optional)"
              maxLength={200}
              className="h-8 max-w-xs"
              data-testid="input-new-note-title"
            />
          </div>
          <Input
            value={newNote.sourceUrl}
            onChange={(e) => setNewNote({ ...newNote, sourceUrl: e.target.value })}
            placeholder="Thread URL (title auto-detected)"
            className="h-8 text-sm"
            data-testid="input-new-note-source-url"
          />
          <Textarea
            value={newNote.body}
            onChange={(e) => setNewNote({ ...newNote, body: e.target.value })}
            placeholder="Note"
            className="min-h-[70px] text-sm"
            data-testid="textarea-new-note-body"
          />
          <Button
            size="sm"
            onClick={addNote}
            disabled={!newNote.body.trim()}
            data-testid="button-add-note"
          >
            <Plus className="h-3 w-3 mr-1" />
            Add note
          </Button>
        </div>
      </section>
    </div>
  );
}

// Fallback label for a note's thread link when no page title was fetched.
function hostnameOrLink(url: string): string {
  try {
    return new URL(url).hostname || "Link";
  } catch {
    return "Link";
  }
}

function TaskRow(props: {
  task: ProjectTask;
  components: ProjectComponent[];
  phases: ProjectPhase[];
  isNext: boolean;
  editing: boolean;
  editState: { notes: string; deadline: string } | undefined;
  onPlace: (taskId: number, componentId: number | null) => void;
  onToggleComplete: (t: ProjectTask) => void;
  onDelete: (taskId: number) => void;
  onStartEdit: (t: ProjectTask) => void;
  onCancelEdit: () => void;
  onSaveEdit: (taskId: number) => void;
  onSetEditState: (s: { notes: string; deadline: string }) => void;
  onSetNext: (taskId: number) => void;
}) {
  const { task: t, components, isNext } = props;
  return (
    <div
      className={cn(
        "rounded p-2 space-y-1.5",
        isNext ? "bg-primary/10 border border-primary/30" : "bg-background",
        t.completed ? "opacity-60" : "",
      )}
      data-testid={`task-row-${t.id}`}
    >
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={!!t.completed}
          onChange={() => props.onToggleComplete(t)}
          className="mt-1 shrink-0"
          data-testid={`task-complete-${t.id}`}
        />
        <div className="flex-1 min-w-0">
          <div className={cn("text-sm font-medium", t.completed && "line-through")}>
            {t.title}
            {isNext && <Badge className="ml-2 text-[10px] py-0 h-4">next</Badge>}
          </div>
          {t.deadline && (
            <div className="text-[11px] text-muted-foreground">due {fmtDeadline(t.deadline)}</div>
          )}
          {t.notes && !props.editing && (
            <div className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{t.notes}</div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            size="icon"
            variant={isNext ? "default" : "ghost"}
            onClick={() => props.onSetNext(t.id)}
            className="h-6 w-6"
            aria-label="Set as Next Action"
            title="Set as Next Action"
            data-testid={`button-set-next-${t.id}`}
          >
            <Target className="h-3 w-3" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => (props.editing ? props.onCancelEdit() : props.onStartEdit(t))}
            className="h-6 w-6"
            aria-label="Edit task"
            data-testid={`button-edit-task-${t.id}`}
          >
            <Pencil className="h-3 w-3" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => props.onDelete(t.id)}
            className="h-6 w-6 text-muted-foreground"
            aria-label="Delete task"
            data-testid={`button-delete-task-${t.id}`}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 pl-6">
        <Select
          value={t.componentId ? String(t.componentId) : "none"}
          onValueChange={(v) => props.onPlace(t.id, v === "none" ? null : parseInt(v, 10))}
        >
          <SelectTrigger className="h-6 text-xs w-[180px]" data-testid={`select-component-${t.id}`}>
            <SelectValue placeholder="Place in component" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Unassigned</SelectItem>
            {components.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {props.editing && props.editState && (
        <div className="pl-6 space-y-2 pt-1">
          <Input
            type="date"
            value={props.editState.deadline ? props.editState.deadline.slice(0, 10) : ""}
            onChange={(e) => props.onSetEditState({ ...props.editState!, deadline: e.target.value })}
            className="h-7 text-xs max-w-[160px]"
            data-testid={`input-deadline-${t.id}`}
          />
          <Textarea
            value={props.editState.notes}
            onChange={(e) => props.onSetEditState({ ...props.editState!, notes: e.target.value })}
            placeholder="Notes"
            className="min-h-[60px] text-xs"
            data-testid={`textarea-notes-${t.id}`}
          />
          <div className="flex gap-1">
            <Button size="sm" onClick={() => props.onSaveEdit(t.id)} data-testid={`button-save-task-${t.id}`}>
              <Check className="h-3 w-3 mr-1" />
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={props.onCancelEdit}>
              <X className="h-3 w-3 mr-1" />
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
