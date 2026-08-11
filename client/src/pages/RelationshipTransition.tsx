// Stage 24 (2026-08-11) — Relationship Transition hub page.
//
// Read-only outbound: this page renders and edits Oliver's own private
// notes. It has no "send" surface, no message construction to any other
// party, and no child-facing UI. Every value is stored locally in the
// Buoy SQLite DB.

import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";

type RecordType =
  | "documented_fact"
  | "self_report"
  | "reported_other_statement"
  | "inference"
  | "historical_summary"
  | "open_question"
  | "recommendation";

const RECORD_TYPE_STYLE: Record<RecordType, string> = {
  documented_fact: "bg-emerald-50 text-emerald-800 border-emerald-200",
  self_report: "bg-sky-50 text-sky-800 border-sky-200",
  reported_other_statement: "bg-amber-50 text-amber-900 border-amber-200",
  inference: "bg-violet-50 text-violet-800 border-violet-200",
  historical_summary: "bg-slate-100 text-slate-800 border-slate-200",
  open_question: "bg-yellow-50 text-yellow-900 border-yellow-200",
  recommendation: "bg-teal-50 text-teal-800 border-teal-200",
};

function RecordTypeBadge({ type }: { type: RecordType }) {
  const cls = RECORD_TYPE_STYLE[type] ?? "bg-slate-50 text-slate-700 border-slate-200";
  return (
    <span
      className={`inline-block text-xs px-2 py-0.5 rounded border ${cls}`}
      title={`record_type = ${type}`}
    >
      {type.replaceAll("_", " ")}
    </span>
  );
}

function ConfidentialityBadge({ level }: { level: string }) {
  const styles: Record<string, string> = {
    private: "bg-rose-50 text-rose-800 border-rose-200",
    therapist: "bg-indigo-50 text-indigo-800 border-indigo-200",
    lawyer: "bg-blue-50 text-blue-800 border-blue-200",
    mediator: "bg-fuchsia-50 text-fuchsia-800 border-fuchsia-200",
  };
  const cls = styles[level] ?? "bg-slate-50 text-slate-700 border-slate-200";
  return <span className={`inline-block text-xs px-2 py-0.5 rounded border ${cls}`}>{level}</span>;
}

type Section =
  | "dashboard"
  | "actions"
  | "ledger"
  | "financial"
  | "it"
  | "export"
  | "placeholders";

const SECTIONS: Array<{ key: Section; label: string }> = [
  { key: "dashboard", label: "Dashboard" },
  { key: "actions", label: "Action Plan" },
  { key: "ledger", label: "Evidence Ledger" },
  { key: "financial", label: "Financial" },
  { key: "it", label: "IT Handover" },
  { key: "export", label: "Export" },
  { key: "placeholders", label: "Other Areas" },
];

async function apiJson<T>(url: string, opts?: { method?: string; body?: any }): Promise<T> {
  const method = opts?.method ?? "GET";
  const res = await apiRequest(method, url, opts?.body);
  return (await res.json()) as T;
}

// ---------- Dashboard ----------

