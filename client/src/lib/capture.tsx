// filepath: client/src/lib/capture.tsx
// Stage 26b — client side of unified capture. One save path for the floating
// "+" button, the ⌘K sheet and the /capture page: POST /api/capture/item.
// The toast offers Undo for 5 seconds.

import { apiRequest, queryClient } from "@/lib/queryClient";
import { ToastAction } from "@/components/ui/toast";

export interface CaptureBody {
  text: string;
  projectId?: number | null;
  dueDate?: string | null;
  domain?: string | null;
  estimateMinutes?: number | null;
}

export type CaptureItem =
  | { ok: true; kind: "task"; id: number; title: string }
  | { ok: true; kind: "project_task"; id: number; projectId: number; projectName: string; title: string };

const RECENT_KEY = "buoy.capture.recentProjects";

export function recentProjectIds(): number[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((n) => Number.isInteger(n)).slice(0, 5) : [];
  } catch {
    return [];
  }
}

function rememberProject(id: number) {
  try {
    const next = [id, ...recentProjectIds().filter((n) => n !== id)].slice(0, 5);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* private mode — ignore */
  }
}

function invalidate(item: CaptureItem) {
  queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
  queryClient.invalidateQueries({ queryKey: ["/api/updates"] });
  if (item.kind === "project_task") {
    queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
    queryClient.invalidateQueries({ queryKey: [`/api/projects/${item.projectId}`] });
  }
}

export async function saveCaptureItem(body: CaptureBody): Promise<CaptureItem> {
  const res = await apiRequest("POST", "/api/capture/item", body);
  const item = (await res.json()) as CaptureItem;
  if (item.kind === "project_task") rememberProject(item.projectId);
  invalidate(item);
  return item;
}

export async function undoCaptureItem(item: CaptureItem): Promise<void> {
  await apiRequest("DELETE", `/api/capture/item/${item.kind}/${item.id}`);
  invalidate(item);
}

type ToastFn = (t: any) => { dismiss: () => void };

/** "Captured" toast with a 5-second Undo. */
export function capturedToast(toast: ToastFn, item: CaptureItem) {
  const where = item.kind === "project_task" ? `Filed to ${item.projectName}` : "Tasks · needs a look";
  const t = toast({
    title: "Captured",
    description: `${item.title.slice(0, 60)} — ${where}`,
    duration: 5000,
    action: (
      <ToastAction
        altText="Undo capture"
        data-testid="button-capture-undo"
        onClick={() => {
          void undoCaptureItem(item)
            .then(() => toast({ title: "Capture undone", duration: 2500 }))
            .catch((err) => toast({ title: "Undo failed", description: String(err), variant: "destructive" }));
        }}
      >
        Undo
      </ToastAction>
    ),
  });
  return t;
}
