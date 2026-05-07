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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Plus, Target, Trash2, Pencil, Check, X, Inbox,
} from "lucide-react";
import { cn } from "@/lib/utils";

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

  const setPriority = (priority: string) => patchProject({ priority } as any);
  const setStatus = (status: string) => patchProject({ status } as any);
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
            <Select value={project.priority} onValueChange={setPriority}>
              <SelectTrigger className="h-8 w-[130px]" data-testid="select-priority">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="high">High priority</SelectItem>
                <SelectItem value="low">Low priority</SelectItem>
              </SelectContent>
            </Select>
            <Select value={project.status} onValueChange={setStatus}>
              <SelectTrigger className="h-8 w-[130px]" data-testid="select-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="parked">Parked</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

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
    </div>
  );
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
