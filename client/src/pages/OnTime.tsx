// filepath: /home/user/workspace/anchor/client/src/pages/OnTime.tsx
// Stage 25 — On Time. Leave-by cues to phone + watch (ntfy), daily routine
// nudges, 06:30 "Today" alert, Running late SMS. Everything stays off until
// the master switch is turned on.

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Bell, Clock, MessageSquare, Plus, Send, Trash2 } from "lucide-react";

type RoutineCue = { id: string; days: number[]; time: string; title: string; firstStep?: string; enabled: boolean };
type Config = {
  enabled: boolean; bufferMinutes: number; getReadyLeadMinutes: number; wrapUpLeadMinutes: number;
  noTravelLeadMinutes: number; escalateAfterMinutes: number; snoozeMinutes: number; maxSnoozes: number;
  quietStart: string; quietEnd: string; digestTime: string; digestEnabled: boolean; privacyLabels: boolean;
  lateMessage: string; ignoreKeywords: string[]; ntfyBaseUrl: string; ntfyTopic: string; publicBaseUrl: string;
  emailEnabled: boolean; emailPollMinutes: number; emailNudges: boolean; flagSyncEnabled: boolean; mailFilingEnabled: boolean; staleNudgeEnabled: boolean; staleNudgeTime: string; staleNudgeDays: number; staleNudgeDay: number; ollamaUrl: string; ollamaModel: string;
  routine: RoutineCue[];
};
type Cue = { key: string; kind: string; fireAt: number; title: string; body: string; priority: number };
type Status = {
  enabled: boolean; emailEnabled: boolean; ntfyConfigured: boolean; ntfyTokenPresent: boolean; graphCredsPresent: boolean;
  triageQueued: number; triageCounts: Record<string, number>;
  engine: { lastPlanAt: number | null; lastPlanError: string | null; lastSendAt: number | null; lastSendError: string | null;
    lastMailPollAt: number | null; lastMailError: string | null };
};

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const KIND_LABEL: Record<string, string> = {
  get_ready: "Get ready", wrap_up: "Wrap up", leave_now: "Leave now", starts_soon: "Starts soon",
  routine: "Routine", digest: "Today", email: "Email",
};

type SchedItem = { uid: string; kind: "session" | "appointment"; title: string; startMs: number; endMs: number; location: string | null };
const fmtTime = (ms: number) =>
  new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ms));
const fmtDay = (ms: number) =>
  new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", weekday: "long", day: "numeric", month: "short" }).format(new Date(ms));
const fmtAgo = (ms: number | null) => (ms ? `${fmtDay(ms)} ${fmtTime(ms)}` : "never");

function smsLink(msg: string, mins: number) {
  return `sms:&body=${encodeURIComponent(msg.replace(/\{mins\}/g, String(mins)))}`;
}