function Dashboard() {
  const [summary, setSummary] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [decision, setDecision] = useState("");
  const [phase, setPhase] = useState("decision_taken");
  const [climate, setClimate] = useState<any>(null);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    const s = await apiJson<any>("/api/transition/summary");
    setSummary(s);
    if (s?.state) {
      setDecision(s.state.decisionStatement ?? "");
      setPhase(s.state.phase ?? "decision_taken");
      setClimate(s.state.interactionClimate ?? null);
    }
  }

  async function saveDecision() {
    setSaving(true);
    try {
      await apiJson("/api/transition/state", {
        method: "PATCH",
        body: { decisionStatement: decision, phase },
      });
      await refresh();
    } finally {
      setSaving(false);
    }
  }

  if (!summary) return <div className="text-sm text-muted-foreground">Loading…</div>;

  const c = summary.counts ?? {};
  const drivers = summary.state?.drivers ?? {};

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-900 px-4 py-3 text-sm">
        This module is a private, read-only outbound tool. Nothing here is sent to Marieke,
        Axel, Hilde, or any professional. Every export is a copy-only Markdown bundle for you
        or an advisor.
      </div>

      <section className="rounded-lg border p-4 bg-card">
        <h2 className="text-base font-semibold mb-2">Decision statement</h2>
        <textarea
          className="w-full min-h-[120px] rounded border bg-background p-2 text-sm"
          value={decision}
          onChange={(e) => setDecision(e.target.value)}
        />
        <div className="mt-2 flex items-center gap-3">
          <label className="text-sm">
            Phase:{" "}
            <select
              className="ml-1 rounded border bg-background px-2 py-1 text-sm"
              value={phase}
              onChange={(e) => setPhase(e.target.value)}
            >
              {["decision_taken", "communicating", "separating", "reorganising"].map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => void saveDecision()}
            disabled={saving}
            className="rounded bg-primary text-primary-foreground text-sm px-3 py-1"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <StatCard label="Open actions" value={c.open_actions ?? 0} />
        <StatCard label="Complete actions" value={c.complete_actions ?? 0} />
        <StatCard label="Ledger entries" value={c.ledger_entries ?? 0} />
        <StatCard label="Documented facts" value={c.documented_facts ?? 0} />
        <StatCard label="Open questions" value={c.open_questions ?? 0} />
        <StatCard label="Financial items" value={c.financial_items ?? 0} />
        <StatCard label="IT items" value={`${c.it_complete ?? 0} / ${c.it_items ?? 0}`} />
      </section>

      <section className="rounded-lg border p-4 bg-card">
        <h3 className="text-sm font-semibold mb-2">Decision drivers (1–5)</h3>
        <ul className="grid gap-2 md:grid-cols-2 text-sm">
          {Object.entries(drivers).map(([k, v]) => (
            <li key={k} className="flex items-center justify-between">
              <span className="text-muted-foreground">{k}</span>
              <span className="font-mono">{String(v ?? "–")}</span>
            </li>
          ))}
        </ul>
      </section>

      {climate ? (
        <section className="rounded-lg border p-4 bg-card">
          <h3 className="text-sm font-semibold mb-2">Interaction climate</h3>
          <pre className="text-xs bg-muted p-3 rounded overflow-x-auto">
            {JSON.stringify(climate, null, 2)}
          </pre>
        </section>
      ) : null}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

// ---------- Actions ----------

