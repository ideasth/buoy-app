// Stage 13 (2026-05-11), Stage 13a (2026-05-12) — Calm: third Coach mode.
//
// Single-page state machine. Pre-capture (chips + brain dump + optional
// issue) → 6 cycles of paced breathing → stepped grounding (see/hear/feel)
// → reframe (LLM, 8s timeout w/ fallback) → optional reflection branch
// (3 prompts, one acknowledgement per) → post-capture (re-asked chips)
// → done. The grounding flow is local; only reframe + each acknowledge
// call the server.
//
// Stage 13a: pre-capture and post-capture are chip-based and all chip
// groups are OPTIONAL — Continue / Done are always enabled.

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
// Stage 18 (2026-05-16) — bundled calming audio loop. Tempo-matched to the
// 16 s box-breathing cycle (4 s inhale / hold / exhale / hold). Polyphonic
// A3 drone with per-phase top voices. See scripts/render-calm-loop.mjs.
import calmLoopUrl from "@/assets/calm-loop.mp3";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import {
  AROUSAL_STATE_OPTIONS,
  ENERGY_OPTIONS,
  SLEEP_OPTIONS,
  MOOD_OPTIONS,
  COGNITIVE_LOAD_OPTIONS,
  FOCUS_OPTIONS,
  ALIGNMENT_PEOPLE_OPTIONS,
  ALIGNMENT_ACTIVITIES_OPTIONS,
  MIND_CATEGORY_OPTIONS,
  CalmSingleSelectRow,
  CalmMultiSelectRow,
  chipStateToPayload,
  EMPTY_CALM_CHIP_STATE,
  type CalmChipState,
} from "@/lib/calmOptions";

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

