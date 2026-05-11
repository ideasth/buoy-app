import { useQuery } from "@tanstack/react-query";
import type { Reflection, Task } from "@shared/schema";
import { fmtDuration } from "@/lib/anchor";
import { AvailableHoursCard } from "@/components/AvailableHoursCard";
import { WeeklyFactorsStrip } from "@/components/WeeklyFactorsStrip";
import { IssuesThisWeek } from "@/components/IssuesThisWeek";

interface WeeklyReview {
  from: string;
  to: string;
  completedCount: number;
  droppedCount: number;
  totalEstimatedMinutes: number;
  totalActualMinutes: number;
  adhdTaxCoefficient: number;
  avgEnergy: number;
  reflections: Reflection[];
  completedTasks: Task[];
  calm?: {
    totalCount: number;
    countByVariant: {
      grounding_only: number;
      grounding_plus_reflection: number;
    };
    avgIntensityDeltaByVariant: {
      grounding_only: number;
      grounding_plus_reflection: number;
    };
    topTags: Array<{ tag: string; count: number }>;
    linkedIssues: Array<{
      entityType: string;
      entityId: number | null;
      label: string;
      count: number;
    }>;
  };
}

export default function Review() {
  const wkQ = useQuery<WeeklyReview>({ queryKey: ["/api/weekly-review"] });
  const reflectionsQ = useQuery<Reflection[]>({ queryKey: ["/api/reflections"] });

  const weeklies = (reflectionsQ.data ?? []).filter((r) => r.kind === "weekly").slice(0, 6);
  const quarterlies = (reflectionsQ.data ?? []).filter((r) => r.kind === "quarterly").slice(0, 4);

  const w = wkQ.data;

  return (
    <div className="px-5 md:px-8 py-8 md:py-10 max-w-3xl space-y-10">
      <header>
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Review</div>
        <h1 className="text-2xl font-semibold mt-1">How the week actually went.</h1>
      </header>

      {w && (
        <section>
          <h2 className="text-sm font-medium mb-3">Last 7 days</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Done" value={String(w.completedCount)} />
            <Stat label="Dropped" value={String(w.droppedCount)} />
            <Stat label="Estimated" value={fmtDuration(w.totalEstimatedMinutes)} />
            <Stat label="Actual" value={fmtDuration(w.totalActualMinutes)} />
            <Stat label="Avg energy" value={w.avgEnergy ? w.avgEnergy.toFixed(1) : "—"} />
            <Stat label="ADHD tax" value={`${w.adhdTaxCoefficient.toFixed(2)}×`} />
          </div>
        </section>
      )}

      <section>
        <h2 className="text-sm font-medium mb-3">Available project time</h2>
        <AvailableHoursCard variant="detailed" />
      </section>

      <section>
        <h2 className="text-sm font-medium mb-3">Mood &amp; factors this week</h2>
        <WeeklyFactorsStrip />
      </section>

      <section>
        <h2 className="text-sm font-medium mb-3">Issues this week</h2>
        <IssuesThisWeek />
      </section>

      <section>
        <h2 className="text-sm font-medium mb-3">Weekly reviews</h2>
        {weeklies.length === 0 && (
          <div className="text-sm text-muted-foreground italic rounded-lg border border-dashed p-4">
            No weekly reviews yet. Try one on Sunday.
          </div>
        )}
        <div className="space-y-3">
          {weeklies.map((r) => {
            let parsed: any = null;
            try {
              parsed = JSON.parse(r.notes ?? "{}");
            } catch {}
            return (
              <article key={r.id} className="rounded-lg border bg-card p-4">
                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                  Week of {r.date}
                </div>
                {parsed ? (
                  <dl className="grid sm:grid-cols-2 gap-3 text-sm">
                    {parsed.wins && <Field label="Wins" value={parsed.wins} />}
                    {parsed.slipped && <Field label="Slipped" value={parsed.slipped} />}
                    {parsed.patterns && <Field label="Patterns" value={parsed.patterns} />}
                    {parsed.nextAnchor && <Field label="Next anchor" value={parsed.nextAnchor} />}
                    {parsed.drop && <Field label="Drop" value={parsed.drop} />}
                  </dl>
                ) : (
                  <div className="text-sm">{r.notes}</div>
                )}
              </article>
            );
          })}
        </div>
      </section>

      {w?.calm && w.calm.totalCount > 0 && (
        <section>
          <h2 className="text-sm font-medium mb-3">Calm sessions</h2>
          <div className="rounded-lg border bg-card p-4 space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  Grounding only
                </div>
                <div className="mt-0.5 tabular-nums">
                  {w.calm.countByVariant.grounding_only}{" "}
                  <span className="text-xs text-muted-foreground">
                    (avg Δ {fmtDelta(w.calm.avgIntensityDeltaByVariant.grounding_only)})
                  </span>
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  Grounding + reflection
                </div>
                <div className="mt-0.5 tabular-nums">
                  {w.calm.countByVariant.grounding_plus_reflection}{" "}
                  <span className="text-xs text-muted-foreground">
                    (avg Δ{" "}
                    {fmtDelta(w.calm.avgIntensityDeltaByVariant.grounding_plus_reflection)})
                  </span>
                </div>
              </div>
            </div>
            {w.calm.topTags.length > 0 && (
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                  Most-tagged feelings
                </div>
                <div className="flex flex-wrap gap-2">
                  {w.calm.topTags.map((t) => (
                    <span
                      key={t.tag}
                      className="text-xs px-2 py-1 rounded-full bg-muted"
                    >
                      {t.tag} <span className="text-muted-foreground">×{t.count}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
            {w.calm.linkedIssues.length > 0 && (
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                  Linked issues
                </div>
                <ul className="text-sm space-y-1">
                  {w.calm.linkedIssues.map((li, i) => (
                    <li key={`${li.entityType}-${li.entityId ?? i}`}>
                      <span className="text-xs text-muted-foreground mr-2">
                        {li.entityType}
                      </span>
                      {li.label}{" "}
                      <span className="text-xs text-muted-foreground">×{li.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-sm font-medium mb-3">Quarterly reviews</h2>
        {quarterlies.length === 0 ? (
          <div className="text-sm text-muted-foreground italic rounded-lg border border-dashed p-4">
            Nothing yet — set quarterly goals on the goals page (coming soon).
          </div>
        ) : (
          <div className="space-y-3">
            {quarterlies.map((r) => (
              <article key={r.id} className="rounded-lg border bg-card p-4">
                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                  {r.date}
                </div>
                <div className="text-sm whitespace-pre-wrap">{r.notes}</div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function fmtDelta(n: number): string {
  if (n === 0) return "0";
  return n > 0 ? `+${n.toFixed(1)}` : n.toFixed(1);
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="clock-numerals text-2xl font-medium mt-1 tabular-nums">{value}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}