function ActionPlan() {
  const [rows, setRows] = useState<any[]>([]);
  const [horizon, setHorizon] = useState<string>("");

  useEffect(() => {
    void refresh();
  }, [horizon]);

  async function refresh() {
    const q = horizon ? `?horizon=${horizon}` : "";
    setRows(await apiJson<any[]>(`/api/transition/actions${q}`));
  }

  async function setStatus(id: number, status: string) {
    await apiJson(`/api/transition/actions/${id}`, {
      method: "PATCH",
      body: { status },
    });
    await refresh();
  }

  const byHorizon = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const r of rows) {
      const arr = m.get(r.horizon) ?? [];
      arr.push(r);
      m.set(r.horizon, arr);
    }
    return m;
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm">
        <span>Horizon filter:</span>
        {["", "72h", "2w", "1_3m", "later"].map((h) => (
          <button
            key={h || "all"}
            onClick={() => setHorizon(h)}
            className={`rounded border px-2 py-0.5 text-xs ${
              horizon === h ? "bg-primary text-primary-foreground" : ""
            }`}
          >
            {h || "all"}
          </button>
        ))}
      </div>
      {[...byHorizon.entries()].map(([h, items]) => (
        <section key={h} className="rounded-lg border bg-card p-4">
          <h3 className="text-sm font-semibold mb-2">{h}</h3>
          <ul className="space-y-2">
            {items.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{r.title}</span>
                    <RecordTypeBadge type={r.recordType} />
                    <ConfidentialityBadge level={r.confidentiality} />
                    <span className="text-xs text-muted-foreground">{r.area}</span>
                  </div>
                  {r.detail ? (
                    <p className="text-sm text-muted-foreground mt-1">{r.detail}</p>
                  ) : null}
                </div>
                <select
                  className="rounded border bg-background px-2 py-1 text-xs"
                  value={r.status}
                  onChange={(e) => void setStatus(r.id, e.target.value)}
                >
                  {["Open", "Active", "Complete", "Parked"].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ---------- Ledger ----------

const RECORD_TYPES: RecordType[] = [
  "documented_fact",
  "self_report",
  "reported_other_statement",
  "inference",
  "historical_summary",
  "open_question",
  "recommendation",
];

function Ledger() {
  const [rows, setRows] = useState<any[]>([]);
  const [filter, setFilter] = useState<string>("");
  const [form, setForm] = useState<any>({
    recordType: "self_report",
    perspective: "me",
    confidentiality: "private",
    body: "",
    title: "",
    category: "",
    sourceKind: "own_recollection",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, [filter]);

  async function refresh() {
    const q = filter ? `?recordType=${filter}` : "";
    setRows(await apiJson<any[]>(`/api/transition/ledger${q}`));
  }

  async function submit() {
    setSaving(true);
    setErr(null);
    try {
      await apiJson("/api/transition/ledger", {
        method: "POST",
        body: form,
      });
      setForm({ ...form, body: "", title: "" });
      await refresh();
    } catch (e: any) {
      setErr(e?.message ?? "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-lg border bg-card p-4 space-y-2">
        <h3 className="text-sm font-semibold">Add ledger entry</h3>
        <div className="grid gap-2 md:grid-cols-3 text-sm">
          <label>
            record_type
            <select
              className="w-full rounded border bg-background px-2 py-1"
              value={form.recordType}
              onChange={(e) => setForm({ ...form, recordType: e.target.value })}
            >
              {RECORD_TYPES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label>
            perspective
            <select
              className="w-full rounded border bg-background px-2 py-1"
              value={form.perspective}
              onChange={(e) => setForm({ ...form, perspective: e.target.value })}
            >
              {["me", "other", "both", "unknown"].map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label>
            confidentiality
            <select
              className="w-full rounded border bg-background px-2 py-1"
              value={form.confidentiality}
              onChange={(e) => setForm({ ...form, confidentiality: e.target.value })}
            >
              {["private", "therapist", "lawyer", "mediator"].map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label>
            title
            <input
              className="w-full rounded border bg-background px-2 py-1"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </label>
          <label>
            category
            <input
              className="w-full rounded border bg-background px-2 py-1"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            />
          </label>
          <label>
            source_kind
            <select
              className="w-full rounded border bg-background px-2 py-1"
              value={form.sourceKind}
              onChange={(e) => setForm({ ...form, sourceKind: e.target.value })}
            >
              {[
                "message",
                "email",
                "document",
                "photo",
                "receipt",
                "recorded_call",
                "own_recollection",
                "inference",
              ].map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        </div>
        <textarea
          className="w-full min-h-[100px] rounded border bg-background p-2 text-sm"
          placeholder="Body (required)"
          value={form.body}
          onChange={(e) => setForm({ ...form, body: e.target.value })}
        />
        {err ? <div className="text-sm text-rose-700">Error: {err}</div> : null}
        <div className="flex justify-end">
          <button
            className="rounded bg-primary text-primary-foreground text-sm px-3 py-1"
            onClick={() => void submit()}
            disabled={saving || !form.body.trim()}
          >
            {saving ? "Saving…" : "Add entry"}
          </button>
        </div>
      </section>

      <div className="flex items-center gap-2 text-sm">
        <span>Filter:</span>
        <button
          onClick={() => setFilter("")}
          className={`rounded border px-2 py-0.5 text-xs ${
            filter === "" ? "bg-primary text-primary-foreground" : ""
          }`}
        >
          all
        </button>
        {RECORD_TYPES.map((t) => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            className={`rounded border px-2 py-0.5 text-xs ${
              filter === t ? "bg-primary text-primary-foreground" : ""
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.id} className="rounded border bg-card p-3">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <RecordTypeBadge type={r.recordType} />
              <ConfidentialityBadge level={r.confidentiality} />
              <span className="text-xs text-muted-foreground">{r.perspective}</span>
              {r.category ? (
                <span className="text-xs text-muted-foreground">· {r.category}</span>
              ) : null}
              {r.eventDate ? (
                <span className="text-xs text-muted-foreground">· {r.eventDate}</span>
              ) : null}
            </div>
            {r.title ? <div className="text-sm font-medium">{r.title}</div> : null}
            <div className="text-sm whitespace-pre-wrap">{r.body}</div>
            {r.sourceLabel || r.sourceUrl ? (
              <div className="mt-1 text-xs text-muted-foreground">
                source: {r.sourceLabel} {r.sourceUrl}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- Financial ----------

function Financial() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    void (async () => {
      setRows(await apiJson<any[]>("/api/transition/financial"));
    })();
  }, []);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Skeleton register of shared / disputed financial items. Amounts are stored in AUD
        cents. Populate incrementally.
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th>Category</th>
            <th>Description</th>
            <th>Amount</th>
            <th>Direction</th>
            <th>Evidence</th>
            <th>Confidentiality</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t">
              <td className="py-1">{r.category}</td>
              <td>{r.description}</td>
              <td>{r.amountAudCents == null ? "–" : `$${(r.amountAudCents / 100).toFixed(2)}`}</td>
              <td>{r.direction}</td>
              <td>{r.evidenceStatus}</td>
              <td>
                <ConfidentialityBadge level={r.confidentiality} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- IT Handover ----------

function ItHandover() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    void (async () => {
      setRows(await apiJson<any[]>("/api/transition/it-handover"));
    })();
  }, []);
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2 text-sm">
        Never store passwords, tokens, recovery codes, or credentials in the notes field.
        Buoy will reject writes containing those terms.
      </div>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.id} className="rounded border bg-card p-3 flex items-start justify-between">
            <div>
              <div className="font-medium text-sm">
                {r.system}
                {r.sensitivity === "sensitive" ? (
                  <span className="ml-2 text-xs text-rose-700">sensitive</span>
                ) : null}
              </div>
              <div className="text-xs text-muted-foreground">
                access: {r.accessStatus} · handover: {r.handoverStatus}
              </div>
              {r.nextAction ? <div className="text-sm mt-1">Next: {r.nextAction}</div> : null}
            </div>
            <ConfidentialityBadge level={r.confidentiality} />
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- Export ----------

function ExportBundle() {
  const [audience, setAudience] = useState<string>("lawyer");
  const [bundle, setBundle] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setErr(null);
    try {
      const res = await apiJson<any>("/api/transition/export", {
        method: "POST",
        body: { audience },
      });
      setBundle(res);
    } catch (e: any) {
      setErr(e?.message ?? "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-900 px-3 py-2 text-sm">
        Export is COPY ONLY. Nothing is transmitted. Review before sharing anything with a
        professional advisor. Records flagged confidentiality = private are always
        suppressed.
      </div>
      <div className="flex items-center gap-2 text-sm">
        <label>
          Audience:{" "}
          <select
            className="ml-1 rounded border bg-background px-2 py-1"
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
          >
            {["lawyer", "therapist", "mediator", "child_comm", "redacted_chronology"].map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <button
          className="rounded bg-primary text-primary-foreground text-sm px-3 py-1"
          disabled={busy}
          onClick={() => void run()}
        >
          {busy ? "Building…" : "Build bundle"}
        </button>
      </div>
      {err ? <div className="text-sm text-rose-700">{err}</div> : null}
      {bundle ? (
        <>
          <div className="text-xs text-muted-foreground">
            Included: {bundle.json?.counts?.totalIncluded ?? 0} · Suppressed as private:{" "}
            {bundle.json?.counts?.suppressedPrivate ?? 0}
          </div>
          <textarea
            className="w-full min-h-[400px] rounded border bg-background p-2 text-xs font-mono"
            value={bundle.markdown}
            readOnly
          />
        </>
      ) : null}
    </div>
  );
}

// ---------- Placeholders ----------

function Placeholders() {
  const areas = [
    ["Property & Housing", "Home tenure, room-by-room asset list, transitional living."],
    ["Communication with Marieke", "Preferred channel, cadence, subject scoping, escalation."],
    ["Children (Axel & Hilde)", "Coordinate ALL wording with therapist. No child-facing surface."],
    ["Health & Wellbeing", "Sleep, GP check-ins, therapist cadence, medication continuity."],
    ["Work Capacity", "Bayside / Sandringham / AUPFHS load, patient safety net."],
    ["Documents", "Legal, financial, insurance, ID."],
    ["Longer-term", "Reorganising phase items."],
  ];
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {areas.map(([title, hint]) => (
        <section key={title} className="rounded border bg-card p-3">
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-xs text-muted-foreground mt-1">{hint}</p>
          <p className="text-xs text-muted-foreground mt-2 italic">
            Placeholder — capture items in the Ledger or Action Plan for now; a dedicated
            surface can grow from here later.
          </p>
        </section>
      ))}
    </div>
  );
}

// ---------- Page shell ----------

export default function RelationshipTransition() {
  const [section, setSection] = useState<Section>("dashboard");
  const [, setLocation] = useLocation();
  return (
    <div className="mx-auto max-w-5xl px-4 py-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Relationship Transition</h1>
          <p className="text-sm text-muted-foreground">
            Private governance surface for the current life transition. Read-only outbound.
          </p>
        </div>
        <button
          className="text-sm underline text-muted-foreground"
          onClick={() => setLocation("/relationships")}
        >
          ← Relationships hub
        </button>
      </div>
      <nav className="flex flex-wrap gap-1 border-b">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            onClick={() => setSection(s.key)}
            className={`text-sm px-3 py-1 rounded-t border ${
              section === s.key
                ? "bg-card border-b-card font-medium"
                : "bg-transparent text-muted-foreground border-transparent"
            }`}
          >
            {s.label}
          </button>
        ))}
      </nav>
      <div className="pt-2">
        {section === "dashboard" && <Dashboard />}
        {section === "actions" && <ActionPlan />}
        {section === "ledger" && <Ledger />}
        {section === "financial" && <Financial />}
        {section === "it" && <ItHandover />}
        {section === "export" && <ExportBundle />}
        {section === "placeholders" && <Placeholders />}
      </div>
    </div>
  );
}
