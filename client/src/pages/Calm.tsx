// Stage 13 (2026-05-11) — Calm: third Coach mode.
//
// Single-page state machine. Pre-capture → 6 cycles of paced breathing →
// stepped grounding (see/hear/feel) → reframe (LLM, 8s timeout w/ fallback) →
// optional reflection branch (3 prompts, one acknowledgement per) →
// post-capture → done. The grounding flow is local; only reframe + each
// acknowledgement call the server.

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

type Variant = "grounding_only" | "grounding_plus_reflection";
type EntityType = "task" | "project" | "inbox_item" | "freetext";

type CalmState =
  | "pre-capture"
  | "breathing"
  | "grounding-see"
  | "grounding-hear"
  | "grounding-feel"
  | "reframe"
  | "reflection-worst"
  | "reflection-accurate"
  | "reflection-next"
  | "post-capture"
  | "done";

const FEELING_TAGS = [
  "overwhelmed",
  "anxious",
  "angry",
  "defeated",
  "scattered",
  "frustrated",
  "sad",
];

const TOTAL_CYCLES = 6;
const PHASE_SECONDS = 5;
const CYCLE_SECONDS = PHASE_SECONDS * 2;

interface IssueCandidates {
  tasks: Array<{ id: number; label: string }>;
  projects: Array<{ id: number; label: string }>;
  inboxItems: Array<{ id: number; label: string }>;
}

interface SelectedIssue {
  entityType: EntityType;
  entityId: number | null;
  freetext: string | null;
  label: string;
}