// Stage 18 (2026-05-16) — box breathing 4 s inhale + 4 s hold-full + 4 s
// exhale + 4 s hold-empty = 16 s per cycle. Four cycles ≈ 64 s total, in
// the same ballpark as the previous 6 cycles × 10 s = 60 s.
const TOTAL_CYCLES = 4;
const PHASE_SECONDS = 4;
const PHASES_PER_CYCLE = 4;
const CYCLE_SECONDS = PHASE_SECONDS * PHASES_PER_CYCLE;
// Default volume for the calm audio loop. No UI control in Stage 18.
const CALM_AUDIO_VOLUME = 0.6;

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
  const [preChips, setPreChips] = useState<CalmChipState>({ ...EMPTY_CALM_CHIP_STATE });
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

  // Post-capture state (chip set initialised from pre-capture values
  // except the brain dump, which starts empty per spec).
  const [postChips, setPostChips] = useState<CalmChipState>({ ...EMPTY_CALM_CHIP_STATE });
  const [finishing, setFinishing] = useState(false);

  // Issue candidates
  const candQ = useQuery<IssueCandidates>({
    queryKey: ["/api/coach/calm/issue-candidates"],
  });

  // -- Pre-capture handlers ------------------------------------------------

  function pickIssue(
    entityType: EntityType,
    entityId: number | null,
    label: string,
  ) {
    setSelected({ entityType, entityId, freetext: null, label });
    setShowFreetext(false);
  }

  function clearIssue() {
    setSelected(null);
    setShowFreetext(false);
    setFreetext("");
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

  async function startSession() {
    setStarting(true);
    try {
      const chipPayload = chipStateToPayload(preChips, "pre");
      const body: Record<string, unknown> = {
        calm_variant: variant,
        ...chipPayload,
      };
      if (selected) {
        body.issue_entity_type = selected.entityType;
        body.issue_entity_id = selected.entityId;
        body.issue_freetext = selected.freetext;
      }
      const res = await apiRequest("POST", "/api/coach/calm/sessions", body);
      const json = (await res.json()) as { id: number };
      setSessionId(json.id);
      // Pre-seed post-capture chips with the pre-capture values so the
      // user can tap-to-change rather than re-pick. Brain dump stays
      // blank — the post brain dump is intentionally a fresh entry.
      setPostChips({ ...preChips, brainDump: "" });
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

  async function finishSession() {
    if (sessionId == null) return;
    setFinishing(true);
    try {
      const chipPayload = chipStateToPayload(postChips, "post");
      const res = await apiRequest(
        "POST",
        `/api/coach/calm/sessions/${sessionId}/complete`,
        chipPayload,
      );
      await res.json();
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
          clearIssue={clearIssue}
          showFreetext={showFreetext}
          setShowFreetext={setShowFreetext}
          freetext={freetext}
          setFreetext={setFreetext}
          useFreetext={useFreetext}
          chips={preChips}
          setChips={setPreChips}
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
          chips={postChips}
          setChips={setPostChips}
          finishing={finishing}
          onFinish={finishSession}
        />
      )}

      {state === "done" && (
        <DoneScreen
          preChips={preChips}
          postChips={postChips}
          onBack={() => setLocation("/coach")}
        />
      )}
    </div>
  );
}

// -- Sub-components --------------------------------------------------------

// Shared chip section block — renders the 8 single-select chip groups
// followed by the multi-select "What's on my mind" group plus its
// conditional Other-label input, plus the "Empty my head" textarea.
// Used by both pre-capture and post-capture so the option order stays
// identical between the two phases.
function ChipBlock({
  chips,
  setChips,
  brainDumpPlaceholder,
  testIdPrefix,
}: {
  chips: CalmChipState;
  setChips: React.Dispatch<React.SetStateAction<CalmChipState>>;
  brainDumpPlaceholder: string;
  testIdPrefix: string;
}) {
  const otherSelected = chips.mindCategories.includes("Other");
  return (
    <div className="space-y-5">
      <CalmSingleSelectRow
        label="Arousal state"
        options={AROUSAL_STATE_OPTIONS}
        value={chips.arousal}
        onPick={(v) => setChips((p) => ({ ...p, arousal: v }))}
        testIdPrefix={`${testIdPrefix}-arousal`}
      />
      <CalmSingleSelectRow
        label="Energy"
        options={ENERGY_OPTIONS}
        value={chips.energy}
        onPick={(v) => setChips((p) => ({ ...p, energy: v }))}
        testIdPrefix={`${testIdPrefix}-energy`}
      />
      <CalmSingleSelectRow
        label="Sleep quality"
        options={SLEEP_OPTIONS}
        value={chips.sleep}
        onPick={(v) => setChips((p) => ({ ...p, sleep: v }))}
        testIdPrefix={`${testIdPrefix}-sleep`}
      />
      <CalmSingleSelectRow
        label="Mood"
        options={MOOD_OPTIONS}
        value={chips.mood}
        onPick={(v) => setChips((p) => ({ ...p, mood: v }))}
        testIdPrefix={`${testIdPrefix}-mood`}
      />
      <CalmSingleSelectRow
        label="Cognitive load"
        options={COGNITIVE_LOAD_OPTIONS}
        value={chips.cognitiveLoad}
        onPick={(v) => setChips((p) => ({ ...p, cognitiveLoad: v }))}
        testIdPrefix={`${testIdPrefix}-cog`}
      />
      <CalmSingleSelectRow
        label="Focus"
        options={FOCUS_OPTIONS}
        value={chips.focus}
        onPick={(v) => setChips((p) => ({ ...p, focus: v }))}
        testIdPrefix={`${testIdPrefix}-focus`}
      />
      <CalmSingleSelectRow
        label="Alignment — with those around me"
        options={ALIGNMENT_PEOPLE_OPTIONS}
        value={chips.alignmentPeople}
        onPick={(v) => setChips((p) => ({ ...p, alignmentPeople: v }))}
        testIdPrefix={`${testIdPrefix}-align-people`}
      />
      <CalmSingleSelectRow
        label="Alignment — activities and what I value"
        options={ALIGNMENT_ACTIVITIES_OPTIONS}
        value={chips.alignmentValues}
        onPick={(v) => setChips((p) => ({ ...p, alignmentValues: v }))}
        testIdPrefix={`${testIdPrefix}-align-values`}
      />
      <div className="space-y-2">
        <CalmMultiSelectRow
          label="What's on my mind"
          options={MIND_CATEGORY_OPTIONS}
          values={chips.mindCategories}
          onToggle={(value) =>
            setChips((p) => {
              const has = p.mindCategories.includes(value);
              const nextCats = has
                ? p.mindCategories.filter((c) => c !== value)
                : [...p.mindCategories, value];
              // Deselecting Other clears its inline label.
              const nextOther =
                value === "Other" && has ? "" : p.mindOtherLabel;
              return {
                ...p,
                mindCategories: nextCats,
                mindOtherLabel: nextOther,
              };
            })
          }
          testIdPrefix={`${testIdPrefix}-mind`}
        />
        {otherSelected && (
          <Input
            data-testid={`${testIdPrefix}-mind-other-label`}
            placeholder="What is 'other'?"
            value={chips.mindOtherLabel}
            onChange={(e) =>
              setChips((p) => ({ ...p, mindOtherLabel: e.target.value }))
            }
          />
        )}
      </div>
      <div className="space-y-2">
        <div className="text-sm text-muted-foreground">Empty my head</div>
        <Textarea
          data-testid={`${testIdPrefix}-brain-dump`}
          rows={4}
          placeholder={brainDumpPlaceholder}
          value={chips.brainDump}
          onChange={(e) =>
            setChips((p) => ({ ...p, brainDump: e.target.value }))
          }
        />
      </div>
    </div>
  );
}

function PreCaptureScreen(props: {
  variant: Variant;
  setVariant: (v: Variant) => void;
  candidates: IssueCandidates | undefined;
  searchQuery: string;
  setSearchQuery: (s: string) => void;
  selected: SelectedIssue | null;
  pickIssue: (entityType: EntityType, entityId: number | null, label: string) => void;
  clearIssue: () => void;
  showFreetext: boolean;
  setShowFreetext: (b: boolean) => void;
  freetext: string;
  setFreetext: (s: string) => void;
  useFreetext: () => void;
  chips: CalmChipState;
  setChips: React.Dispatch<React.SetStateAction<CalmChipState>>;
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
      <ChipBlock
        chips={props.chips}
        setChips={props.setChips}
        brainDumpPlaceholder="Anything else on your mind. No structure needed."
        testIdPrefix="calm-pre"
      />

      <section className="space-y-2">
        <label className="text-sm font-medium">Anchor this to an issue (optional)</label>
        <Input
          placeholder="Search tasks, projects, inbox…"
          value={props.searchQuery}
          onChange={(e) => props.setSearchQuery(e.target.value)}
        />
        <div className="max-h-48 overflow-y-auto rounded border bg-muted/30 divide-y">
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
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <div>
                Selected:{" "}
                <span className="font-medium text-foreground">
                  {props.selected.label}
                </span>
              </div>
              <button
                type="button"
                onClick={props.clearIssue}
                className="underline hover:text-foreground"
              >
                Clear
              </button>
            </div>
          )}
        </div>
      </section>

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

      <Button
        size="lg"
        className="w-full"
        disabled={props.starting}
        onClick={props.startSession}
        data-testid="calm-pre-continue"
      >
        {props.starting ? "Starting…" : "Continue"}
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

// Stage 18 — box-breathing phase index. 0 = inhale, 1 = hold-full,
// 2 = exhale, 3 = hold-empty. Used to drive the visual scale.
type BoxPhase = 0 | 1 | 2 | 3;

function BreathingScreen({ onDone }: { onDone: () => void }) {
  const [tick, setTick] = useState(0);
  const [skipped, setSkipped] = useState(false);
  const startRef = useRef<number>(Date.now());
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Mount-effect: start the bundled audio loop. Modern browsers require a
  // user gesture before audio plays; the breathing screen is always entered
  // via the "Begin" / "Continue" CTA so the gesture chain is already
  // satisfied. Failures (autoplay blocked, missing codec) are swallowed —
  // breathing should still work without sound.
  useEffect(() => {
    const el = audioRef.current;
    if (el) {
      el.volume = CALM_AUDIO_VOLUME;
      el.currentTime = 0;
      const p = el.play();
      if (p && typeof p.catch === "function") {
        p.catch(() => {
          // Autoplay blocked or asset unavailable. Stay silent.
        });
      }
    }
    return () => {
      const cur = audioRef.current;
      if (cur) {
        try {
          cur.pause();
          cur.currentTime = 0;
        } catch {
          // ignore — jsdom + some browsers throw on currentTime when
          // the element is in an unloaded state.
        }
      }
    };
  }, []);

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
  const phase = Math.floor(phaseTick / PHASE_SECONDS) as BoxPhase;
  // Circle scale by phase:
  //   inhale     → expanding to full (scale-150)
  //   hold-full  → sit at full      (scale-150)
  //   exhale     → contracting to small (scale-100)
  //   hold-empty → sit at small     (scale-100)
  const atFullSize = phase === 0 || phase === 1;
  // CSS transitions only need to run during the moving phases (0 and 2).
  // During the holds we still want the size to stay where it is, so the
  // transition duration drops to 0 to avoid any drift on prop swap.
  const transitionDuration =
    phase === 0 || phase === 2 ? `${PHASE_SECONDS}s` : "0s";
  const canSkip = !skipped && tick >= 2 * CYCLE_SECONDS;

  return (
    <div className="space-y-8 py-6">
      <div className="text-center text-sm text-muted-foreground">
        Cycle {cycle} of {TOTAL_CYCLES}
      </div>
      <div className="flex items-center justify-center h-64">
        <div
          data-testid="calm-breath-circle"
          data-phase={phase}
          className={cn(
            "rounded-full bg-primary/20 border border-primary/40 transition-all ease-in-out",
            atFullSize ? "scale-150" : "scale-100",
          )}
          style={{
            width: "10rem",
            height: "10rem",
            transitionDuration,
          }}
        />
      </div>
      {/* Stage 18 — no phase label per user. The visual + audio carry it. */}
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
      {/* Stage 18 — bundled calm loop. `loop` so we don't gap on long
          sessions; `preload="auto"` to minimise first-play latency. No
          controls — the user starts/stops by entering/leaving this screen. */}
      <audio
        ref={audioRef}
        src={calmLoopUrl}
        loop
        preload="auto"
        data-testid="calm-audio"
      />
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
        <div className="text-center text-muted-foreground italic py-12">…</div>
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
  chips: CalmChipState;
  setChips: React.Dispatch<React.SetStateAction<CalmChipState>>;
  finishing: boolean;
  onFinish: () => void;
}) {
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-medium">How are you now?</h2>
      <ChipBlock
        chips={props.chips}
        setChips={props.setChips}
        brainDumpPlaceholder="Anything else on your mind. No structure needed."
        testIdPrefix="calm-post"
      />
      <Button
        size="lg"
        className="w-full"
        onClick={props.onFinish}
        disabled={props.finishing}
        data-testid="calm-post-done"
      >
        {props.finishing ? "Finishing…" : "Done"}
      </Button>
    </div>
  );
}

