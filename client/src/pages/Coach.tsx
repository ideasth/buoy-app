// Feature 5 — Coach page.
//
// Plan / Reflect chat with Sonar. Streams assistant replies via SSE, surfaces
// the context bundle in a collapsible rail, lets the user edit the draft
// summary, delete a session, and confirm anchor-action side-effects.

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient, buildApiUrl, buildAuthHeaders } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { ChevronRight, ChevronDown, Trash2, Plus, Send, AlertTriangle } from "lucide-react";

// -- Types ------------------------------------------------------------------

type Mode = "plan" | "reflect";

interface CoachSessionRow {
  id: number;
  startedAt: number;
  endedAt: number | null;
  mode: Mode;
  linkedIssueId: number | null;
  linkedYmd: string | null;
  modelName: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  summaryPreview: string | null;
  messageCount: number;
  deepThink?: number;
  archivedAt?: number | null;
}

interface CoachMessageRow {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: number;
  modeAtTurn: Mode;
  tokenCount: number | null;
}

interface CoachSessionDetail {
  id: number;
  startedAt: number;
  endedAt: number | null;
  mode: Mode;
  linkedIssueId: number | null;
  linkedYmd: string | null;
  modelProvider: string;
  modelName: string;
  summary: string | null;
  summaryEditedByUser: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  contextSnapshot: any;
  deepThink?: number;
  archivedAt?: number | null;
}

interface HealthResponse {
  available: boolean;
  provider: string;
  models: { plan: string; planDeepThink?: string; reflect: string };
}

// -- Anchor-action detection ------------------------------------------------

interface AnchorAction {
  kind:
    | "top3_candidate"
    | "issue_patch"
    | "repeat_last_top3"
    | "swap_in_underworked_project"
    | string;
  payload: any;
  raw: string;
}

function extractAnchorActions(text: string): AnchorAction[] {
  if (!text) return [];
  const out: AnchorAction[] = [];
  const re = /```anchor-action\s*\n([\s\S]*?)\n```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    try {
      const obj = JSON.parse(m[1]);
      if (obj && typeof obj === "object" && typeof obj.kind === "string") {
        out.push({ kind: obj.kind, payload: obj, raw: m[0] });
      }
    } catch {
      // Skip malformed action blocks silently.
    }
  }
  return out;
}

function stripAnchorActions(text: string): string {
  return text.replace(/```anchor-action\s*\n[\s\S]*?\n```/g, "").trim();
}

// -- SSE parser -------------------------------------------------------------

interface SseEvent {
  event: string;
  data: string;
}

async function* readSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8");
  let buf = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const lines = chunk.split("\n");
        let event = "message";
        const dataLines: string[] = [];
        for (const ln of lines) {
          if (ln.startsWith("event:")) event = ln.slice(6).trim();
          else if (ln.startsWith("data:")) dataLines.push(ln.slice(5).trim());
        }
        if (dataLines.length) yield { event, data: dataLines.join("\n") };
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// -- Helpers ----------------------------------------------------------------