export default function Calm() {
  const [, setLocation] = useLocation();
  const [state, setState] = useState<CalmState>("pre-capture");

  // Pre-capture state
  const [variant, setVariant] = useState<Variant>("grounding_only");
  const [searchQuery, setSearchQuery] = useState("");
  const [selected, setSelected] = useState<SelectedIssue | null>(null);
  const [freetext, setFreetext] = useState("");
  const [showFreetext, setShowFreetext] = useState(false);
  const [preTags, setPreTags] = useState<string[]>([]);
  const [preIntensity, setPreIntensity] = useState<number>(5);
  const [starting, setStarting] = useState(false);

  // Session state
  const [sessionId, setSessionId] = useState<number | null>(null);

  // Grounding state
  const [groundingSee, setGroundingSee] = useState("");
  const [groundingHear, setGroundingHear] = useState("");
  const [groundingFeel, setGroundingFeel] = useState("");

  // Reframe state
  const [reframeText, setReframeText] = useState<string | null>(null);
  const [reframeLoading, setReframeLoading] = useState(false);

  // Reflection state
  const [worstAnswer, setWorstAnswer] = useState("");
  const [accurateAnswer, setAccurateAnswer] = useState("");
  const [nextAnswer, setNextAnswer] = useState("");
  const [acknowledgement, setAcknowledgement] = useState<string | null>(null);
  const [ackSubmitting, setAckSubmitting] = useState(false);

  // Post-capture state
  const [postTags, setPostTags] = useState<string[]>([]);
  const [postIntensity, setPostIntensity] = useState<number>(5);
  const [postNote, setPostNote] = useState("");
  const [finishing, setFinishing] = useState(false);
  const [finalSession, setFinalSession] = useState<any | null>(null);

  // Issue candidates
  const candQ = useQuery<IssueCandidates>({
    queryKey: ["/api/coach/calm/issue-candidates"],
  });

  // -- Pre-capture handlers ------------------------------------------------

  function togglePreTag(tag: string) {
    setPreTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  }

  function pickIssue(
    entityType: EntityType,
    entityId: number | null,
    label: string,
  ) {
    setSelected({ entityType, entityId, freetext: null, label });
    setShowFreetext(false);
  }

  function useFreetext() {
    if (!freetext.trim()) return;
    setSelected({
      entityType: "freetext",
      entityId: null,
      freetext: freetext.trim(),
      label: freetext.trim(),
    });
  }

  const canStart = selected != null && preTags.length > 0;

  async function startSession() {
    if (!canStart || !selected) return;
    setStarting(true);
    try {
      const res = await apiRequest("POST", "/api/coach/calm/sessions", {
        calm_variant: variant,
        issue_entity_type: selected.entityType,
        issue_entity_id: selected.entityId,
        issue_freetext: selected.freetext,
        pre_tags: preTags,
        pre_intensity: preIntensity,
      });
      const json = (await res.json()) as { id: number };
      setSessionId(json.id);
      setState("breathing");
    } catch (err) {
      console.error("[calm] start failed", err);
    } finally {
      setStarting(false);
    }
  }

  // -- Grounding handlers --------------------------------------------------

  function continueSee() {
    if (!groundingSee.trim()) return;
    setState("grounding-hear");
  }
  function continueHear() {
    if (!groundingHear.trim()) return;
    setState("grounding-feel");
  }
  async function continueFeel() {
    if (!groundingFeel.trim()) return;
    setState("reframe");
    await loadReframe();
  }

  async function loadReframe() {
    if (sessionId == null) return;
    setReframeLoading(true);
    setReframeText(null);
    try {
      const res = await apiRequest(
        "POST",
        `/api/coach/calm/sessions/${sessionId}/reframe`,
        {
          grounding_observations: {
            see: groundingSee.trim(),
            hear: groundingHear.trim(),
            feel: groundingFeel.trim(),
          },
        },
      );
      const json = (await res.json()) as { reframe_text: string };
      setReframeText(json.reframe_text);
    } catch (err) {
      console.error("[calm] reframe failed", err);
      setReframeText(
        "You've slowed your breathing and named what's around you. That's enough for this moment. The thought you're holding doesn't need an answer right now — it needs space.",
      );
    } finally {
      setReframeLoading(false);
    }
  }

  function continueFromReframe() {
    if (variant === "grounding_only") {
      setState("post-capture");
    } else {
      setState("reflection-worst");
    }
  }

  // -- Reflection handlers -------------------------------------------------

  async function submitReflection(
    questionKey: "worst" | "accurate" | "next",
    answer: string,
    next: CalmState,
  ) {
    if (!answer.trim() || sessionId == null) return;
    setAckSubmitting(true);
    setAcknowledgement(null);
    try {
      const res = await apiRequest(
        "POST",
        `/api/coach/calm/sessions/${sessionId}/acknowledge`,
        { question_key: questionKey, answer: answer.trim() },
      );
      const json = (await res.json()) as { acknowledgement: string };
      setAcknowledgement(json.acknowledgement);
      // Show acknowledgement briefly, then advance.
      setTimeout(() => {
        setAcknowledgement(null);
        setState(next);
      }, 1500);
    } catch (err) {
      console.error("[calm] acknowledge failed", err);
      setAcknowledgement("Noted.");
      setTimeout(() => {
        setAcknowledgement(null);
        setState(next);
      }, 1500);
    } finally {
      setAckSubmitting(false);
    }
  }

  // -- Post-capture handlers ----------------------------------------------

  function togglePostTag(tag: string) {
    setPostTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  }

  async function finishSession() {
    if (sessionId == null) return;
    setFinishing(true);
    try {
      const res = await apiRequest(
        "POST",
        `/api/coach/calm/sessions/${sessionId}/complete`,
        {
          post_tags: postTags,
          post_intensity: postIntensity,
          post_note: postNote.trim() || null,
        },
      );
      const json = (await res.json()) as { session: any };
      setFinalSession(json.session);
      setState("done");
    } catch (err) {
      console.error("[calm] complete failed", err);
    } finally {
      setFinishing(false);
    }
  }

  // -- Render --------------------------------------------------------------

  return (
    <div className="max-w-xl mx-auto p-4 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Calm</h1>
        <p className="text-sm text-muted-foreground">
          A short grounding pause. Breathe, name what's around you, sit with what you're carrying.
        </p>
      </div>

      {state === "pre-capture" && (
        <PreCaptureScreen
          variant={variant}
          setVariant={setVariant}
          candidates={candQ.data}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          selected={selected}
          pickIssue={pickIssue}
          showFreetext={showFreetext}
          setShowFreetext={setShowFreetext}
          freetext={freetext}
          setFreetext={setFreetext}
          useFreetext={useFreetext}
          preTags={preTags}
          togglePreTag={togglePreTag}
          preIntensity={preIntensity}
          setPreIntensity={setPreIntensity}
          canStart={canStart}
          starting={starting}
          startSession={startSession}
        />
      )}

      {state === "breathing" && (
        <BreathingScreen onDone={() => setState("grounding-see")} />
      )}

      {state === "grounding-see" && (
        <GroundingScreen
          question="Name one thing you can see right now."
          value={groundingSee}
          setValue={setGroundingSee}
          onContinue={continueSee}
          step={1}
        />
      )}
      {state === "grounding-hear" && (
        <GroundingScreen
          question="Name one thing you can hear right now."
          value={groundingHear}
          setValue={setGroundingHear}
          onContinue={continueHear}
          step={2}
        />
      )}
      {state === "grounding-feel" && (
        <GroundingScreen
          question="Name one thing you can feel right now."
          value={groundingFeel}
          setValue={setGroundingFeel}
          onContinue={continueFeel}
          step={3}
        />
      )}

      {state === "reframe" && (
        <ReframeScreen
          loading={reframeLoading}
          text={reframeText}
          variant={variant}
          onContinue={continueFromReframe}
        />
      )}

      {(state === "reflection-worst" ||
        state === "reflection-accurate" ||
        state === "reflection-next") && (
        <ReflectionScreen
          state={state}
          worstAnswer={worstAnswer}
          setWorstAnswer={setWorstAnswer}
          accurateAnswer={accurateAnswer}
          setAccurateAnswer={setAccurateAnswer}
          nextAnswer={nextAnswer}
          setNextAnswer={setNextAnswer}
          acknowledgement={acknowledgement}
          ackSubmitting={ackSubmitting}
          submit={submitReflection}
        />
      )}

      {state === "post-capture" && (
        <PostCaptureScreen
          postTags={postTags}
          togglePostTag={togglePostTag}
          postIntensity={postIntensity}
          setPostIntensity={setPostIntensity}
          postNote={postNote}
          setPostNote={setPostNote}
          finishing={finishing}
          onFinish={finishSession}
        />
      )}

      {state === "done" && (
        <DoneScreen
          preIntensity={preIntensity}
          postIntensity={postIntensity}
          preTags={preTags}
          postTags={postTags}
          onBack={() => setLocation("/coach")}
        />
      )}
    </div>
  );
}

