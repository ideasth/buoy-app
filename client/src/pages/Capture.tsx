import { useEffect, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { classifyTask, ESTIMATE_PRESETS, domainLabel, DOMAIN_OPTIONS } from "@/lib/anchor";
import { Mic, MicOff, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Task } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";

export default function Capture() {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [title, setTitle] = useState("");
  const [estimate, setEstimate] = useState(30);
  const [domain, setDomain] = useState("personal");
  const [domainTouched, setDomainTouched] = useState(false);
  const [listening, setListening] = useState(false);
  const recogRef = useRef<any>(null);
  const { toast } = useToast();

  const recentQ = useQuery<Task[]>({ queryKey: ["/api/tasks"] });

  useEffect(() => {
    ref.current?.focus();
  }, []);

  // Auto-classify domain as the user types (only if not manually overridden)
  useEffect(() => {
    if (domainTouched) return;
    if (!title.trim()) return;
    const cls = classifyTask(title);
    setDomain(cls.domain);
  }, [title, domainTouched]);

  const submit = async () => {
    const t = title.trim();
    if (!t) return;
    const cls = classifyTask(t);
    try {
      const payload: any = {
        title: t,
        domain,
        priority: cls.priority ?? "iftime",
        estimateMinutes: estimate,
        status: "todo",
      };
      await apiRequest("POST", "/api/tasks", payload);
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      setTitle("");
      setEstimate(30);
      setDomainTouched(false);
      toast({ title: "Captured", description: t.slice(0, 60) });
      ref.current?.focus();
    } catch (err) {
      toast({ title: "Save failed", description: String(err), variant: "destructive" });
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const toggleVoice = () => {
    const W = window as any;
    const SR = W.SpeechRecognition || W.webkitSpeechRecognition;
    if (!SR) {
      toast({
        title: "Voice not supported",
        description: "Use Chrome / Safari for speech input.",
        variant: "destructive",
      });
      return;
    }
    if (listening) {
      recogRef.current?.stop();
      setListening(false);
      return;
    }
    const r = new SR();
    r.lang = "en-AU";
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (ev: any) => {
      let text = "";
      for (let i = 0; i < ev.results.length; i++) {
        text += ev.results[i][0].transcript;
      }
      setTitle(text);
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    r.start();
    recogRef.current = r;
    setListening(true);
  };

  const recent = (recentQ.data ?? []).slice(0, 6);

  const cls = title.trim() ? classifyTask(title) : null;

  return (
    <div className="px-5 md:px-8 py-8 md:py-12 max-w-2xl space-y-8">
      <header>
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Capture</div>
        <h1 className="text-2xl font-semibold mt-1">One thought, one line.</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Get it out of your head. Triage later — never inside the capture step.
        </p>
      </header>

      <div className="space-y-3">
        <Textarea
          ref={ref}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={onKey}
          placeholder="Write the task in plain words. Press Enter to save."
          className="min-h-[80px] text-lg resize-none"
          data-testid="textarea-capture"
        />
        <div className="flex flex-wrap gap-2 items-center">
          <Button onClick={submit} disabled={!title.trim()} data-testid="button-submit-capture">
            <Send className="h-4 w-4 mr-1" />
            Save
          </Button>
          <Button
            variant="outline"
            onClick={toggleVoice}
            data-testid="button-voice-toggle"
            aria-pressed={listening}
            className={listening ? "border-destructive text-destructive" : ""}
          >
            {listening ? <MicOff className="h-4 w-4 mr-1" /> : <Mic className="h-4 w-4 mr-1" />}
            {listening ? "Listening…" : "Voice"}
          </Button>
          {cls && (
            <span className="text-xs text-muted-foreground">
              auto-tagged · <span className="text-foreground font-medium">{domainLabel(domain)}</span>
              {cls.priority ? ` · ${cls.priority}` : ""}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Estimate</div>
        <div className="flex flex-wrap gap-2">
          {ESTIMATE_PRESETS.map((m) => (
            <button
              key={m}
              onClick={() => setEstimate(m)}
              data-testid={`button-estimate-${m}`}
              className={`px-4 py-2 rounded-md border text-sm hover-elevate active-elevate-2 ${
                estimate === m
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-secondary text-secondary-foreground border-border"
              }`}
            >
              {m}m
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Domain</div>
        <div className="flex flex-wrap gap-2">
          {DOMAIN_OPTIONS.map((d) => (
            <button
              key={d.value}
              onClick={() => {
                setDomain(d.value);
                setDomainTouched(true);
              }}
              data-testid={`button-domain-${d.value}`}
              className={`px-4 py-2 rounded-md border text-sm hover-elevate active-elevate-2 ${
                domain === d.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-secondary text-secondary-foreground border-border"
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      {recent.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            Last captures
          </div>
          <ul className="text-sm text-muted-foreground space-y-1">
            {recent.map((t) => (
              <li key={t.id} className="truncate">
                · <span className="text-foreground">{t.title}</span> ·{" "}
                <span>{domainLabel(t.domain)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