export default function OnTime() {
  const { toast } = useToast();
  const cfgQ = useQuery<{ config: Config; ntfyTokenPresent: boolean; graphCredsPresent: boolean }>({
    queryKey: ["/api/ontime/config"],
    queryFn: async () => (await apiRequest("GET", "/api/ontime/config")).json(),
  });
  const statusQ = useQuery<Status>({
    queryKey: ["/api/ontime/status"],
    queryFn: async () => (await apiRequest("GET", "/api/ontime/status")).json(),
    refetchInterval: 30_000,
  });
  const previewQ = useQuery<{ cues: Cue[]; schedule?: SchedItem[] }>({
    queryKey: ["/api/ontime/preview"],
    queryFn: async () => (await apiRequest("GET", "/api/ontime/preview?days=2")).json(),
  });

  const [draft, setDraft] = useState<Config | null>(null);
  const [lateMins, setLateMins] = useState(10);
  useEffect(() => { if (cfgQ.data && !draft) setDraft(cfgQ.data.config); }, [cfgQ.data, draft]);

  const byDay = useMemo(() => {
    // Stage 34c — each day: cues, then that day's Elgin sessions/appointments.
    const map = new Map<string, { day: string; sort: number; cues: Cue[]; sched: SchedItem[] }>();
    const slot = (ms: number) => {
      const d = fmtDay(ms);
      return map.get(d) ?? map.set(d, { day: d, sort: ms, cues: [], sched: [] }).get(d)!;
    };
    for (const c of previewQ.data?.cues ?? []) slot(c.fireAt).cues.push(c);
    for (const s of previewQ.data?.schedule ?? []) slot(s.startMs).sched.push(s);
    return Array.from(map.values()).sort((a, b) => a.sort - b.sort);
  }, [previewQ.data]);

  const refreshAll = () => {
    for (const k of ["/api/ontime/config", "/api/ontime/status", "/api/ontime/preview"]) {
      queryClient.invalidateQueries({ queryKey: [k] });
    }
  };

  const save = async (patch?: Partial<Config>) => {
    const body = patch ?? draft;
    if (!body) return;
    try {
      const r = await (await apiRequest("PUT", "/api/ontime/config", body)).json();
      setDraft(patch ? { ...draft!, ...patch, enabled: r.config.enabled } : r.config);
      refreshAll();
      toast({ title: "Saved" });
    } catch (e) {
      toast({ title: "Save failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const sendTest = async () => {
    try {
      await apiRequest("POST", "/api/ontime/test");
      toast({ title: "Test sent", description: "Check your phone and watch." });
    } catch (e) {
      toast({ title: "Test failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  if (!draft) return <div className="px-5 md:px-8 py-8 text-sm text-muted-foreground">Loading…</div>;
  const set = <K extends keyof Config>(k: K, v: Config[K]) => setDraft({ ...draft, [k]: v });
  const setRoutine = (i: number, patch: Partial<RoutineCue>) =>
    set("routine", draft.routine.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const st = statusQ.data;
  const num = (k: keyof Config, label: string, hint?: string) => (
    <label className="text-sm space-y-1">
      <div className="font-medium">{label}</div>
      <Input type="number" value={String(draft[k] as number)} onChange={(e) => set(k, Number(e.target.value) as any)} data-testid={`input-${String(k)}`} />
      {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
    </label>
  );
  const time = (k: keyof Config, label: string) => (
    <label className="text-sm space-y-1">
      <div className="font-medium">{label}</div>
      <Input type="time" value={draft[k] as string} onChange={(e) => set(k, e.target.value as any)} data-testid={`input-${String(k)}`} />
    </label>
  );
  const toggle = (k: keyof Config, label: string, hint?: string) => (
    <div className="flex items-start gap-3">
      <Switch checked={Boolean(draft[k])} onCheckedChange={(v) => set(k, v as any)} id={`sw-${String(k)}`} data-testid={`switch-${String(k)}`} />
      <div>
        <Label htmlFor={`sw-${String(k)}`} className="text-sm font-medium">{label}</Label>
        {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
      </div>
    </div>
  );

  return (
    <div className="px-5 md:px-8 py-8 md:py-10 space-y-8 max-w-4xl">
      <header>
        <div className="text-xs uppercase tracking-wider text-muted-foreground">On Time</div>
        <h1 className="text-2xl font-semibold mt-1">Leave on time, without thinking about it.</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Buoy works out when you need to leave and taps your phone and watch: get ready, wrap up, leave now.
        </p>
      </header>

      {/* Status + master switch */}
      <section className="rounded-lg border border-border bg-card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Switch
              checked={draft.enabled}
              onCheckedChange={(v) => save({ enabled: v })}
              id="sw-master"
              data-testid="switch-master"
            />
            <Label htmlFor="sw-master" className="text-base font-semibold">
              {draft.enabled ? "Alerts are ON" : "Alerts are off"}
            </Label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={sendTest} data-testid="button-test">
              <Send className="h-4 w-4 mr-1" /> Send test
            </Button>
            <a href={smsLink(draft.lateMessage, lateMins)} data-testid="link-running-late">
              <Button size="sm"><MessageSquare className="h-4 w-4 mr-1" /> Running late</Button>
            </a>
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={lateMins}
              onChange={(e) => setLateMins(Number(e.target.value))}
              aria-label="Minutes late"
            >
              {[5, 10, 15, 20, 30, 45].map((m) => <option key={m} value={m}>{m} min</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <div>
            <div className="text-muted-foreground text-xs">Phone + watch (ntfy)</div>
            <div>{st?.ntfyConfigured ? "Server set" : "Not set up"}{st?.ntfyTokenPresent ? ", token installed" : ""}</div>
            {st?.engine.lastSendError ? <div className="text-destructive text-xs">{st.engine.lastSendError}</div> : null}
          </div>
          <div>
            <div className="text-muted-foreground text-xs">Calendar plan</div>
            <div>Updated {fmtAgo(st?.engine.lastPlanAt ?? null)}</div>
            {st?.engine.lastPlanError ? <div className="text-destructive text-xs">{st.engine.lastPlanError}</div> : null}
          </div>
          <div>
            <div className="text-muted-foreground text-xs">Email (AUPFHS)</div>
            <div>{st?.graphCredsPresent ? (st.emailEnabled ? "Connected" : "Ready, switched off") : "Microsoft 365 not connected"}</div>
            {st?.engine.lastMailError && st.emailEnabled ? <div className="text-destructive text-xs">{st.engine.lastMailError}</div> : null}
          </div>
        </div>
      </section>

      {/* Timeline */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2"><Clock className="h-4 w-4" /> What will fire</h2>
        <p className="text-xs text-muted-foreground">
          Preview for today and tomorrow. Titles are what your watch shows{draft.privacyLabels ? " (no patient or event names)" : ""}.
        </p>
        {previewQ.isLoading ? <div className="text-sm text-muted-foreground">Loading…</div> : null}
        {byDay.length === 0 && !previewQ.isLoading ? (
          <div className="text-sm text-muted-foreground rounded-lg border border-dashed border-border p-6 text-center">Nothing planned.</div>
        ) : null}
        {byDay.map((g) => (
          <div key={g.day} className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="px-4 py-2 text-xs uppercase tracking-wider text-muted-foreground bg-muted/30 border-b border-border">{g.day}</div>
            <div className="divide-y divide-border">
              {g.cues.map((c) => (
                <div key={c.key} className="grid grid-cols-[60px_100px_1fr] gap-3 px-4 py-2 text-sm items-start">
                  <div className="tabular-nums font-medium">{fmtTime(c.fireAt)}</div>
                  <div>
                    <Badge variant={c.kind === "leave_now" ? "default" : "outline"} className="text-[10px]">{KIND_LABEL[c.kind] ?? c.kind}</Badge>
                  </div>
                  <div>
                    <div className="font-medium">{c.title}</div>
                    {c.body ? <div className="text-xs text-muted-foreground whitespace-pre-line">{c.body}</div> : null}
                  </div>
                </div>
              ))}
            </div>
            {g.sched.length ? (
              <div className="border-t border-border" data-testid="ontime-elgin-schedule">
                <div className="px-4 pt-2 pb-1 text-xs font-medium text-muted-foreground">Elgin House sessions and appointments</div>
                <div className="divide-y divide-border">
                  {g.sched.map((s) => (
                    <div key={s.uid} className={`grid grid-cols-[110px_1fr] gap-3 px-4 py-1.5 text-sm items-start ${s.kind === "session" ? "bg-muted/20" : ""}`}>
                      <div className="tabular-nums text-muted-foreground">{fmtTime(s.startMs)}–{fmtTime(s.endMs)}</div>
                      <div className="min-w-0 [overflow-wrap:anywhere]">
                        <div className={s.kind === "session" ? "font-medium" : ""}>{s.title}</div>
                        {s.kind === "session" && s.location ? <div className="text-xs text-muted-foreground">{s.location}</div> : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </section>

      {/* Settings */}
      <section className="rounded-lg border border-border bg-card p-5 space-y-5">
        <h2 className="text-lg font-semibold flex items-center gap-2"><Bell className="h-4 w-4" /> Timing</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {num("bufferMinutes", "Buffer (min)", "Added on top of travel time")}
          {num("getReadyLeadMinutes", "Get ready (min before leaving)")}
          {num("wrapUpLeadMinutes", "Wrap up (min before leaving)")}
          {num("noTravelLeadMinutes", "No-travel events: heads-up (min)")}
          {num("escalateAfterMinutes", "Firmer alert after (min)", "If Leave now is not tapped")}
          {num("snoozeMinutes", "Snooze length (min)")}
          {num("maxSnoozes", "Max snoozes")}
          {time("quietStart", "Quiet from")}
          {time("quietEnd", "Quiet until")}
          {time("digestTime", "Today alert at")}
          {time("staleNudgeTime", "Friday nudge at")}
          {num("staleNudgeDays", "Old after (days)")}
        </div>
        <div className="space-y-3">
          {toggle("digestEnabled", "Daily Today alert", "First leave-by time, Top 3, act-today emails")}
          {toggle("privacyLabels", "Privacy labels on watch", "Shows the place or 'Appointment', never the event title")}
          {toggle("emailNudges", "Nudge for urgent emails", "Act-today emails with a deadline today or tomorrow, max 4 a day")}
          {toggle("emailEnabled", "Read AUPFHS inbox", "Needs the Microsoft 365 permission set up first")}
          {toggle("flagSyncEnabled", "Flag in Outlook", "Act today / Reply this week flags the email; done clears flags Buoy set. Nothing else changes")}
          {toggle("staleNudgeEnabled", "Friday nudge for old items", "Weekly push when Act today / Reply this week emails or captures have waited too long; silent if nothing is old")}
          {toggle("mailFilingEnabled", "Label and file in Outlook", "Adds a coloured Buoy label; Done / Dismissed moves the email to Archive > Buoy-DoneDismissed")}
        </div>
        <label className="text-sm space-y-1 block">
          <div className="font-medium">Running late message</div>
          <Input value={draft.lateMessage} onChange={(e) => set("lateMessage", e.target.value)} data-testid="input-lateMessage" />
          <div className="text-xs text-muted-foreground">{"{mins}"} becomes the minutes. Your Messages app opens; you choose who and press send.</div>
        </label>
        <label className="text-sm space-y-1 block">
          <div className="font-medium">Skip calendar events containing</div>
          <Input
            value={draft.ignoreKeywords.join(", ")}
            onChange={(e) => set("ignoreKeywords", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
            data-testid="input-ignoreKeywords"
          />
        </label>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="text-sm space-y-1">
            <div className="font-medium">ntfy server</div>
            <Input value={draft.ntfyBaseUrl} placeholder="https://ntfy.thinhalo.com" onChange={(e) => set("ntfyBaseUrl", e.target.value)} />
          </label>
          <label className="text-sm space-y-1">
            <div className="font-medium">ntfy topic</div>
            <Input value={draft.ntfyTopic} onChange={(e) => set("ntfyTopic", e.target.value)} />
          </label>
        </div>

        <h2 className="text-lg font-semibold pt-2">Daily routine</h2>
        <div className="space-y-2">
          {draft.routine.map((r, i) => (
            <div key={r.id} className="rounded-md border border-border p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Switch checked={r.enabled} onCheckedChange={(v) => setRoutine(i, { enabled: v })} aria-label="Enabled" />
                <Input type="time" className="w-28" value={r.time} onChange={(e) => setRoutine(i, { time: e.target.value })} />
                <Input className="flex-1 min-w-[160px]" value={r.title} onChange={(e) => setRoutine(i, { title: e.target.value })} />
                <Button size="icon" variant="ghost" aria-label="Remove" onClick={() => set("routine", draft.routine.filter((_, j) => j !== i))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {DAYS.map((d, di) => {
                  const on = r.days.includes(di + 1);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setRoutine(i, { days: on ? r.days.filter((x) => x !== di + 1) : [...r.days, di + 1].sort() })}
                      className={`text-xs px-2 py-1 rounded border ${on ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground"}`}
                    >
                      {d}
                    </button>
                  );
                })}
                <Input
                  className="flex-1 min-w-[160px] h-8 text-xs ml-2"
                  placeholder="Tiny first step"
                  value={r.firstStep ?? ""}
                  onChange={(e) => setRoutine(i, { firstStep: e.target.value })}
                />
              </div>
            </div>
          ))}
          <Button
            size="sm"
            variant="outline"
            onClick={() => set("routine", [...draft.routine, { id: `r-${Date.now()}`, days: [1, 2, 3, 4, 5], time: "12:00", title: "New nudge", enabled: true }])}
          >
            <Plus className="h-4 w-4 mr-1" /> Add nudge
          </Button>
        </div>
        <div className="flex gap-2 pt-2">
          <Button onClick={() => save()} data-testid="button-save">Save settings</Button>
          <Button variant="ghost" onClick={() => setDraft(cfgQ.data?.config ?? draft)}>Undo changes</Button>
        </div>
      </section>
    </div>
  );
}