// -- Sub-components --------------------------------------------------------

function PreCaptureScreen(props: {
  variant: Variant;
  setVariant: (v: Variant) => void;
  candidates: IssueCandidates | undefined;
  searchQuery: string;
  setSearchQuery: (s: string) => void;
  selected: SelectedIssue | null;
  pickIssue: (entityType: EntityType, entityId: number | null, label: string) => void;
  showFreetext: boolean;
  setShowFreetext: (b: boolean) => void;
  freetext: string;
  setFreetext: (s: string) => void;
  useFreetext: () => void;
  preTags: string[];
  togglePreTag: (t: string) => void;
  preIntensity: number;
  setPreIntensity: (n: number) => void;
  canStart: boolean;
  starting: boolean;
  startSession: () => void;
}) {
  const q = props.searchQuery.trim().toLowerCase();
  const filter = (items: Array<{ id: number; label: string }>) =>
    q ? items.filter((i) => i.label.toLowerCase().includes(q)) : items;
  const tasks = filter(props.candidates?.tasks ?? []);
  const projects = filter(props.candidates?.projects ?? []);
  const inbox = filter(props.candidates?.inboxItems ?? []);

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <label className="text-sm font-medium">Mode</label>
        <ToggleGroup
          type="single"
          value={props.variant}
          onValueChange={(v) => {
            if (v === "grounding_only" || v === "grounding_plus_reflection") {
              props.setVariant(v);
            }
          }}
          className="justify-start"
        >
          <ToggleGroupItem value="grounding_only">Grounding only</ToggleGroupItem>
          <ToggleGroupItem value="grounding_plus_reflection">
            Grounding + Structured reflection
          </ToggleGroupItem>
        </ToggleGroup>
      </section>

      <section className="space-y-2">
        <label className="text-sm font-medium">What is on your mind?</label>
        <Input
          placeholder="Search tasks, projects, inbox…"
          value={props.searchQuery}
          onChange={(e) => props.setSearchQuery(e.target.value)}
        />
        <div className="max-h-64 overflow-y-auto rounded border bg-muted/30 divide-y">
          {tasks.length > 0 && (
            <IssueSection
              heading="Tasks"
              items={tasks}
              entityType="task"
              selectedId={
                props.selected?.entityType === "task" ? props.selected.entityId : null
              }
              pick={props.pickIssue}
            />
          )}
          {projects.length > 0 && (
            <IssueSection
              heading="Projects"
              items={projects}
              entityType="project"
              selectedId={
                props.selected?.entityType === "project" ? props.selected.entityId : null
              }
              pick={props.pickIssue}
            />
          )}
          {inbox.length > 0 && (
            <IssueSection
              heading="Inbox"
              items={inbox}
              entityType="inbox_item"
              selectedId={
                props.selected?.entityType === "inbox_item"
                  ? props.selected.entityId
                  : null
              }
              pick={props.pickIssue}
            />
          )}
          {tasks.length === 0 && projects.length === 0 && inbox.length === 0 && (
            <div className="p-3 text-sm text-muted-foreground italic">
              No matches.
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => props.setShowFreetext(!props.showFreetext)}
          >
            Something else
          </Button>
          {props.showFreetext && (
            <div className="flex gap-2">
              <Input
                placeholder="What is it?"
                value={props.freetext}
                onChange={(e) => props.setFreetext(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") props.useFreetext();
                }}
              />
              <Button
                size="sm"
                onClick={props.useFreetext}
                disabled={!props.freetext.trim()}
              >
                Use
              </Button>
            </div>
          )}
          {props.selected && (
            <div className="text-xs text-muted-foreground">
              Selected:{" "}
              <span className="font-medium text-foreground">
                {props.selected.label}
              </span>
            </div>
          )}
        </div>
      </section>

      <section className="space-y-2">
        <label className="text-sm font-medium">How are you feeling?</label>
        <div className="flex flex-wrap gap-2">
          {FEELING_TAGS.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => props.togglePreTag(tag)}
              className={cn(
                "px-3 py-1.5 rounded-full border text-sm transition-colors",
                props.preTags.includes(tag)
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border hover:bg-muted",
              )}
            >
              {tag}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">Intensity</label>
          <span className="text-sm tabular-nums">{props.preIntensity}/10</span>
        </div>
        <Slider
          value={[props.preIntensity]}
          min={0}
          max={10}
          step={1}
          onValueChange={(v) => props.setPreIntensity(v[0] ?? 0)}
        />
      </section>

      <Button
        size="lg"
        className="w-full"
        disabled={!props.canStart || props.starting}
        onClick={props.startSession}
      >
        {props.starting ? "Starting…" : "Start Calm session"}
      </Button>
    </div>
  );
}

