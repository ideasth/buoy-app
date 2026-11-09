// filepath: client/src/components/FileToProjectCard.tsx
// Stage 31 — "File to project" for a Needs a look capture. Turns the general
// task into a project task (no [check] marker: filing it is the look) and
// records a "capture" update on the project.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { FolderInput } from "lucide-react";

interface ProjectLite { id: number; name: string; status?: string; pmtStatus?: string | null; priority?: string }

export function FileToProjectCard({ taskId, onFiled }: { taskId: number; onFiled: () => void }) {
  const { toast } = useToast();
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const projectsQ = useQuery<ProjectLite[]>({ queryKey: ["/api/projects"] });
  const options = useMemo(
    () => (projectsQ.data ?? [])
      .filter((p) => p.status !== "parked" && p.pmtStatus !== "Complete" && p.pmtStatus !== "Parked")
      .sort((a, b) => (a.priority === "high" ? 0 : 1) - (b.priority === "high" ? 0 : 1) || a.name.localeCompare(b.name)),
    [projectsQ.data],
  );

  const file = async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      const r = await (await apiRequest("POST", `/api/capture/item/task/${taskId}/file-to-project`, { projectId: Number(projectId) })).json();
      toast({ title: `Filed to ${r.projectName}`, description: r.title });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      onFiled();
    } catch (e) {
      toast({ title: "Could not file it", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-md border border-border p-3 space-y-2" data-testid="file-to-project">
      <div className="text-sm font-medium">File to project</div>
      <div className="text-xs text-muted-foreground">Moves this capture into a project as a task.</div>
      <div className="flex gap-2">
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="h-9 flex-1 min-w-0 rounded-md border border-input bg-background px-2 text-sm"
          aria-label="Project"
          data-testid="select-file-to-project"
        >
          <option value="">Choose a project…</option>
          {options.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <Button size="sm" disabled={!projectId || busy} onClick={file} data-testid="button-file-to-project">
          <FolderInput className="h-4 w-4 mr-1" /> File
        </Button>
      </div>
    </div>
  );
}