// -- Done summary ----------------------------------------------------------
//
// Stage 13a shows the dimensions that changed between pre and post.
// Dimensions where one side is null or both sides match are omitted.

const CHIP_DIMENSION_LABELS: Array<{
  key: keyof CalmChipState;
  label: string;
}> = [
  { key: "arousal", label: "Arousal" },
  { key: "energy", label: "Energy" },
  { key: "sleep", label: "Sleep" },
  { key: "mood", label: "Mood" },
  { key: "cognitiveLoad", label: "Cognitive load" },
  { key: "focus", label: "Focus" },
  { key: "alignmentPeople", label: "Alignment — people" },
  { key: "alignmentValues", label: "Alignment — values" },
];

function DoneScreen(props: {
  preChips: CalmChipState;
  postChips: CalmChipState;
  onBack: () => void;
}) {
  const deltas: Array<{ label: string; from: string; to: string }> = [];
  for (const { key, label } of CHIP_DIMENSION_LABELS) {
    const a = props.preChips[key] as string | null;
    const b = props.postChips[key] as string | null;
    if (a && b && a !== b) deltas.push({ label, from: a, to: b });
  }
  const preCats = new Set(props.preChips.mindCategories);
  const postCats = new Set(props.postChips.mindCategories);
  const addedCats = props.postChips.mindCategories.filter((c) => !preCats.has(c));
  const droppedCats = props.preChips.mindCategories.filter((c) => !postCats.has(c));
  const nothingChanged =
    deltas.length === 0 && addedCats.length === 0 && droppedCats.length === 0;
  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6 space-y-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            What shifted
          </div>
          {nothingChanged && (
            <div className="text-sm text-muted-foreground italic">
              No movement recorded. That's still a real outcome.
            </div>
          )}
          {deltas.length > 0 && (
            <ul className="text-sm space-y-1">
              {deltas.map((d) => (
                <li key={d.label}>
                  <span className="text-muted-foreground">{d.label}:</span>{" "}
                  {d.from} → {d.to}
                </li>
              ))}
            </ul>
          )}
          {addedCats.length > 0 && (
            <div className="text-sm">
              <span className="text-muted-foreground">Mind — added:</span>{" "}
              {addedCats.join(", ")}
            </div>
          )}
          {droppedCats.length > 0 && (
            <div className="text-sm">
              <span className="text-muted-foreground">Mind — dropped:</span>{" "}
              {droppedCats.join(", ")}
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