function IssueSection(props: {
  heading: string;
  items: Array<{ id: number; label: string }>;
  entityType: EntityType;
  selectedId: number | null;
  pick: (entityType: EntityType, entityId: number | null, label: string) => void;
}) {
  return (
    <div>
      <div className="px-3 py-1.5 text-xs uppercase tracking-wider text-muted-foreground bg-muted/50">
        {props.heading}
      </div>
      <ul>
        {props.items.map((item) => (
          <li key={`${props.entityType}-${item.id}`}>
            <button
              type="button"
              onClick={() => props.pick(props.entityType, item.id, item.label)}
              className={cn(
                "w-full text-left px-3 py-2 text-sm hover:bg-muted/70 transition-colors",
                props.selectedId === item.id && "bg-primary/10",
              )}
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BreathingScreen({ onDone }: { onDone: () => void }) {
  const [tick, setTick] = useState(0); // seconds elapsed
  const [skipped, setSkipped] = useState(false);
  const startRef = useRef<number>(Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startRef.current) / 1000);
      setTick(elapsed);
      if (elapsed >= TOTAL_CYCLES * CYCLE_SECONDS) {
        clearInterval(interval);
        onDone();
      }
    }, 200);
    return () => clearInterval(interval);
  }, [onDone]);

  const cycle = Math.min(Math.floor(tick / CYCLE_SECONDS) + 1, TOTAL_CYCLES);
  const phaseTick = tick % CYCLE_SECONDS;
  const inhaling = phaseTick < PHASE_SECONDS;
  const label = inhaling ? "Breathe in" : "Breathe out";
  const canSkip = !skipped && tick >= 2 * CYCLE_SECONDS;

  return (
    <div className="space-y-8 py-6">
      <div className="text-center text-sm text-muted-foreground">
        Cycle {cycle} of {TOTAL_CYCLES}
      </div>
      <div className="flex items-center justify-center h-64">
        <div
          className={cn(
            "rounded-full bg-primary/20 border border-primary/40 transition-all ease-in-out",
            inhaling ? "scale-150" : "scale-100",
          )}
          style={{
            width: "10rem",
            height: "10rem",
            transitionDuration: `${PHASE_SECONDS}s`,
          }}
        />
      </div>
      <div className="text-center text-lg font-medium">{label}</div>
      {canSkip && (
        <div className="text-center">
          <button
            type="button"
            onClick={() => {
              setSkipped(true);
              onDone();
            }}
            className="text-sm text-muted-foreground underline hover:text-foreground"
          >
            Skip ahead
          </button>
        </div>
      )}
    </div>
  );
}

