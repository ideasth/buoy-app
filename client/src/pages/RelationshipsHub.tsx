// Stage 24 (2026-08-11) — Relationships hub.
//
// Two-section landing page: People (existing coach-prompt relationships)
// and Transition (new private governance surface). Keeps the existing
// Relationships CRUD reachable, and lets Transition live under the same
// section without cross-contaminating either surface.

import { useLocation } from "wouter";
import Relationships from "./Relationships";

export default function RelationshipsHub() {
  const [location, setLocation] = useLocation();
  return (
    <div className="mx-auto max-w-5xl px-4 py-6 space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Relationships</h1>
        <p className="text-sm text-muted-foreground">
          People you care about, and a private governance surface for the current life
          transition.
        </p>
      </header>

      <section className="rounded-lg border bg-card p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">Transition</h2>
            <p className="text-sm text-muted-foreground">
              Private, read-only outbound governance surface. Decision statement, action plan,
              evidence ledger, financial reconciliation, IT handover, and audience-scoped
              exports.
            </p>
          </div>
          <button
            onClick={() => setLocation("/relationships/transition")}
            className="rounded bg-primary text-primary-foreground text-sm px-3 py-1"
          >
            Open Transition
          </button>
        </div>
      </section>

      <section className="rounded-lg border bg-card p-4 space-y-2">
        <h2 className="text-base font-semibold">People</h2>
        <p className="text-sm text-muted-foreground">
          CRUD list of people used by Reflect-mode coach prompts.
        </p>
        <div className="pt-2">
          <Relationships />
        </div>
      </section>
    </div>
  );
}
