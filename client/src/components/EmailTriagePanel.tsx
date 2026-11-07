// filepath: /home/user/workspace/anchor/client/src/components/EmailTriagePanel.tsx
// Stage 25 — sorted inbox view inside Email Status (no separate Inbox page,
// per standing rule). Tabs: Act today / This week / Waiting / FYI. Plus an
// upload box for Safer Care Victoria (or any) emails: drop .eml/.msg files
// or paste the text.

import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, buildApiUrl, buildAuthHeaders, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Check, ExternalLink, RefreshCw, Upload, X } from "lucide-react";

type Item = {
  id: number; source: "graph" | "upload"; received_at: number; sender: string; sender_name: string;
  subject: string; snippet: string; web_link: string | null; category: string | null; summary: string | null;
  deadline_text: string | null; deadline_date: string | null; is_priority: number; status: string; task_id: number | null;
};

const TABS: Array<{ key: string; label: string }> = [
  { key: "act_today", label: "Act today" },
  { key: "reply_week", label: "This week" },
  { key: "waiting", label: "Waiting" },
  { key: "fyi", label: "FYI" },
];

const fmt = (ms: number) =>
  new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ms));

function toBase64(buf: ArrayBuffer): string {
  let s = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function EmailTriagePanel() {
  const { toast } = useToast();
  const [tab, setTab] = useState("act_today");
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const q = useQuery<{ items: Item[]; counts: Record<string, number>; queued: number }>({
    queryKey: ["/api/ontime/triage"],
    queryFn: async () => (await apiRequest("GET", "/api/ontime/triage")).json(),
    refetchInterval: (query) => ((query.state.data?.queued ?? 0) > 0 ? 10_000 : 60_000),
  });
  const items = (q.data?.items ?? []).filter((i) => i.category === tab);
  const counts = q.data?.counts ?? {};
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/ontime/triage"] });

  const patch = async (id: number, body: Record<string, string>) => {
    await apiRequest("PATCH", `/api/ontime/triage/${id}`, body);
    refresh();
  };

  const upload = async (body: Record<string, string>) => {
    setBusy(true);
    try {
      const r = await (await apiRequest("POST", "/api/ontime/email-upload", body)).json();
      toast({ title: r.duplicate ? "Already uploaded" : "Uploaded", description: r.subject || "Sorting now…" });
      refresh();
    } catch (e) {
      toast({ title: "Upload failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  // Stage 25.1: any number of .eml/.msg files (uploaded one by one with a
  // single summary at the end), or a .zip of them for large batches.
  const uploadZip = async (f: File) => {
    setProgress(`Uploading ${f.name}…`);
    const res = await fetch(buildApiUrl("/api/ontime/email-upload-zip"), {
      method: "POST",
      headers: buildAuthHeaders({ "Content-Type": "application/zip" }),
      body: f,
      credentials: "omit",
    });
    const r = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    if (!res.ok) throw new Error(r.error || `HTTP ${res.status}`);
    const extras = [
      r.duplicates ? `${r.duplicates} already uploaded` : "",
      r.skippedOld ? `${r.skippedOld} older than 30 days skipped` : "",
      r.skippedLarge ? `${r.skippedLarge} too large` : "",
      r.failed ? `${r.failed} unreadable` : "",
    ].filter(Boolean).join(", ");
    toast({ title: `${r.added} of ${r.emails} emails added`, description: `${extras ? extras + ". " : ""}Sorting in the background.` });
  };

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    const zips = list.filter((f) => f.name.toLowerCase().endsWith(".zip"));
    const emails = list.filter((f) => /\.(eml|msg)$/i.test(f.name));
    setBusy(true);
    try {
      for (const z of zips) {
        try { await uploadZip(z); } catch (e) {
          toast({ title: `${z.name} failed`, description: (e as Error).message, variant: "destructive" });
        }
      }
      if (emails.length === 1) {
        await upload({ filename: emails[0].name, contentBase64: toBase64(await emails[0].arrayBuffer()) });
      } else if (emails.length > 1) {
        let added = 0, dup = 0, failed = 0;
        for (let i = 0; i < emails.length; i++) {
          const f = emails[i];
          setProgress(`Uploading ${i + 1} of ${emails.length}…`);
          if (f.size > 15 * 1024 * 1024) { failed++; continue; }
          try {
            const r = await (await apiRequest("POST", "/api/ontime/email-upload", { filename: f.name, contentBase64: toBase64(await f.arrayBuffer()) })).json();
            if (r.duplicate) dup++; else added++;
          } catch { failed++; }
        }
        toast({ title: `${added} of ${emails.length} emails added`, description: `${dup ? `${dup} already uploaded. ` : ""}${failed ? `${failed} failed. ` : ""}Sorting in the background.` });
      }
      if (!zips.length && !emails.length) toast({ title: "Nothing to upload", description: "Use .eml, .msg or .zip files.", variant: "destructive" });
    } finally {
      setProgress(null);
      setBusy(false);
      refresh();
    }
  };

  const syncNow = async () => {
    try {
      const r = await (await apiRequest("POST", "/api/ontime/email-sync-now")).json();
      toast({ title: r.error ? "Email not connected" : `Fetched ${r.fetched}`, description: r.error ?? undefined });
      refresh();
    } catch (e) {
      toast({ title: "Sync failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <section className="space-y-4" data-testid="email-triage-panel">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Sorted inbox</h2>
          <p className="text-xs text-muted-foreground">
            Sorted on the Buoy server by a private model; nothing leaves the server.
            {q.data?.queued ? ` Sorting: ${q.data.queued} left (about ${Math.max(1, Math.round((q.data.queued * 16) / 60))} min).` : ""}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={syncNow} data-testid="button-email-sync">
          <RefreshCw className="h-4 w-4 mr-1" /> Check now
        </Button>
      </div>

      <div className="flex flex-wrap gap-1" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-md text-sm border ${tab === t.key ? "bg-primary text-primary-foreground border-primary" : "border-border"}`}
            data-testid={`tab-${t.key}`}
          >
            {t.label} <span className="opacity-70">{counts[t.key] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-card divide-y divide-border">
        {items.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground text-center">Nothing here.</div>
        ) : items.map((i) => (
          <div key={i.id} className="p-3 space-y-1" data-testid={`triage-row-${i.id}`}>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{fmt(i.received_at)}</span>
              <span className="font-medium text-foreground">{i.sender_name || i.sender}</span>
              {i.is_priority ? <Badge variant="outline" className="text-[10px] py-0 h-4">priority</Badge> : null}
              {i.source === "upload" ? <Badge variant="outline" className="text-[10px] py-0 h-4">uploaded</Badge> : null}
              {i.deadline_date ? <Badge className="text-[10px] py-0 h-4">due {i.deadline_date}</Badge> : null}
              {i.task_id ? <Badge variant="outline" className="text-[10px] py-0 h-4">task added</Badge> : null}
            </div>
            <div className="text-sm font-medium">{i.subject || "(no subject)"}</div>
            {i.summary ? <div className="text-sm">{i.summary}</div> : null}
            <div className="flex flex-wrap items-center gap-1 pt-1">
              <Button size="sm" variant="outline" onClick={() => patch(i.id, { status: "done" })}><Check className="h-3 w-3 mr-1" /> Done</Button>
              <Button size="sm" variant="ghost" onClick={() => patch(i.id, { status: "dismissed" })}><X className="h-3 w-3 mr-1" /> Dismiss</Button>
              <select
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                value={i.category ?? ""}
                onChange={(e) => patch(i.id, { category: e.target.value })}
                aria-label="Move to"
              >
                {TABS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
              {i.web_link ? (
                <a href={i.web_link} target="_blank" rel="noreferrer" className="text-xs inline-flex items-center gap-1 ml-2 underline">
                  Open in Outlook <ExternalLink className="h-3 w-3" />
                </a>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <div
        className={`rounded-lg border-2 border-dashed p-4 space-y-3 ${dragOver ? "border-primary bg-primary/5" : "border-border"}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); void onFiles(e.dataTransfer.files); }}
        data-testid="email-upload-box"
      >
        <div className="text-sm font-medium">Add emails (e.g. Safer Care Victoria, or a bulk export)</div>
        <div className="text-xs text-muted-foreground">Drag .eml or .msg files here (any number), a .zip of them for large batches, or paste the email text below. Emails older than 30 days are skipped.</div>
        {progress ? <div className="text-xs font-medium" data-testid="text-upload-progress">{progress}</div> : null}
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept=".eml,.msg,.zip,message/rfc822,application/zip" multiple className="hidden" onChange={(e) => { void onFiles(e.target.files); e.target.value = ""; }} />
          <Button size="sm" variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
            <Upload className="h-4 w-4 mr-1" /> Choose files
          </Button>
        </div>
        <Textarea
          rows={4}
          value={paste}
          placeholder={"From: ...\nSubject: ...\n\nEmail text"}
          onChange={(e) => setPaste(e.target.value)}
          data-testid="textarea-email-paste"
        />
        <Button size="sm" disabled={busy || !paste.trim()} onClick={async () => { await upload({ text: paste }); setPaste(""); }}>
          Add pasted email
        </Button>
      </div>
    </section>
  );
}