function GroundingScreen(props: {
  question: string;
  value: string;
  setValue: (s: string) => void;
  onContinue: () => void;
  step: number;
}) {
  return (
    <div className="space-y-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        Step {props.step} of 3
      </div>
      <h2 className="text-xl font-medium leading-relaxed">{props.question}</h2>
      <Input
        autoFocus
        value={props.value}
        onChange={(e) => props.setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && props.value.trim()) props.onContinue();
        }}
        placeholder="A short answer is enough."
      />
      <Button
        onClick={props.onContinue}
        disabled={!props.value.trim()}
        className="w-full"
      >
        Continue
      </Button>
    </div>
  );
}

function ReframeScreen(props: {
  loading: boolean;
  text: string | null;
  variant: Variant;
  onContinue: () => void;
}) {
  return (
    <div className="space-y-4">
      {props.loading || !props.text ? (
        <div className="text-center text-muted-foreground italic py-12">
          …
        </div>
      ) : (
        <Card>
          <CardContent className="pt-6 text-lg leading-relaxed">
            {props.text}
          </CardContent>
        </Card>
      )}
      {!props.loading && props.text && (
        <Button onClick={props.onContinue} className="w-full" size="lg">
          {props.variant === "grounding_only" ? "Continue" : "Continue to reflection"}
        </Button>
      )}
    </div>
  );
}

