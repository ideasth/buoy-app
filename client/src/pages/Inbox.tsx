import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Mail, Check, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { InboxScanItem } from "@shared/schema";

interface SuggestedAction {
  kind?: string;
  title?: string;
  due?: string | null;
  domain?: string | null;
  estimateMinutes?: number;
  notes?: string | null;
  list?: string | null;
}

function parseSuggestion(raw: string | null): SuggestedAction {
  try {
    const obj = JSON.parse(raw ?? "{}");
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}

export default function Inbox() {
  const { toast } = useToast();
  const q = useQuery<InboxScanItem[]>({ queryKey: ["/api/inbox/suggestions"] });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/inbox/suggestions"] });
    queryClient.invalidateQueries({ queryKey: ["/api/inbox/count"] });
    queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
  };

  const approve = async (id: number) => {
    try {
      await apiRequest("POST", `/api/inbox/suggestions/${id}/approve`);
      toast({ title: "Task created" });
      refresh();
    } catch (err) {
      toast({ title: "Approve failed", description: String(err), variant: "destructive" });
    }
  };
  const dismiss = async (id: number) => {
    try {
      await apiRequest("POST", `/api/inbox/suggestions/${id}/dismiss`);
      refresh();
    } catch (err) {
      toast({ title: "Dismiss failed", description: String(err), variant: "destructive" });
    }
  };

  const items = q.data ?? [];

  return (
    <div className="px-5 md:px-8 py-8 md:py-10 max-w-3xl space-y-6">
      <header>
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Inbox</div>
        <h1 className="text-2xl font-semibold mt-1">Suggestions from your email.</h1>
        <p className="text-sm text-muted-foreground mt-1">
          The orchestrator reads incoming mail for booking-like cues. Approve to turn into a task.
        </p>
      </header>

      {q.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {!q.isLoading && items.length === 0 && (
        <div className="rounded-md border border-dashed border-border p-8 text-center">
          <Mail className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
          <div className="text-sm font-medium">No pending suggestions</div>
          <div className="text-xs text-muted-foreground mt-1">
            New email-derived suggestions appear here for review.
          </div>
        </div>
      )}

      <div className="space-y-3">
        {items.map((it) => {
          const sug = parseSuggestion(it.suggestedAction);
          return (
            <div
              key={it.id}
              className="rounded-lg border bg-card p-4 space-y-2"
              data-testid={`row-inbox-${it.id}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">
                    {sug.title || it.subject || "(untitled)"}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {it.fromAddress ? <span>{it.fromAddress} · </span> : null}
                    {it.subject ? <span className="truncate">{it.subject}</span> : null}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => dismiss(it.id)}
                    data-testid={`button-dismiss-${it.id}`}
                  >
                    <X className="h-3.5 w-3.5 mr-1" />
                    Dismiss
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => approve(it.id)}
                    data-testid={`button-approve-${it.id}`}
                  >
                    <Check className="h-3.5 w-3.5 mr-1" />
                    Approve
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                {sug.kind && <span className="rounded-full bg-muted px-2 py-0.5">{sug.kind}</span>}
                {sug.domain && (
                  <span className="rounded-full bg-muted px-2 py-0.5">{sug.domain}</span>
                )}
                {sug.due && (
                  <span className="rounded-full bg-muted px-2 py-0.5">due {sug.due}</span>
                )}
                {sug.estimateMinutes && (
                  <span className="rounded-full bg-muted px-2 py-0.5">
                    {sug.estimateMinutes}m
                  </span>
                )}
              </div>
              {sug.notes && (
                <div className="text-xs text-muted-foreground/80 whitespace-pre-wrap">
                  {sug.notes}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
