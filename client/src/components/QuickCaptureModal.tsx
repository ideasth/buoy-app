// QuickCaptureModal — Stage 26b unified capture sheet.
//
// Opens from the floating "+" button, the `c` key or ⌘/Ctrl+K. Only the text
// is required: Enter saves, Shift+Enter inserts a newline, Esc closes.
// Optional (collapsed) fields: project, due date, domain. Voice input uses the
// browser's speech recognition (Safari / Chrome).
//
// Save rules live on the server (server/capture.ts):
//   - no project  -> a task tagged "check" (shows under "Needs a look")
//   - project     -> an unassigned project task with a "[check]" note
// No Inbox page.

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Mic, MicOff, ChevronDown, ChevronUp } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DOMAIN_OPTIONS } from "@/lib/anchor";
import { useToast } from "@/hooks/use-toast";
import { saveCaptureItem, capturedToast, recentProjectIds } from "@/lib/capture";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ProjectLite {
  id: number;
  name: string;
  status?: string;
  pmtStatus?: string | null;
  priority?: string;
}

export function useSpeech(onText: (t: string) => void) {
  const [listening, setListening] = useState(false);
  const recogRef = useRef<any>(null);
  const W = typeof window !== "undefined" ? (window as any) : {};
  const supported = !!(W.SpeechRecognition || W.webkitSpeechRecognition);
  const toggle = () => {
    const SR = W.SpeechRecognition || W.webkitSpeechRecognition;
    if (!SR) return false;
    if (listening) {
      recogRef.current?.stop();
      setListening(false);
      return true;
    }
    const r = new SR();
    r.lang = "en-AU";
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (ev: any) => {
      let text = "";
      for (let i = 0; i < ev.results.length; i++) text += ev.results[i][0].transcript;
      onText(text);
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    r.start();
    recogRef.current = r;
    setListening(true);
    return true;
  };
  const stop = () => {
    recogRef.current?.stop();
    setListening(false);
  };
  return { listening, supported, toggle, stop };
}

export function QuickCaptureModal({ open, onOpenChange }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [showMore, setShowMore] = useState(false);
  const [projectId, setProjectId] = useState<string>("");
  const [dueDate, setDueDate] = useState("");
  const [domain, setDomain] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const speech = useSpeech(setText);

  const projectsQ = useQuery<ProjectLite[]>({ queryKey: ["/api/projects"], enabled: open });
  const projectOptions = useMemo(() => {
    const all = (projectsQ.data ?? []).filter(
      (p) => p.status !== "parked" && p.pmtStatus !== "Complete" && p.pmtStatus !== "Parked",
    );
    const recent = recentProjectIds();
    const byId = new Map(all.map((p) => [p.id, p]));
    const first = recent.map((id) => byId.get(id)).filter((p): p is ProjectLite => !!p);
    const rest = all
      .filter((p) => !recent.includes(p.id))
      .sort((a, b) => (a.priority === "high" ? 0 : 1) - (b.priority === "high" ? 0 : 1) || a.name.localeCompare(b.name));
    return { recent: first, rest };
  }, [projectsQ.data]);

  // Fresh sheet on every open.
  useEffect(() => {
    if (open) {
      setText("");
      setShowMore(false);
      setProjectId("");
      setDueDate("");
      setDomain("");
      const t = window.setTimeout(() => ref.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
    speech.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = async () => {
    const t = text.trim();
    if (!t || saving) return;
    setSaving(true);
    try {
      const item = await saveCaptureItem({
        text: t,
        projectId: projectId ? Number(projectId) : null,
        dueDate: dueDate || null,
        domain: domain || null,
      });
      capturedToast(toast as any, item);
      onOpenChange(false);
    } catch (err) {
      toast({ title: "Save failed", description: String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  const onVoice = () => {
    if (!speech.toggle()) {
      toast({ title: "Voice not supported", description: "Use Safari or Chrome for speech input.", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-quick-capture">
        <DialogHeader>
          <DialogTitle>Capture</DialogTitle>
          <DialogDescription>
            Enter to save, Esc to close. Sort it later — it shows under "Needs a look".
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Textarea
            ref={ref}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            placeholder="What just came up?"
            rows={3}
            className="pr-11"
            data-testid="textarea-quick-capture"
          />
          {speech.supported && (
            <Button
              type="button"
              variant={speech.listening ? "default" : "ghost"}
              size="icon"
              onClick={onVoice}
              className="absolute right-1.5 top-1.5 h-8 w-8"
              aria-label={speech.listening ? "Stop voice input" : "Start voice input"}
              data-testid="button-quick-capture-voice"
            >
              {speech.listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </Button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setShowMore((v) => !v)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground self-start"
          data-testid="button-quick-capture-more"
        >
          {showMore ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {showMore ? "Fewer options" : "Project, due date, domain (optional)"}
        </button>

        {showMore && (
          <div className="grid gap-2 text-sm" data-testid="quick-capture-options">
            <label className="grid gap-1">
              <span className="text-xs text-muted-foreground">Project</span>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-2"
                data-testid="select-quick-capture-project"
              >
                <option value="">None — general task</option>
                {projectOptions.recent.length > 0 && (
                  <optgroup label="Recent">
                    {projectOptions.recent.map((p) => (
                      <option key={`r${p.id}`} value={p.id}>{p.name}</option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="All active">
                  {projectOptions.rest.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </optgroup>
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1">
                <span className="text-xs text-muted-foreground">Due date</span>
                <Input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="h-9"
                  data-testid="input-quick-capture-due"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-muted-foreground">Domain</span>
                <select
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  disabled={!!projectId}
                  className="h-9 rounded-md border border-input bg-background px-2 disabled:opacity-50"
                  data-testid="select-quick-capture-domain"
                >
                  <option value="">Auto</option>
                  {DOMAIN_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-muted-foreground">
            {speech.listening ? "Listening…" : text.trim() ? `${text.trim().length} chars` : "Type, or tap the mic"}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} data-testid="button-quick-capture-cancel">
              Cancel
            </Button>
            <Button size="sm" onClick={submit} disabled={!text.trim() || saving} data-testid="button-quick-capture-save">
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