function ReflectionScreen(props: {
  state: CalmState;
  worstAnswer: string;
  setWorstAnswer: (s: string) => void;
  accurateAnswer: string;
  setAccurateAnswer: (s: string) => void;
  nextAnswer: string;
  setNextAnswer: (s: string) => void;
  acknowledgement: string | null;
  ackSubmitting: boolean;
  submit: (
    questionKey: "worst" | "accurate" | "next",
    answer: string,
    next: CalmState,
  ) => void;
}) {
  const config = useMemo(() => {
    if (props.state === "reflection-worst") {
      return {
        prompt: "What's the worst-case story you're telling yourself right now?",
        questionKey: "worst" as const,
        answer: props.worstAnswer,
        setAnswer: props.setWorstAnswer,
        next: "reflection-accurate" as CalmState,
      };
    }
    if (props.state === "reflection-accurate") {
      return {
        prompt: "What's a more accurate story?",
        questionKey: "accurate" as const,
        answer: props.accurateAnswer,
        setAnswer: props.setAccurateAnswer,
        next: "reflection-next" as CalmState,
      };
    }
    return {
      prompt: "What's one small next action that's within your control?",
      questionKey: "next" as const,
      answer: props.nextAnswer,
      setAnswer: props.setNextAnswer,
      next: "post-capture" as CalmState,
    };
  }, [props]);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-medium leading-relaxed">{config.prompt}</h2>
      <Textarea
        autoFocus
        rows={3}
        value={config.answer}
        onChange={(e) => config.setAnswer(e.target.value)}
        placeholder="Take your time."
      />
      <Button
        onClick={() => props.submit(config.questionKey, config.answer, config.next)}
        disabled={!config.answer.trim() || props.ackSubmitting}
        className="w-full"
      >
        Continue
      </Button>
      {props.acknowledgement && (
        <div className="text-sm text-muted-foreground italic text-center pt-2">
          {props.acknowledgement}
        </div>
      )}
    </div>
  );
}

function PostCaptureScreen(props: {
  postTags: string[];
  togglePostTag: (t: string) => void;
  postIntensity: number;
  setPostIntensity: (n: number) => void;
  postNote: string;
  setPostNote: (s: string) => void;
  finishing: boolean;
  onFinish: () => void;
}) {
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-medium">How are you now?</h2>
      <section className="space-y-2">
        <label className="text-sm font-medium">Feeling now</label>
        <div className="flex flex-wrap gap-2">
          {FEELING_TAGS.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => props.togglePostTag(tag)}
              className={cn(
                "px-3 py-1.5 rounded-full border text-sm transition-colors",
                props.postTags.includes(tag)
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border hover:bg-muted",
              )}
            >
              {tag}
            </button>
          ))}
        </div>
      </section>
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">Intensity</label>
          <span className="text-sm tabular-nums">{props.postIntensity}/10</span>
        </div>
        <Slider
          value={[props.postIntensity]}
          min={0}
          max={10}
          step={1}
          onValueChange={(v) => props.setPostIntensity(v[0] ?? 0)}
        />
      </section>
      <section className="space-y-2">
        <label className="text-sm font-medium">Anything to remember?</label>
        <Input
          value={props.postNote}
          onChange={(e) => props.setPostNote(e.target.value)}
          placeholder="Optional"
        />
      </section>
      <Button
        size="lg"
        className="w-full"
        onClick={props.onFinish}
        disabled={props.finishing}
      >
        {props.finishing ? "Finishing…" : "Finish"}
      </Button>
    </div>
  );
}

function DoneScreen(props: {
  preIntensity: number;
  postIntensity: number;
  preTags: string[];
  postTags: string[];
  onBack: () => void;
}) {
  const delta = props.postIntensity - props.preIntensity;
  const added = props.postTags.filter((t) => !props.preTags.includes(t));
  const dropped = props.preTags.filter((t) => !props.postTags.includes(t));
  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6 space-y-3">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Intensity
            </div>
            <div className="text-lg">
              {props.preIntensity} → {props.postIntensity}{" "}
              <span
                className={cn(
                  "text-sm",
                  delta < 0
                    ? "text-emerald-600"
                    : delta > 0
                      ? "text-amber-600"
                      : "text-muted-foreground",
                )}
              >
                ({delta > 0 ? "+" : ""}
                {delta})
              </span>
            </div>
          </div>
          {added.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Added
              </div>
              <div className="text-sm">{added.join(", ")}</div>
            </div>
          )}
          {dropped.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Dropped
              </div>
              <div className="text-sm">{dropped.join(", ")}</div>
            </div>
          )}
        </CardContent>
      </Card>
      <Button variant="outline" className="w-full" onClick={props.onBack}>
        Back to Coach
      </Button>
    </div>
  );
}