function fmtTime(ts: number | null | undefined): string {
  if (!ts) return "";
  try {
    return new Date(ts * 1000).toLocaleString("en-AU", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "";
  }
}

// -- Main page --------------------------------------------------------------

export default function Coach() {
  const { toast } = useToast();
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>("plan");
  const [deepThink, setDeepThink] = useState<boolean>(false);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [streamingCrisis, setStreamingCrisis] = useState(false);
  const [contextRailOpen, setContextRailOpen] = useState(false);
  const [summaryModalOpen, setSummaryModalOpen] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState("");
  // Bundle preview shown after POST /sessions returns. The session row exists
  // server-side at this point; we only activate it after the user confirms.
  const [pendingSession, setPendingSession] = useState<
    | { id: number; mode: Mode; bundle: any }
    | null
  >(null);
  // Coach session search (FTS5 over summaries).
  const [searchQ, setSearchQ] = useState("");
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const healthQ = useQuery<HealthResponse>({ queryKey: ["/api/coach/health"] });
  const sessionsQ = useQuery<{ sessions: CoachSessionRow[] }>({
    queryKey: ["/api/coach/sessions"],
  });
  const searchTrim = searchQ.trim();
  const searchActive = searchTrim.length >= 2;
  const searchQueryUrl = `/api/coach/sessions/search?q=${encodeURIComponent(searchTrim)}`;
  const searchQ_ = useQuery<{
    q: string;
    hits: Array<{
      id: number;
      mode: string;
      startedAt: number;
      archivedAt: number | null;
      summarySnippet: string;
    }>;
  }>({
    queryKey: [searchQueryUrl],
    enabled: searchActive,
  });

  const detailQ = useQuery<{
    session: CoachSessionDetail;
    messages: CoachMessageRow[];
  }>({
    queryKey: activeSessionId
      ? ["/api/coach/sessions", String(activeSessionId)]
      : ["/api/coach/no-session"],
    enabled: !!activeSessionId,
  });

  const session = detailQ.data?.session ?? null;
  const messages = detailQ.data?.messages ?? [];
  const bundle = session?.contextSnapshot ?? null;

  useEffect(() => {
    // Auto-scroll on new messages or streaming chunks.
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streamingText]);

  useEffect(() => {
    if (session) {
      setMode(session.mode);
      setDeepThink((session.deepThink ?? 0) === 1);
    }
  }, [session?.id]);

  async function startSession(initialMode: Mode) {
    if (!healthQ.data?.available) {
      toast({
        title: "Coach unavailable",
        description: "Perplexity API key not configured on this server.",
        variant: "destructive",
      });
      return;
    }
    try {
      const res = await apiRequest("POST", "/api/coach/sessions", {
        mode: initialMode,
        deepThink: initialMode === "plan" ? deepThink : false,
      });
      const data = await res.json();
      const id = data?.session?.id;
      if (typeof id === "number") {
        // Show the context bundle preview before activating. The user can
        // confirm (start chatting) or cancel (delete the just-created session).
        setPendingSession({ id, mode: initialMode, bundle: data.bundle ?? null });
        await queryClient.invalidateQueries({ queryKey: ["/api/coach/sessions"] });
      }
    } catch (e: any) {
      toast({
        title: "Could not start session",
        description: String(e?.message ?? e),
        variant: "destructive",
      });
    }
  }

  async function changeMode(newMode: Mode) {
    if (!session || newMode === session.mode) {
      setMode(newMode);
      return;
    }
    try {
      await apiRequest("PATCH", `/api/coach/sessions/${session.id}`, { mode: newMode });
      setMode(newMode);
      await queryClient.invalidateQueries({
        queryKey: ["/api/coach/sessions", String(session.id)],
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/coach/sessions"] });
    } catch (e: any) {
      toast({ title: "Mode change failed", description: String(e?.message ?? e) });
    }
  }

  async function toggleDeepThink(next: boolean) {
    setDeepThink(next);
    if (!session) return;
    try {
      await apiRequest("PATCH", `/api/coach/sessions/${session.id}`, { deepThink: next });
      await queryClient.invalidateQueries({
        queryKey: ["/api/coach/sessions", String(session.id)],
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/coach/sessions"] });
    } catch (e: any) {
      toast({ title: "Deep-think toggle failed", description: String(e?.message ?? e) });
    }
  }

  async function archiveSession() {
    if (!session) return;
    if (!window.confirm(
      "Archive this session? The transcript will be removed but the summary is kept.\n\nThis cannot be undone.",
    )) return;
    try {
      await apiRequest("POST", `/api/coach/sessions/${session.id}/archive`, {});
      await queryClient.invalidateQueries({
        queryKey: ["/api/coach/sessions", String(session.id)],
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/coach/sessions"] });
      toast({ title: "Session archived" });
    } catch (e: any) {
      toast({ title: "Archive failed", description: String(e?.message ?? e), variant: "destructive" });
    }
  }

  async function sendTurn() {
    if (!session || streaming) return;
    const content = draft.trim();
    if (!content) return;
    setDraft("");
    setStreamingText("");
    setStreamingCrisis(false);
    setStreaming(true);

    try {
      const res = await fetch(buildApiUrl(`/api/coach/sessions/${session.id}/turn`), {
        method: "POST",
        headers: buildAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ content }),
        credentials: "omit",
      });
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        throw new Error(`${res.status}: ${text}`);
      }
      let acc = "";
      for await (const ev of readSse(res.body)) {
        if (ev.event === "delta") {
          try {
            const obj = JSON.parse(ev.data);
            if (typeof obj.text === "string") {
              acc += obj.text;
              setStreamingText(acc);
            }
          } catch {}
        } else if (ev.event === "crisis") {
          setStreamingCrisis(true);
        } else if (ev.event === "error") {
          let msg = "Stream error";
          try {
            const obj = JSON.parse(ev.data);
            msg = obj.error || obj.message || msg;
          } catch {}
          toast({ title: "Coach error", description: msg, variant: "destructive" });
        } else if (ev.event === "done") {
          break;
        }
      }
    } catch (e: any) {
      toast({
        title: "Send failed",
        description: String(e?.message ?? e),
        variant: "destructive",
      });
    } finally {
      setStreaming(false);
      setStreamingText("");
      // Refresh transcript and session list.
      await queryClient.invalidateQueries({
        queryKey: ["/api/coach/sessions", String(session.id)],
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/coach/sessions"] });
    }
  }

  async function endSession() {
    if (!session) return;
    try {
      const res = await apiRequest("POST", `/api/coach/sessions/${session.id}/end`, {});
      const data = await res.json();
      const summary = data?.summary ?? data?.session?.summary ?? "";
      setSummaryDraft(typeof summary === "string" ? summary : "");
      setSummaryModalOpen(true);
      await queryClient.invalidateQueries({
        queryKey: ["/api/coach/sessions", String(session.id)],
      });
    } catch (e: any) {
      toast({
        title: "Could not generate summary",
        description: String(e?.message ?? e),
        variant: "destructive",
      });
    }
  }

  async function saveSummary() {
    if (!session) return;
    try {
      await apiRequest("PATCH", `/api/coach/sessions/${session.id}/summary`, {
        summary: summaryDraft,
      });
      setSummaryModalOpen(false);
      await queryClient.invalidateQueries({
        queryKey: ["/api/coach/sessions", String(session.id)],
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/coach/sessions"] });
      toast({ title: "Summary saved" });
    } catch (e: any) {
      toast({ title: "Save failed", description: String(e?.message ?? e) });
    }
  }

  async function deleteSession() {
    if (!session) return;
    if (!window.confirm("Delete this coach session? This cannot be undone.")) return;
    try {
      await apiRequest("DELETE", `/api/coach/sessions/${session.id}`, undefined);
      setActiveSessionId(null);
      await queryClient.invalidateQueries({ queryKey: ["/api/coach/sessions"] });
      toast({ title: "Session deleted" });
    } catch (e: any) {
      toast({ title: "Delete failed", description: String(e?.message ?? e) });
    }
  }

  async function applyAction(action: AnchorAction) {
    try {
      if (action.kind === "top3_candidate") {
        // Accept either {taskIds: [...]} (canonical) or legacy {items: [...]}.
        const date = action.payload.date || bundle?.todayYmd;
        const idsRaw: unknown = action.payload.taskIds ?? action.payload.items;
        if (!date || !Array.isArray(idsRaw)) {
          throw new Error("top3_candidate requires date + taskIds[]");
        }
        const ids = (idsRaw as any[])
          .map((v) => (typeof v === "number" ? v : typeof v?.taskId === "number" ? v.taskId : null))
          .filter((v): v is number => typeof v === "number")
          .slice(0, 3);
        await apiRequest("PUT", "/api/top-three", {
          date,
          taskId1: ids[0] ?? null,
          taskId2: ids[1] ?? null,
          taskId3: ids[2] ?? null,
        });
        toast({ title: "Top 3 updated" });
        await queryClient.invalidateQueries();
      } else if (action.kind === "issue_patch") {
        // Accept either {issueId, fields} (canonical) or legacy {id, patch}.
        const id = action.payload.issueId ?? action.payload.id;
        const patch = action.payload.fields ?? action.payload.patch;
        if (typeof id !== "number" || !patch) throw new Error("issue_patch requires issueId + fields");
        await apiRequest("PATCH", `/api/issues/${id}`, patch);
        toast({ title: "Issue updated" });
        await queryClient.invalidateQueries({ queryKey: ["/api/issues"] });
      } else if (action.kind === "repeat_last_top3") {
        // Set today's top-3 to the most recent locked top-3 in the bundle.
        const date = action.payload.date || bundle?.todayYmd;
        const history: any[] = bundle?.recentTopThreeHistory ?? [];
        if (!date || history.length === 0) {
          throw new Error("repeat_last_top3 needs todayYmd + recentTopThreeHistory");
        }
        const last = history[history.length - 1];
        const ids: number[] = [last?.slot1?.taskId, last?.slot2?.taskId, last?.slot3?.taskId]
          .filter((v): v is number => typeof v === "number");
        if (ids.length === 0) throw new Error("last top-3 has no task ids");
        await apiRequest("PUT", "/api/top-three", {
          date,
          taskId1: ids[0] ?? null,
          taskId2: ids[1] ?? null,
          taskId3: ids[2] ?? null,
        });
        toast({ title: "Top 3 set from last locked day", description: last.date });
        await queryClient.invalidateQueries();
      } else if (action.kind === "swap_in_underworked_project") {
        // Replace one of today's top-3 slots with a task from a priced project
        // that received <30 min of attention last week. Action payload may
        // optionally specify {slot: 1|2|3, projectId, taskId}; otherwise we
        // pick a sensible default.
        const date = action.payload.date || bundle?.todayYmd;
        const slot: number = [1, 2, 3].includes(action.payload.slot) ? action.payload.slot : 3;
        const taskId: number | null =
          typeof action.payload.taskId === "number" ? action.payload.taskId : null;
        if (!date || !taskId) {
          throw new Error("swap_in_underworked_project requires taskId");
        }
        const current = bundle?.todayTop3 ?? [];
        const slotKey = (n: number) => `taskId${n}` as "taskId1" | "taskId2" | "taskId3";
        const body: Record<string, number | string | null> = {
          date,
          taskId1: current.find((t: any) => t.slot === 1)?.taskId ?? null,
          taskId2: current.find((t: any) => t.slot === 2)?.taskId ?? null,
          taskId3: current.find((t: any) => t.slot === 3)?.taskId ?? null,
        };
        body[slotKey(slot)] = taskId;
        await apiRequest("PUT", "/api/top-three", body);
        toast({ title: `Swapped slot ${slot} for under-worked project` });
        await queryClient.invalidateQueries();
      } else {
        toast({ title: "Unknown action", description: action.kind });
      }
    } catch (e: any) {
      toast({
        title: "Action failed",
        description: String(e?.message ?? e),
        variant: "destructive",
      });
    }
  }

  async function confirmPendingSession() {
    if (!pendingSession) return;
    setActiveSessionId(pendingSession.id);
    setMode(pendingSession.mode);
    setStreamingText("");
    setStreamingCrisis(false);
    setDraft("");
    setPendingSession(null);
  }

  async function cancelPendingSession() {
    if (!pendingSession) return;
    const id = pendingSession.id;
    setPendingSession(null);
    try {
      await apiRequest("DELETE", `/api/coach/sessions/${id}`, undefined);
      await queryClient.invalidateQueries({ queryKey: ["/api/coach/sessions"] });
    } catch (e: any) {
      toast({
        title: "Could not delete pending session",
        description: String(e?.message ?? e),
        variant: "destructive",
      });
    }
  }

  // Render helpers
  const sessions = sessionsQ.data?.sessions ?? [];

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Coach</h1>
          <p className="text-sm text-muted-foreground">
            Plan or reflect with grounded context. Sonar by Perplexity.
            {healthQ.data && (
              <span className="ml-2 text-xs">
                ({healthQ.data.available ? "available" : "unavailable"} · {healthQ.data.provider})
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => startSession("plan")}
            disabled={streaming}
          >
            <Plus className="w-4 h-4 mr-1" /> Plan session
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => startSession("reflect")}
            disabled={streaming}
          >
            <Plus className="w-4 h-4 mr-1" /> Reflect session
          </Button>
        </div>
      </div>

      {!healthQ.data?.available && healthQ.isFetched && (
        <Card className="border-amber-300/60 bg-amber-50/60 dark:bg-amber-900/10">
          <CardContent className="pt-4 flex items-start gap-2 text-sm">
            <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-600 shrink-0" />
            <div>
              Coach is unavailable: Perplexity API key not configured. Bake the key into the
              server bundle and redeploy.
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
        {/* Session history rail */}
        <aside className="space-y-2">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Recent sessions
          </div>
          <input
            type="search"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="Search summaries..."
            className="w-full text-sm rounded-md border border-input bg-background px-2 py-1"
          />
          {searchActive && (
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {searchQ_.data?.hits?.length ?? 0} match
                {(searchQ_.data?.hits?.length ?? 0) === 1 ? "" : "es"}
                {searchQ_.isFetching ? " (searching...)" : ""}
              </div>
              <div className="flex lg:flex-col gap-2 overflow-x-auto">
                {(searchQ_.data?.hits ?? []).map((h) => (
                  <button
                    key={`hit-${h.id}`}
                    onClick={() => {
                      setActiveSessionId(h.id);
                      setSearchQ("");
                    }}
                    className={cn(
                      "text-left rounded-md border px-3 py-2 text-sm shrink-0 lg:shrink min-w-[220px]",
                      activeSessionId === h.id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-accent",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium capitalize">
                        {h.mode}
                        {h.archivedAt ? (
                          <span className="ml-1 text-[10px] uppercase tracking-wider text-muted-foreground border rounded px-1 py-0.5 align-middle">
                            archived
                          </span>
                        ) : null}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {fmtTime(h.startedAt)}
                      </span>
                    </div>
                    <div
                      className="text-xs text-muted-foreground line-clamp-3 mt-1"
                      dangerouslySetInnerHTML={{ __html: h.summarySnippet || "" }}
                    />
                  </button>
                ))}
              </div>
            </div>
          )}
          {!searchActive && sessions.length === 0 && (
            <div className="text-sm text-muted-foreground italic">No sessions yet.</div>
          )}
          {!searchActive && (
          <div className="flex lg:flex-col gap-2 overflow-x-auto">
            {sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => setActiveSessionId(s.id)}
                className={cn(
                  "text-left rounded-md border px-3 py-2 text-sm shrink-0 lg:shrink min-w-[220px]",
                  activeSessionId === s.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-accent",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium capitalize">
                    {s.mode}
                    {s.archivedAt ? (
                      <span className="ml-1 text-[10px] uppercase tracking-wider text-muted-foreground border rounded px-1 py-0.5 align-middle">
                        archived
                      </span>
                    ) : null}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {fmtTime(s.startedAt)}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground line-clamp-2 mt-1">
                  {s.summaryPreview || `${s.messageCount} message${s.messageCount === 1 ? "" : "s"}`}
                </div>
              </button>
            ))}
          </div>
          )}
        </aside>

        {/* Chat column */}
        <main className="space-y-3 min-w-0">
          {!session && (
            <Card>
              <CardContent className="pt-6 text-sm text-muted-foreground">
                Pick a session from the rail or start a new Plan or Reflect session.
              </CardContent>
            </Card>
          )}

          {session && (
            <>
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <CardTitle className="text-base">
                      {session.mode === "plan" ? "Plan" : "Reflect"} ·{" "}
                      <span className="font-mono text-xs text-muted-foreground">
                        {session.modelName}
                      </span>
                      {session.archivedAt ? (
                        <span className="ml-2 text-[10px] uppercase tracking-wider text-muted-foreground border rounded px-1 py-0.5 align-middle">
                          archived
                        </span>
                      ) : null}
                    </CardTitle>
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="inline-flex rounded-md border overflow-hidden">
                        <button
                          className={cn(
                            "px-3 py-1 text-xs",
                            mode === "plan"
                              ? "bg-primary text-primary-foreground"
                              : "hover:bg-accent",
                          )}
                          onClick={() => changeMode("plan")}
                          disabled={streaming || !!session.archivedAt}
                        >
                          Plan
                        </button>
                        <button
                          className={cn(
                            "px-3 py-1 text-xs border-l",
                            mode === "reflect"
                              ? "bg-primary text-primary-foreground"
                              : "hover:bg-accent",
                          )}
                          onClick={() => changeMode("reflect")}
                          disabled={streaming || !!session.archivedAt}
                        >
                          Reflect
                        </button>
                      </div>
                      {mode === "plan" && !session.archivedAt && (
                        <label
                          className="inline-flex items-center gap-1.5 text-xs select-none cursor-pointer"
                          title="Routes plan turns to sonar-reasoning-pro (slower, deeper). Default off."
                        >
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5"
                            checked={deepThink}
                            onChange={(e) => toggleDeepThink(e.target.checked)}
                            disabled={streaming}
                          />
                          Deep think
                        </label>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={endSession}
                        disabled={streaming || !!session.archivedAt}
                      >
                        End / summarise
                      </Button>
                      {!session.archivedAt && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={archiveSession}
                          disabled={streaming}
                          title="Archive: drop transcript, keep summary"
                        >
                          Archive
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={deleteSession}
                        disabled={streaming}
                        title="Delete this session"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <button
                    type="button"
                    className="text-xs flex items-center gap-1 text-muted-foreground hover:text-foreground"
                    onClick={() => setContextRailOpen((v) => !v)}
                  >
                    {contextRailOpen ? (
                      <ChevronDown className="w-3 h-3" />
                    ) : (
                      <ChevronRight className="w-3 h-3" />
                    )}
                    Context bundle
                  </button>
                  {contextRailOpen && bundle && (
                    <pre className="mt-2 max-h-96 overflow-auto text-xs bg-muted/40 rounded-md p-3 whitespace-pre-wrap break-words">
                      {JSON.stringify(bundle, null, 2)}
                    </pre>
                  )}
                  {session.summary && (
                    <div className="mt-3 rounded-md border border-dashed p-3 text-sm">
                      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                        Summary {session.summaryEditedByUser ? "(edited)" : "(draft)"}
                      </div>
                      <div className="whitespace-pre-wrap">{session.summary}</div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="mt-2 h-7 text-xs"
                        onClick={() => {
                          setSummaryDraft(session.summary || "");
                          setSummaryModalOpen(true);
                        }}
                      >
                        Edit summary
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Transcript */}
              <Card>
                <CardContent className="pt-4 space-y-3 max-h-[60vh] overflow-y-auto">
                  {messages.length === 0 && !streamingText && (
                    <div className="text-sm text-muted-foreground italic">
                      No messages yet — say what's on your mind.
                    </div>
                  )}
                  {messages
                    .filter((m) => m.role !== "system")
                    .map((m) => (
                      <MessageBubble
                        key={m.id}
                        role={m.role}
                        content={m.content}
                        onApplyAction={applyAction}
                      />
                    ))}
                  {streaming && streamingText && (
                    <MessageBubble
                      role="assistant"
                      content={streamingText}
                      streaming
                      crisis={streamingCrisis}
                    />
                  )}
                  <div ref={messagesEndRef} />
                </CardContent>
              </Card>

              {/* Composer */}
              <Card>
                <CardContent className="pt-4">
                  {session.archivedAt ? (
                    <div className="text-sm text-muted-foreground italic">
                      Session archived — transcript dropped, summary kept. Start a new session to continue.
                    </div>
                  ) : (
                    <>
                      <Textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder={
                          mode === "plan"
                            ? "What do you want to plan? (e.g. 'help me pick a top 3 for tomorrow')"
                            : "What are you reflecting on?"
                        }
                        rows={3}
                        disabled={streaming}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                            e.preventDefault();
                            sendTurn();
                          }
                        }}
                      />
                      <div className="flex items-center justify-between mt-2">
                        <div className="text-xs text-muted-foreground">
                          Cmd/Ctrl+Enter to send. Crisis terms route to Lifeline 13 11 14.
                        </div>
                        <Button onClick={sendTurn} disabled={streaming || !draft.trim()} size="sm">
                          <Send className="w-4 h-4 mr-1" />
                          {streaming ? "Streaming..." : "Send"}
                        </Button>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </main>
      </div>

      <Dialog
        open={!!pendingSession}
        onOpenChange={(open) => {
          if (!open) cancelPendingSession();
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Context bundle for new {pendingSession?.mode === "reflect" ? "Reflect" : "Plan"} session
            </DialogTitle>
          </DialogHeader>
          {pendingSession?.bundle ? (
            <BundlePreview bundle={pendingSession.bundle} />
          ) : (
            <div className="text-sm text-muted-foreground italic">
              No bundle returned by server.
            </div>
          )}
          <DialogFooter className="sm:justify-between gap-2">
            <Button variant="ghost" onClick={cancelPendingSession}>
              Cancel & delete session
            </Button>
            <Button onClick={confirmPendingSession}>Looks right — start chatting</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={summaryModalOpen} onOpenChange={setSummaryModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Session summary</DialogTitle>
          </DialogHeader>
          <Textarea
            value={summaryDraft}
            onChange={(e) => setSummaryDraft(e.target.value)}
            rows={10}
            className="font-mono text-sm"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSummaryModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveSummary}>Save summary</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// -- Message bubble ---------------------------------------------------------

interface MessageBubbleProps {
  role: "user" | "assistant" | "system";
  content: string;
  streaming?: boolean;
  crisis?: boolean;
  onApplyAction?: (a: AnchorAction) => void;
}

function MessageBubble({ role, content, streaming, crisis, onApplyAction }: MessageBubbleProps) {
  const actions = useMemo(() => extractAnchorActions(content), [content]);
  const visibleText = useMemo(
    () => (actions.length ? stripAnchorActions(content) : content),
    [content, actions.length],
  );
  const isUser = role === "user";
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words",
          isUser
            ? "bg-primary text-primary-foreground"
            : crisis
              ? "bg-red-50 dark:bg-red-950/30 border border-red-300 text-foreground"
              : "bg-muted",
        )}
      >
        {crisis && (
          <div className="flex items-center gap-1 mb-1 text-xs font-semibold text-red-700 dark:text-red-300">
            <AlertTriangle className="w-3 h-3" /> Crisis support
          </div>
        )}
        {visibleText}
        {streaming && <span className="inline-block w-1.5 h-4 align-middle bg-current opacity-60 ml-0.5 animate-pulse" />}
        {!isUser && actions.length > 0 && onApplyAction && (
          <div className="mt-2 flex flex-col gap-1">
            {actions.map((a, i) => (
              <div
                key={i}
                className="rounded border border-dashed bg-background/60 p-2 text-xs flex items-center justify-between gap-2"
              >
                <code className="truncate">
                  {a.kind}
                  {a.kind === "issue_patch" && a.payload.id ? ` #${a.payload.id}` : ""}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-xs"
                  onClick={() => onApplyAction(a)}
                >
                  Apply
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// -- Bundle preview ---------------------------------------------------------

interface BundlePreviewProps {
  bundle: any;
}

function BundlePreview({ bundle }: BundlePreviewProps) {
  if (!bundle) return null;
  const top3: any[] = bundle.todayTop3 ?? [];
  const avail = bundle.availableHoursThisWeek ?? null;
  const events: any[] = bundle.upcomingEvents ?? [];
  const lastWeek: any[] = bundle.lastWeekTimeSpentPerProject ?? [];
  const top3History: any[] = bundle.recentTopThreeHistory ?? [];
  const issues: any[] = bundle.openIssues ?? [];

  return (
    <div className="space-y-3 max-h-[60vh] overflow-y-auto text-sm">
      <Section label={`Today's top 3 (${bundle.todayYmd ?? ""})`}>
        {top3.length === 0 ? (
          <Empty text="No top-3 set." />
        ) : (
          <ul className="list-decimal list-inside space-y-0.5">
            {top3.map((t) => (
              <li key={t.taskId}>
                <span className="font-medium">{t.name}</span>{" "}
                <span className="text-xs text-muted-foreground">({t.status})</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section label="Available hours this week">
        {avail ? (
          <div className="text-xs">
            <span className="font-mono">{avail.freeHours.toFixed(1)}h</span> free /{" "}
            <span className="font-mono">{avail.bookedHours.toFixed(1)}h</span> booked /{" "}
            <span className="font-mono">{avail.totalHours.toFixed(1)}h</span> total
          </div>
        ) : (
          <Empty text="Not computed." />
        )}
      </Section>

      <Section label="Today + tomorrow events">
        {events.length === 0 ? (
          <Empty text="No timed events." />
        ) : (
          <ul className="space-y-0.5 text-xs">
            {events.slice(0, 12).map((e, i) => (
              <li key={i} className="font-mono">
                <span className="text-muted-foreground">{e.date}</span>{" "}
                {new Date(e.start).toLocaleTimeString("en-AU", {
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                })}
                {" "}— <span className="font-sans">{e.summary}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section label="Last week — time per priced project">
        {lastWeek.length === 0 ? (
          <Empty text="No matched events." />
        ) : (
          <ul className="space-y-0.5 text-xs">
            {lastWeek.slice(0, 8).map((p) => (
              <li key={p.projectId}>
                <span className="font-mono">{(p.minutes / 60).toFixed(1)}h</span>{" "}
                <span>{p.name}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section label="Recent top-3 history">
        {top3History.length === 0 ? (
          <Empty text="No history." />
        ) : (
          <ul className="space-y-0.5 text-xs">
            {top3History.slice(-5).map((h, i) => {
              const items = [h.slot1, h.slot2, h.slot3]
                .filter(Boolean)
                .map((x: any) => x.name)
                .join(" · ");
              return (
                <li key={i}>
                  <span className="font-mono text-muted-foreground">{h.date}</span>{" "}
                  {items || <span className="italic text-muted-foreground">empty</span>}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section label="Open issues">
        {issues.length === 0 ? (
          <Empty text="None open." />
        ) : (
          <ul className="space-y-0.5 text-xs">
            {issues.slice(0, 8).map((i) => (
              <li key={i.id}>
                <span className="font-mono text-muted-foreground">#{i.id}</span>{" "}
                <span>{i.note ?? i.category}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
        {label}
      </div>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="text-xs italic text-muted-foreground">{text}</div>;
}
