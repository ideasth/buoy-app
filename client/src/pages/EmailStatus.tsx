import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { EmailStatusRow } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ChevronDown, ChevronRight, Copy, ExternalLink, Flag, X, Mail } from "lucide-react";

function fmtDate(ms: number): string {
  try {
    return new Intl.DateTimeFormat("en-AU", {
      timeZone: "Australia/Melbourne",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString();
  }
}

export default function EmailStatus() {
  const { toast } = useToast();
  const [showDismissed, setShowDismissed] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [drafts, setDrafts] = useState<Record<number, string>>({});

  const q = useQuery<EmailStatusRow[]>({
    queryKey: ["/api/email-status", showDismissed],
    queryFn: async () =>
      (await apiRequest(
        "GET",
        `/api/email-status${showDismissed ? "?includeDismissed=1" : ""}`,
      )).json(),
  });

  const rows = useMemo(() => q.data ?? [], [q.data]);

  const toggle = (id: number) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  };

  const dismiss = async (id: number) => {
    await apiRequest("PATCH", `/api/email-status/${id}`, { status: "dismissed" });
    queryClient.invalidateQueries({ queryKey: ["/api/email-status"] });
    toast({ title: "Dismissed" });
  };

  const saveDraft = async (id: number) => {
    const v = drafts[id];
    if (typeof v !== "string") return;
    await apiRequest("PATCH", `/api/email-status/${id}`, { draftResponse: v });
    queryClient.invalidateQueries({ queryKey: ["/api/email-status"] });
    toast({ title: "Draft saved" });
  };

  const copyDraft = async (text: string | null) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Copied to clipboard" });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  return (
    <div className="px-5 md:px-8 py-8 md:py-10 space-y-6">
      <header>
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Email status</div>
        <h1 className="text-2xl font-semibold mt-1">Unanswered, high-priority.</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Flagged or high-importance emails with no reply from you yet. Edit the drafted response, then copy + send from Outlook.
        </p>
      </header>

      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {q.isLoading ? "Loading…" : `${rows.length} email${rows.length === 1 ? "" : "s"}`}
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setShowDismissed((v) => !v)}
          data-testid="button-toggle-dismissed"
        >
          {showDismissed ? "Hide dismissed" : "Show dismissed"}
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="text-sm text-muted-foreground italic rounded-lg border border-dashed border-border p-8 text-center">
          <Mail className="h-5 w-5 mx-auto mb-2 opacity-50" />
          No unanswered priority emails. The hourly sync will populate this list.
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="hidden md:grid grid-cols-[140px_1fr_2fr_140px] gap-4 px-4 py-2 text-xs uppercase tracking-wider text-muted-foreground bg-muted/30 border-b border-border">
            <div>Date</div>
            <div>Sender</div>
            <div>Subject</div>
            <div className="text-right">Actions</div>
          </div>
          <div className="divide-y divide-border">
            {rows.map((r) => {
              const isOpen = expanded.has(r.id);
              const draft = drafts[r.id] ?? r.draftResponse ?? "";
              const isDismissed = r.status === "dismissed";
              return (
                <div key={r.id} className={isDismissed ? "opacity-60" : ""} data-testid={`email-row-${r.id}`}>
                  <button
                    type="button"
                    onClick={() => toggle(r.id)}
                    className="w-full grid grid-cols-1 md:grid-cols-[140px_1fr_2fr_140px] gap-2 md:gap-4 px-4 py-3 text-left hover-elevate active-elevate-2"
                    data-testid={`email-toggle-${r.id}`}
                  >
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      {fmtDate(r.receivedAt)}
                    </div>
                    <div className="text-sm font-medium truncate">{r.sender}</div>
                    <div className="text-sm truncate flex items-center gap-2">
                      {r.isFlagged ? <Flag className="h-3 w-3 text-orange-500 shrink-0" /> : null}
                      {r.importance === "high" ? (
                        <Badge variant="outline" className="text-[10px] py-0 h-4 shrink-0">high</Badge>
                      ) : null}
                      <span className="truncate">{r.subject || "(no subject)"}</span>
                    </div>
                    <div className="hidden md:flex justify-end items-center gap-1">
                      {r.status === "replied" ? (
                        <Badge variant="outline" className="text-[10px]">replied</Badge>
                      ) : isDismissed ? (
                        <Badge variant="outline" className="text-[10px]">dismissed</Badge>
                      ) : (
                        <Badge className="text-[10px]">pending</Badge>
                      )}
                    </div>
                  </button>

                  {isOpen && (
                    <div className="px-4 pb-4 pt-0 space-y-3 bg-muted/10">
                      {r.bodyPreview && (
                        <div>
                          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Body preview</div>
                          <div className="text-sm whitespace-pre-wrap text-muted-foreground rounded border border-border bg-background px-3 py-2">
                            {r.bodyPreview}
                          </div>
                        </div>
                      )}
                      <div>
                        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                          Drafted response{r.draftGeneratedAt ? ` · generated ${fmtDate(r.draftGeneratedAt)}` : ""}
                        </div>
                        <Textarea
                          value={draft}
                          onChange={(e) => setDrafts({ ...drafts, [r.id]: e.target.value })}
                          placeholder="No draft yet — the cron will generate one. Edit freely."
                          className="min-h-[140px] text-sm font-mono"
                          data-testid={`draft-${r.id}`}
                        />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          onClick={() => saveDraft(r.id)}
                          disabled={drafts[r.id] === undefined}
                          data-testid={`button-save-draft-${r.id}`}
                        >
                          Save draft
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => copyDraft(draft)}
                          disabled={!draft}
                          data-testid={`button-copy-draft-${r.id}`}
                        >
                          <Copy className="h-3 w-3 mr-1" />
                          Copy
                        </Button>
                        {r.webLink && (
                          <Button
                            size="sm"
                            variant="outline"
                            asChild
                            data-testid={`button-open-${r.id}`}
                          >
                            <a href={r.webLink} target="_blank" rel="noreferrer">
                              <ExternalLink className="h-3 w-3 mr-1" />
                              Open in Outlook
                            </a>
                          </Button>
                        )}
                        {!isDismissed && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => dismiss(r.id)}
                            className="ml-auto text-muted-foreground"
                            data-testid={`button-dismiss-${r.id}`}
                          >
                            <X className="h-3 w-3 mr-1" />
                            Dismiss
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
